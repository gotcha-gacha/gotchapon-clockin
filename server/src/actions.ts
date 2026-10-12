import { getIdempotent, putIdempotent, randomId } from './db';
import { ApiError } from './http';
import {
  alreadyClaimed, giftConfig, houseSigner, liveTcgClient, matchSentGift, receiverAddress, safeOpenUrl,
  signGiftTransaction, unavailable, type GeneratedGift, type SentGift, type TcgGiftClient,
} from './jupiterGift';
import type { Env } from './types';

const BASE = 1_000_000;
const GENERATE_HOLD_MS = 30_000;

type GiftView = {
  status: 'confirmed';
  packType: string;
  count: 1;
  giftId: string;
  signature: string;
  receiver: string;
  openUrl: string;
};

type ClaimResponse = { outcomes: []; gift: GiftView };

type GiftRow = {
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  receiver: string;
  sender: string | null;
  pack_type: string;
  count: number;
  gift_id: string | null;
  memo: string | null;
  unsigned_tx: string | null;
  tx_signature: string | null;
  total_cost: string | null;
  open_url: string | null;
  updated_at: string;
  confirmed_at: string | null;
  /** Bumped by every takeover: the compare-and-set's token, which no two takers can both match. */
  attempt: number;
};

function giftResponse(row: GiftRow, openUrl: string): ClaimResponse {
  return {
    outcomes: [],
    gift: {
      status: 'confirmed',
      packType: row.pack_type,
      count: 1,
      giftId: row.gift_id ?? '',
      signature: row.tx_signature ?? '',
      receiver: row.receiver,
      openUrl,
    },
  };
}

function isConfirmed(row: GiftRow | null): row is GiftRow & { gift_id: string; tx_signature: string } {
  return !!row && row.status === 'confirmed' && !!row.gift_id && !!row.tx_signature;
}

async function readGift(db: D1Database, userId: string, albumId: string): Promise<GiftRow | null> {
  return db.prepare(`SELECT status, receiver, sender, pack_type, count, gift_id, memo, unsigned_tx, tx_signature,
      total_cost, open_url, updated_at, confirmed_at, attempt
    FROM jupiter_gift_claims WHERE user_id = ? AND album_id = ?`)
    .bind(userId, albumId).first<GiftRow>();
}

function remember(db: D1Database, userId: string, idem: string, response: ClaimResponse, now: string, hadPrior: boolean) {
  if (hadPrior) {
    return db.prepare(`UPDATE idempotency SET response_json = ? WHERE user_id = ? AND operation = 'completion' AND idem = ?`)
      .bind(JSON.stringify(response), userId, idem);
  }
  return putIdempotent(db, userId, 'completion', idem, response, now);
}

