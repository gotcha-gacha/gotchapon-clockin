import { ApiError } from './http';
import { enabledAssets, walletBalance } from './payments';
import { INFINITE_AVAILABLE_REPORT } from './stock';
import type { CardRow, Env, Tier } from './types';

// `country` is what closes the app (src/config/geo.ts). With the geo block off it is `XX`, the unknown country ensureUser
// stores when the edge names none: the stored country stays in D1 and never closes the app.
export async function me(db: D1Database, userId: string, geoBlock = true) {
  const row = await db.prepare(`SELECT id, wallet, country, free_paid + free_common AS free_pulls,
    created_at FROM users WHERE id = ? AND deleted_at IS NULL`).bind(userId).first<Record<string, unknown>>();
  if (!row) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);
  return {
    id: row.id, wallet: row.wallet, country: geoBlock ? row.country : 'XX', freePulls: row.free_pulls, createdAt: row.created_at,
  };
}

export async function balance(db: D1Database, env: Env, userId: string) {
  if (env.PAYMENTS_MODE === 'solana-rpc') {
    const user = await db.prepare('SELECT wallet FROM users WHERE id = ?').bind(userId).first<{ wallet: string }>();
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);
    return walletBalance(env, user.wallet);
  }
  const result = await db.prepare('SELECT asset, amount FROM balances WHERE user_id = ?').bind(userId).all<{ asset: string; amount: number }>();
  const amounts = Object.fromEntries(result.results.map((row) => [row.asset, row.amount]));
  const usdc = amounts.USDC ?? 0;
  const usdt = amounts.USDT ?? 0;
  return { usdc, usdt, pulls: Math.floor((usdc + usdt) / 1_000_000) };
}

const cardRef = (row: CardRow) => ({ id: row.id, name: row.name, set: row.set_name, number: row.number, imgSmall: row.image_small, imgLarge: row.image_large });

export async function inventory(db: D1Database, userId: string) {
  type InventoryRow = CardRow & { item_id: string; tier: Tier; serial: string | null; acquired_at: string };
  const result = await db.prepare(`SELECT ui.id AS item_id, ui.card_id AS id, ui.tier, ui.serial, ui.acquired_at,
    c.name, c.set_name, c.number, c.printed_rarity, c.image_small, c.image_large
    FROM user_inventory ui JOIN cards c ON c.id = ui.card_id
    WHERE ui.user_id = ? AND ui.status = 'owned' ORDER BY ui.tier, c.name, ui.acquired_at, ui.id`)
    .bind(userId).all<InventoryRow>();
  const grouped = new Map<string, { cardId: string; qty: number; rarity: Tier; serials: string[]; itemIds: string[]; card: ReturnType<typeof cardRef> }>();
  for (const row of result.results) {
    const key = `${row.id}#${row.tier}`;
    const entry = grouped.get(key) ?? {
      cardId: row.id, qty: 0, rarity: row.tier, serials: [], itemIds: [], card: cardRef(row),
    };
    entry.qty++;
    entry.itemIds.push(row.item_id);
    if (row.serial) entry.serials.push(row.serial);
    grouped.set(key, entry);
  }
  return [...grouped.values()].map(({ serials, ...entry }) => ({
    ...entry, ...(serials.length ? { serials } : {}),
  }));
}

export async function extras(db: D1Database, userId: string) {
  const row = await db.prepare(`SELECT COALESCE(SUM(qty - 1), 0) AS count FROM (
    SELECT COUNT(*) AS qty FROM user_inventory
    WHERE user_id = ? AND tier = 'common' AND status = 'owned' GROUP BY card_id HAVING COUNT(*) > 1)`)
    .bind(userId).first<{ count: number }>();
  return { count: row?.count ?? 0 };
}

export async function albums(db: D1Database) {
  const albumRows = await db.prepare('SELECT id, title, subtitle, cover_url, size, status FROM albums ORDER BY sort_order').all<Record<string, unknown>>();
  const cardRows = await db.prepare(`SELECT ac.album_id, ac.slot, c.* FROM album_cards ac JOIN cards c ON c.id = ac.card_id ORDER BY ac.album_id, ac.slot`)
    .all<CardRow & { album_id: string; slot: number }>();
  return albumRows.results.map((album) => ({ id: album.id, title: album.title, sub: album.subtitle, coverUrl: album.cover_url,
    size: album.size, status: album.status, cards: cardRows.results.filter((row) => row.album_id === album.id).map((row) => ({
      id: row.id, slot: row.slot, name: row.name, set: row.set_name, number: row.number, rarity: row.printed_rarity,
      imgSmall: row.image_small, imgLarge: row.image_large,
    })) }));
}

