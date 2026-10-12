import { ApiError } from './http';
import type { Env } from './types';

type GachaVersion = { inventory_version: number };

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 32) {
    // 501, not 503 (#306): `/admin/ledger` answers 503 for a broken ledger, and a monitor reading only the status must be
    // able to tell the two apart.
    throw new ApiError('UNKNOWN', 'Admin API is not configured', 501);
  }
  const provided = request.headers.get('x-admin-api-key');
  if (!provided || provided.length > 1_024) throw new ApiError('UNAUTHENTICATED', 'Invalid admin API key', 401);
  const [expectedHash, providedHash] = await Promise.all([digest(env.ADMIN_API_KEY), digest(provided)]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index++) difference |= expectedHash[index] ^ providedHash[index];
  if (difference !== 0) throw new ApiError('UNAUTHENTICATED', 'Invalid admin API key', 401);
}

export async function updateGachaInventory(
  db: D1Database,
  gachaId: string,
  inventoryKey: string,
  operation: 'add' | 'remove',
  selectionWeight = 1,
) {
  if (!Number.isSafeInteger(selectionWeight) || selectionWeight < 1 || selectionWeight > 1_000_000) {
    throw new ApiError('UNKNOWN', 'selectionWeight must be an integer from 1 to 1000000');
  }
  const gacha = await db.prepare('SELECT inventory_version FROM gachas WHERE id = ?')
    .bind(gachaId).first<GachaVersion>();
  if (!gacha) throw new ApiError('UNKNOWN', 'No such gacha', 404);
  if (operation === 'add') {
    const stock = await db.prepare('SELECT 1 FROM stock_items WHERE inventory_key = ?').bind(inventoryKey).first();
    if (!stock) throw new ApiError('UNKNOWN', 'No such stock item', 404);
  }
  const existing = await db.prepare(`SELECT selection_weight, enabled FROM gacha_inventory
    WHERE gacha_id = ? AND inventory_version = ? AND inventory_key = ?`)
    .bind(gachaId, gacha.inventory_version, inventoryKey)
    .first<{ selection_weight: number; enabled: number }>();
  if (operation === 'add' && existing?.enabled === 1 && existing.selection_weight === selectionWeight) {
    return { gachaId, inventoryKey, inventoryVersion: gacha.inventory_version, member: true };
  }
  if (operation === 'remove' && !existing) {
    return { gachaId, inventoryKey, inventoryVersion: gacha.inventory_version, member: false };
  }
  if (operation === 'remove' && existing?.enabled === 1) {
    const count = await db.prepare(`SELECT COUNT(*) AS count FROM gacha_inventory
      WHERE gacha_id = ? AND inventory_version = ? AND enabled = 1`)
      .bind(gachaId, gacha.inventory_version).first<{ count: number }>();
    if ((count?.count ?? 0) <= 1) throw new ApiError('UNKNOWN', 'A gacha inventory cannot be empty');
  }

  const nextVersion = gacha.inventory_version + 1;
  const now = new Date().toISOString();
  const statements = [
    db.prepare(`INSERT INTO gacha_inventory_versions (gacha_id, inventory_version, created_at)
      VALUES (?, ?, ?)`).bind(gachaId, nextVersion, now),
    db.prepare(`INSERT INTO gacha_inventory
      (gacha_id, inventory_version, inventory_key, selection_weight, enabled)
      SELECT gacha_id, ?, inventory_key, selection_weight, enabled FROM gacha_inventory
      WHERE gacha_id = ? AND inventory_version = ? AND inventory_key != ?`)
      .bind(nextVersion, gachaId, gacha.inventory_version, inventoryKey),
  ];
  if (operation === 'add') {
    statements.push(db.prepare(`INSERT INTO gacha_inventory
      (gacha_id, inventory_version, inventory_key, selection_weight, enabled)
      VALUES (?, ?, ?, ?, 1)`).bind(gachaId, nextVersion, inventoryKey, selectionWeight));
  }
  statements.push(db.prepare(`UPDATE gachas SET inventory_version = ?, updated_at = ?
    WHERE id = ? AND inventory_version = ?`).bind(nextVersion, now, gachaId, gacha.inventory_version));
  try { await db.batch(statements); }
  catch (error) {
    const latest = await db.prepare('SELECT inventory_version FROM gachas WHERE id = ?').bind(gachaId).first<GachaVersion>();
    if (latest && latest.inventory_version !== gacha.inventory_version) {
      throw new ApiError('UNKNOWN', 'Gacha inventory changed concurrently', 409);
    }
    throw error;
  }
  return { gachaId, inventoryKey, inventoryVersion: nextVersion, member: operation === 'add' };
}