async function confirmedCount(db: D1Database, receiver: string, packType: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM jupiter_gift_claims
    WHERE receiver = ? AND pack_type = ? AND status = 'confirmed'`).bind(receiver, packType).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Album complete → one house-funded Jupiter gift (#402). No completion holo.
 * `claimed_at` moves only in the batch that stores gift id and signature.
 * A mash, or a retry after submit landed and D1 did not, reconciles the house's sent gifts
 * before generate runs again.
 */
export async function claimCompletion(
  db: D1Database,
  env: Env,
  userId: string,
  albumId: string,
  idem: string,
  client: TcgGiftClient = liveTcgClient(env),
): Promise<ClaimResponse> {
  try {
    return await claimGift(db, env, userId, albumId, idem, client);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('jupiter gift claim failed', error instanceof Error ? error.message : 'unknown');
    throw unavailable('claim failed');
  }
}

async function claimGift(db: D1Database, env: Env, userId: string, albumId: string, idem: string, client: TcgGiftClient): Promise<ClaimResponse> {
  const prior = await getIdempotent<ClaimResponse>(db, userId, 'completion', idem);
  if (prior?.gift?.status === 'confirmed' && prior.gift.signature && prior.gift.giftId) return prior;

  const completion = await db.prepare('SELECT claimed_at FROM album_completions WHERE user_id = ? AND album_id = ?')
    .bind(userId, albumId).first<{ claimed_at: string | null }>();
  if (!completion) throw new ApiError('UNKNOWN', 'That album is not complete');

  const existing = await readGift(db, userId, albumId);
  if (isConfirmed(existing)) return finish(db, userId, idem, giftResponse(existing, safeOpenUrl(existing.open_url)), prior != null);

  // A holo claimed before this path, or a claimed_at with no stored gift, is not bought again.
  if (completion.claimed_at) throw alreadyClaimed();

  const config = giftConfig(env);
  if (!config.enabled) throw unavailable(config.reason);
  try { await houseSigner(config.secret, config.sender); }
  catch { throw unavailable('house sender does not match'); }

  const user = await db.prepare('SELECT wallet FROM users WHERE id = ?').bind(userId).first<{ wallet: string }>();
  const receiver = receiverAddress(user?.wallet);
  if (!receiver) throw unavailable('receiver wallet is not configured');

  const now = new Date().toISOString();
  let row = existing;
  if (!row) {
    try {
      await db.prepare(`INSERT INTO jupiter_gift_claims
        (user_id, album_id, status, receiver, sender, pack_type, count, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?, ?, 1, ?, ?)`)
        .bind(userId, albumId, receiver, config.sender, config.packType, now, now).run();
    } catch {
      const raced = await readGift(db, userId, albumId);
      if (isConfirmed(raced)) return finish(db, userId, idem, giftResponse(raced, safeOpenUrl(raced.open_url)), prior != null);
      throw unavailable('another claim is in progress');
    }
    row = await readGift(db, userId, albumId);
    if (!row) throw unavailable('gift row was not stored');
  }

  if (row.gift_id || row.memo) {
    const settled = await reconcile(db, client, userId, albumId, row, idem, prior != null);
    if (settled) return settled;
  }
  if (row.unsigned_tx && row.memo) return submitStored(db, client, userId, albumId, row, idem, prior != null, config);

  if (row.memo || row.gift_id || row.unsigned_tx) throw unavailable('gift is waiting to be reconciled');
  const age = Date.now() - Date.parse(row.updated_at);
  // Owner = this request saw no row and its INSERT succeeded. A timestamp cannot say so: a racing claim in the owner's
  // millisecond reads the same `updated_at` as its own `now`.
  const ownedInsert = !existing;
  // The attempt this claim owns: the INSERT's 0, or the one its takeover moves the row to. Its failure fails only that attempt.
  const attempt = ownedInsert ? 0 : row.attempt + 1;
  if (!ownedInsert && row.status === 'pending' && Number.isFinite(age) && age < GENERATE_HOLD_MS) {
    throw unavailable('another claim is in progress');
  }
  if (!ownedInsert) {
    // Compare-and-set on `attempt`, not `updated_at`: a takeover in the millisecond it compared writes the same timestamp
    // back, and a second taker's UPDATE still matches. Each takeover moves `attempt`, so only one can match what it read.
    const taken = await db.prepare(`UPDATE jupiter_gift_claims
      SET status = 'pending', receiver = ?, sender = ?, pack_type = ?, updated_at = ?, attempt = attempt + 1
      WHERE user_id = ? AND album_id = ? AND status IN ('pending', 'failed')
        AND memo IS NULL AND unsigned_tx IS NULL AND tx_signature IS NULL AND attempt = ?`)
      .bind(receiver, config.sender, config.packType, now, userId, albumId, row.attempt).run();
    if ((taken.meta?.changes ?? 0) !== 1) throw unavailable('another claim is in progress');
  }

  // A retry that never stored a memo must not generate if Jupiter already shows a gifted pack we did not record.
  if (existing && !existing.memo && !existing.unsigned_tx && !existing.gift_id) {
    const ahead = await client.giftedCount(receiver, config.packType);
    if (ahead != null && ahead > await confirmedCount(db, receiver, config.packType)) {
      throw unavailable('a gift may already have landed');
    }
  }

  let generated: GeneratedGift;
  try { generated = await client.generateGift({ sender: config.sender, receiver, packType: config.packType, count: 1 }); }
  catch (error) {
    await markFailed(db, userId, albumId, attempt);
    if (error instanceof ApiError) throw error;
    throw unavailable('generate failed');
  }
  if ((generated.count != null && generated.count !== 1) || (generated.packType != null && generated.packType !== config.packType)) {
    await markFailed(db, userId, albumId, attempt);
    throw unavailable('generate did not match the locked pack');
  }
  const giftId = generated.giftId || generated.memo;
  const stored = await db.prepare(`UPDATE jupiter_gift_claims
    SET memo = ?, unsigned_tx = ?, gift_id = ?, total_cost = ?, open_url = ?, receiver = ?, sender = ?, pack_type = ?, updated_at = ?
    WHERE user_id = ? AND album_id = ? AND status IN ('pending', 'failed') AND tx_signature IS NULL AND memo IS NULL`)
    .bind(generated.memo, generated.transaction, giftId, generated.totalCost ?? null, config.openUrl, receiver, config.sender, config.packType, new Date().toISOString(), userId, albumId)
    .run();
  if ((stored.meta?.changes ?? 0) !== 1) {
    const current = await readGift(db, userId, albumId);
    if (isConfirmed(current)) return finish(db, userId, idem, giftResponse(current, safeOpenUrl(current.open_url)), prior != null);
    if (current?.unsigned_tx && current.memo) return submitStored(db, client, userId, albumId, current, idem, prior != null, config);
    throw unavailable('gift transaction was not stored');
  }
  const ready = await readGift(db, userId, albumId);
  if (!ready?.unsigned_tx || !ready.memo) throw unavailable('gift transaction was not stored');
  return submitStored(db, client, userId, albumId, ready, idem, prior != null, config);
}

async function reconcile(
  db: D1Database, client: TcgGiftClient, userId: string, albumId: string, row: GiftRow, idem: string, hadPrior: boolean,
): Promise<ClaimResponse | null> {
  const sender = row.sender;
  if (!sender) return null;
  let sent: SentGift[];
  try { sent = await client.listSentGifts(sender); }
  catch { return null; }
  const match = matchSentGift(row, sent);
  if (!match?.txSignature) return null;
  return persist(db, userId, albumId, idem, hadPrior, {
    ...row,
    gift_id: match.giftId || row.gift_id || match.memo || row.memo,
    memo: row.memo ?? match.memo ?? null,
    tx_signature: match.txSignature,
    total_cost: row.total_cost ?? match.cost ?? null,
    pack_type: row.pack_type,
  });
}

async function submitStored(
  db: D1Database,
  client: TcgGiftClient,
  userId: string,
  albumId: string,
  row: GiftRow,
  idem: string,
  hadPrior: boolean,
  config: { secret: string; sender: string; openUrl: string },
): Promise<ClaimResponse> {
  if (!row.unsigned_tx || !row.memo || !row.gift_id) throw unavailable('gift transaction is incomplete');
  const again = await reconcile(db, client, userId, albumId, row, idem, hadPrior);
  if (again) return again;
  let signed: { signedTransaction: string; signature: string };
  try { signed = await signGiftTransaction(config.secret, config.sender, row.unsigned_tx); }
  catch { throw unavailable('gift transaction could not be signed'); }
  await db.prepare(`UPDATE jupiter_gift_claims SET status = 'submitted', updated_at = ?
    WHERE user_id = ? AND album_id = ? AND tx_signature IS NULL`)
    .bind(new Date().toISOString(), userId, albumId).run();
  try {
    const submitted = await client.submitGift({ signedTransaction: signed.signedTransaction, memo: row.memo });
    if (submitted.signature !== signed.signature) throw unavailable('submit signature did not match the signed gift');
  } catch (error) {
    const landed = await reconcile(db, client, userId, albumId, row, idem, hadPrior);
    if (landed) return landed;
    // A stored memo stops every takeover (they require `memo IS NULL`), so the row's attempt is the one that stored it.
    await markFailed(db, userId, albumId, row.attempt);
    if (error instanceof ApiError) throw error;
    throw unavailable('submit failed');
  }
  return persist(db, userId, albumId, idem, hadPrior, { ...row, tx_signature: signed.signature, open_url: row.open_url ?? config.openUrl });
}

async function persist(
  db: D1Database, userId: string, albumId: string, idem: string, hadPrior: boolean,
  row: GiftRow & { tx_signature: string | null; gift_id: string | null },
): Promise<ClaimResponse> {
  if (!row.gift_id || !row.tx_signature) throw unavailable('gift id or signature missing');
  const now = new Date().toISOString();
  const openUrl = safeOpenUrl(row.open_url);
  const response = giftResponse({ ...row, status: 'confirmed', open_url: openUrl }, openUrl);
  try {
    await db.batch([
      db.prepare(`UPDATE jupiter_gift_claims
        SET status = 'confirmed', gift_id = ?, memo = ?, tx_signature = ?, total_cost = ?, open_url = ?, confirmed_at = ?, updated_at = ?
        WHERE user_id = ? AND album_id = ? AND status != 'confirmed'`)
        .bind(row.gift_id, row.memo, row.tx_signature, row.total_cost, openUrl, now, now, userId, albumId),
      db.prepare('UPDATE album_completions SET claimed_at = ? WHERE user_id = ? AND album_id = ? AND claimed_at IS NULL')
        .bind(now, userId, albumId),
      remember(db, userId, idem, response, now, hadPrior),
    ]);
  } catch {
    const current = await readGift(db, userId, albumId);
    if (isConfirmed(current)) return finish(db, userId, idem, giftResponse(current, safeOpenUrl(current.open_url)), true);
    throw unavailable('gift was submitted but not stored');
  }
  const current = await readGift(db, userId, albumId);
  if (!isConfirmed(current)) throw unavailable('gift was submitted but not stored');
  return giftResponse(current, safeOpenUrl(current.open_url));
}

async function finish(db: D1Database, userId: string, idem: string, response: ClaimResponse, hadPrior: boolean): Promise<ClaimResponse> {
  const now = new Date().toISOString();
  try { await remember(db, userId, idem, response, now, hadPrior).run(); }
  catch { /* this idem was stored by the confirm batch, or by a concurrent replay */ }
  return response;
}

/** Fails only `attempt`: an owner whose generate fails after a takeover must not free the taker's row for a third claim. */
async function markFailed(db: D1Database, userId: string, albumId: string, attempt: number) {
  await db.prepare(`UPDATE jupiter_gift_claims SET status = 'failed', updated_at = ?
    WHERE user_id = ? AND album_id = ? AND status != 'confirmed' AND tx_signature IS NULL AND attempt = ?`)
    .bind(new Date().toISOString(), userId, albumId, attempt).run();
}

/** A uniform integer in [0, maxExclusive), rejection-sampled from 32 random bits: no modulo or float bias (#277; the pulls'
 *  RandomOracle.index does the same over its VRF output). */
export function uniformIndex(maxExclusive: number, random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
    throw new Error('random index bound is invalid');
  }
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  for (;;) {
    const value = random();
    if (value < limit) return value % maxExclusive;
  }
}

type BurnableItem = { id: string };

/** Five extras become one free pull (`free_common`): no card, no paid-pull credit, no streak day (#294, #376). The pull
 *  itself is a later crank. It uses the free-odds table and can fill an album. */
export async function burnExtras(
  db: D1Database,
  userId: string,
  idem: string,
  // The `balances` table is the mock's ledger; on a real RPC it holds nothing, so a burn there answers no balance and the app
  // re-reads the wallet (#277).
  withLedgerBalance = true,
) {
  const prior = await getIdempotent<Record<string, unknown>>(db, userId, 'burn', idem);
  if (prior) return prior;
  const extras = await db.prepare(`SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY acquired_at, id) AS copy_number
    FROM user_inventory WHERE user_id = ? AND tier = 'common' AND status = 'owned'
  ) WHERE copy_number > 1 ORDER BY id`).bind(userId).all<BurnableItem>();
  if (extras.results.length < 5) throw new ApiError('UNKNOWN', 'You need 5 extras to burn');
  const burned = extras.results.slice(0, 5);
  const now = new Date().toISOString();
  const burnId = randomId('burn');
  const user = await db.prepare('SELECT free_paid + free_common AS free_pulls FROM users WHERE id = ?')
    .bind(userId).first<{ free_pulls: number }>();
  if (!user) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);
  let balance: { usdc: number; usdt: number; pulls: number } | undefined;
  if (withLedgerBalance) {
    const balanceRows = await db.prepare('SELECT asset, amount FROM balances WHERE user_id = ?')
      .bind(userId).all<{ asset: string; amount: number }>();
    const amounts = Object.fromEntries(balanceRows.results.map((row) => [row.asset, row.amount]));
    balance = {
      usdc: amounts.USDC ?? 0, usdt: amounts.USDT ?? 0,
      pulls: Math.floor(((amounts.USDC ?? 0) + (amounts.USDT ?? 0)) / BASE),
    };
  }
  // `free_common` is the burn credit. `free_paid` is the paid-odds bucket and is not touched.
  const response = {
    extras: extras.results.length - 5,
    freePulls: user.free_pulls + 1,
    ...(balance ? { balance } : {}),
  };
  const statements: D1PreparedStatement[] = [
    ...burned.map((item) => db.prepare(`INSERT INTO inventory_consumptions
      (inventory_item_id, operation_id, consumed_at) VALUES (?, ?, ?)`).bind(item.id, burnId, now)),
    db.prepare('UPDATE users SET free_common = free_common + 1 WHERE id = ?').bind(userId),
    putIdempotent(db, userId, 'burn', idem, response, now),
  ];
  try { await db.batch(statements); }
  catch {
    const winner = await getIdempotent<Record<string, unknown>>(db, userId, 'burn', idem);
    if (winner) return winner;
    throw new ApiError('UNKNOWN', 'Inventory changed while burning; retry', 409);
  }
  return response;
}