export async function availability(db: D1Database, albumId: string) {
  const exists = await db.prepare('SELECT id FROM albums WHERE id = ?').bind(albumId).first();
  if (!exists) throw new ApiError('UNKNOWN', 'No such album', 404);
  const rows = await db.prepare(`SELECT i.card_id, i.supply, i.available FROM stock_items i
    WHERE i.album_id = ? AND i.tier = 'common'`).bind(albumId).all<{ card_id: string; supply: string; available: number }>();
  // An infinite P1 row stores no vault count. The number reported here is "in stock", not copies on a shelf.
  return Object.fromEntries(rows.results.map((row) => [row.card_id, row.supply === 'infinite' ? INFINITE_AVAILABLE_REPORT : row.available]));
}

export async function odds(db: D1Database, gachaId: string) {
  const gacha = await db.prepare(`SELECT paid_odds_config_id, free_odds_config_id, price_base,
    targeted_price_base FROM gachas WHERE id = ? AND status = 'active'`).bind(gachaId)
    .first<{ paid_odds_config_id: string; free_odds_config_id: string; price_base: number; targeted_price_base: number }>();
  if (!gacha) throw new ApiError('RESTOCKING', 'The gacha is not available');
  type OddsRow = { tier: Tier; weight: number; label: string; value_base: number; total_weight: number };
  const load = async (id: string) => (await db.prepare(`SELECT t.tier, t.weight, t.label, t.value_base, c.total_weight
    FROM odds_config_tiers t JOIN odds_configs c ON c.id = t.odds_config_id
    WHERE t.odds_config_id = ? AND t.weight > 0 ORDER BY t.sort_order`).bind(id).all<OddsRow>()).results;
  const [paidConfig, freeConfig] = await Promise.all([load(gacha.paid_odds_config_id), load(gacha.free_odds_config_id)]);
  const table = (rows: OddsRow[]) => rows.map((row) => ({
    tier: row.tier,
    label: row.label,
    pct: row.weight / row.total_weight,
    valueUsd: row.value_base / 1_000_000,
  }));
  const paidRows = table(paidConfig);
  const freeRows = table(freeConfig);
  const expectedValue = (rows: ReturnType<typeof table>) => rows.reduce((sum, row) => sum + row.pct * row.valueUsd, 0);
  const perAlbumRows = await db.prepare(`SELECT a.id, a.size AS total,
    COUNT(DISTINCT CASE WHEN i.supply = 'infinite' OR i.available > 0 THEN i.inventory_key END) AS live
    FROM albums a LEFT JOIN stock_items i ON i.album_id = a.id AND i.tier = 'common'
    WHERE a.status = 'live' GROUP BY a.id`).all<{ id: string; total: number; live: number }>();
  const holo = await db.prepare("SELECT COALESCE(SUM(available), 0) AS count FROM stock_items WHERE tier = 'holo'")
    .first<{ count: number }>();
  return {
    paid: { price: gacha.price_base / 1_000_000, targetedPrice: gacha.targeted_price_base / 1_000_000,
      evPct: expectedValue(paidRows), rows: paidRows },
    free: { price: 0, evPct: expectedValue(freeRows), rows: freeRows },
    refreshedAt: new Date().toISOString(),
    stock: { perAlbum: Object.fromEntries(perAlbumRows.results.map((row) => [row.id, { live: row.live, total: row.total }])), holosLeft: holo?.count ?? 0 },
    nextRestock: 'Friday 8pm MYT',
  };
}

export function funding(env: Env, wallet: string, faucet?: { asset: 'USDC'; amount: number; claimed: boolean; wallet?: string }) {
  return { methods: ['transfer'], assets: enabledAssets(env), network: 'solana', minimum: 0, depositAddress: wallet,
    ...(faucet ? { faucet } : {}) };
}
