import { bool, asInt, dayKey, randomId } from './db';
import { announceRecordedCompletion, recordCompletionIfFull } from './completion';
import { ApiError, requiredString } from './http';
import {
  broadcastPaymentTransaction,
  preparePaymentWithLifetime,
  PaymentOutcome,
  paymentState,
  enabledAssets,
  sponsorPaymentTransaction,
  verifyPayment,
  walletBalance,
} from './payments';
import { normalizeClientSeed, provingKey, RandomOracle, resolveVrf } from './randomness';
import { awaitDraw, failDraw, freezePool, wantsMagicBlock } from './draw';
import { drawConfig } from './drawChain';
import { deriveSlots, type FrozenPool } from './drawDerive';
import { DRAWABLE_SQL, finiteDecrement } from './stock';
import { advancePaidStreak, readStreak, seasonStreakStatements, seasonTicketCount, seasonTicketStatements, ticketsEarnedForPull, visibleStreak } from './season';
import type { Asset, Env, InventoryCard, Outcome, PullCount, PullRow, Tier } from './types';

const BASE = 1_000_000;

type GachaRow = {
  id: string;
  album_id: string | null;
  supports_targeted: number;
  inventory_version: number;
  paid_odds_config_id: string;
  free_odds_config_id: string;
  price_base: number;
  targeted_price_base: number;
};

type WeightedTier = { tier: Tier; weight: number };

function card(row: InventoryCard) {
  return { id: row.id, name: row.name, set: row.set_name, number: row.number, imgSmall: row.image_small, imgLarge: row.image_large };
}

async function oddsTiers(db: D1Database, configId: string): Promise<WeightedTier[]> {
  const config = await db.prepare('SELECT total_weight FROM odds_configs WHERE id = ?').bind(configId)
    .first<{ total_weight: number }>();
  const rows = await db.prepare(`SELECT tier, weight FROM odds_config_tiers
    WHERE odds_config_id = ? AND weight > 0 ORDER BY sort_order`).bind(configId).all<WeightedTier>();
  const total = rows.results.reduce((sum, row) => sum + row.weight, 0);
  if (!config || rows.results.length === 0 || total !== config.total_weight) {
    throw new ApiError('UNKNOWN', 'This gacha has an invalid odds configuration', 503);
  }
  return rows.results;
}

async function selectTier(oracle: RandomOracle, rows: WeightedTier[], draw: number): Promise<Tier> {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const value = await oracle.index(total, draw, 'tier');
  let cursor = 0;
  for (const row of rows) {
    cursor += row.weight;
    if (value < cursor) return row.tier;
  }
  throw new Error('odds weights did not resolve');
}

async function pullById(db: D1Database, userId: string, id: string): Promise<PullRow> {
  const row = await db.prepare('SELECT * FROM pulls WHERE id = ? AND user_id = ?').bind(id, userId).first<PullRow>();
  if (!row) throw new ApiError('EXPIRED', 'That pull was not found', 404);
  return row;
}

async function expirePreparedPull(db: D1Database, pull: PullRow, now: string): Promise<boolean> {
  if (pull.status !== 'prepared' || pull.tx_signature || pull.expires_at > now) return false;
  const eligible = `id = ? AND user_id = ? AND status = 'prepared'
    AND tx_signature IS NULL AND expires_at <= ?`;
  try {
    await db.batch([
      db.prepare(`UPDATE users SET free_paid = free_paid + ?, free_common = free_common + ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM pulls WHERE ${eligible})`)
        .bind(pull.reserved_paid, pull.reserved_common, pull.user_id, pull.id, pull.user_id, now),
      db.prepare(`INSERT INTO pull_settlements (pull_id, kind, created_at)
        SELECT id, 'expired', ? FROM pulls WHERE ${eligible}`)
        .bind(now, pull.id, pull.user_id, now),
      db.prepare(`UPDATE pulls SET status = 'expired', resolved_at = ? WHERE ${eligible}`)
        .bind(now, pull.id, pull.user_id, now),
    ]);
  } catch { /* a concurrent signature pin or settlement is authoritative */ }
  return (await pullById(db, pull.user_id, pull.id)).status === 'expired';
}

export async function expireFailedPaymentAuthorization(
  db: D1Database,
  pull: PullRow,
  signature: string,
  now: string,
): Promise<void> {
  const eligible = `id = ? AND user_id = ? AND status = 'prepared' AND tx_signature = ?
    AND NOT EXISTS (SELECT 1 FROM payment_receipts WHERE pull_id = pulls.id)`;
  try {
    await db.batch([
      db.prepare(`UPDATE users SET free_paid = free_paid + ?, free_common = free_common + ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM pulls WHERE ${eligible})`)
        .bind(pull.reserved_paid, pull.reserved_common, pull.user_id,
          pull.id, pull.user_id, signature),
      db.prepare(`INSERT INTO pull_settlements (pull_id, kind, created_at)
        SELECT id, 'expired', ? FROM pulls WHERE ${eligible}`)
        .bind(now, pull.id, pull.user_id, signature),
      db.prepare(`UPDATE pulls SET status = 'expired', resolved_at = ? WHERE ${eligible}`)
        .bind(now, pull.id, pull.user_id, signature),
    ]);
  } catch { /* a confirmed receipt or concurrent settlement wins */ }
}

/** How long one request may spend asking the chain about its user's pinned pulls. The sweep runs in front of every
 *  authenticated request but commit, and each RPC call has its own 8 s cap, so without a budget for the whole loop a hung RPC
 *  held `/me` and prepare for 5 pulls × up to 3 calls × 8 s, past the app's 30 s timeout (PR #298's overall review: 2 pinned
 *  pulls and a hung RPC took 16 s). Releasing a pull one request late is harmless. */
export const PINNED_SWEEP_BUDGET_MS = 2_000;

/** Release abandoned reservations opportunistically on the user's next request. A paid pull whose signature has reached
 * the API is pinned, and is released only once the chain says its payment can never move money (#273): it failed on
 * chain, or its blockhash expired with no status. Until then it stays safely retryable. Pinned pulls are checked only
 * with `env` and a real payment RPC, a few at a time within `PINNED_SWEEP_BUDGET_MS`, and an RPC failure or a spent budget
 * leaves them for the next request. */
export async function expireAbandonedPulls(db: D1Database, userId: string, at = new Date(), env?: Env,
  budgetMs = PINNED_SWEEP_BUDGET_MS): Promise<void> {
  const now = at.toISOString();
  const rows = await db.prepare(`SELECT * FROM pulls WHERE user_id = ? AND status = 'prepared'
    AND tx_signature IS NULL AND expires_at <= ? ORDER BY expires_at LIMIT 100`)
    .bind(userId, now).all<PullRow>();
  for (const pull of rows.results) await expirePreparedPull(db, pull, now);
  if (env?.PAYMENTS_MODE !== 'solana-rpc') return;
  // This half runs in front of every signed-in request but commit, so its failure (a schema slip: a deploy ahead of its
  // ALTER, PR #311's review) turns the sweep off for that request rather than failing the request. Nothing is released.
  let pinned: D1Result<PullRow>;
  try {
    pinned = await db.prepare(`SELECT * FROM pulls WHERE user_id = ? AND status = 'prepared'
      AND tx_signature IS NOT NULL AND payment_last_valid_block_height IS NOT NULL AND expires_at <= ?
      AND NOT EXISTS (SELECT 1 FROM payment_receipts WHERE pull_id = pulls.id)
      ORDER BY payment_checked_at IS NOT NULL, payment_checked_at, expires_at LIMIT 5`)
      .bind(userId, now).all<PullRow>();
  } catch (error) {
    console.error('pinned-pull sweep could not read its pulls', error);
    return;
  }
  const deadline = Date.now() + budgetMs;
  for (const pull of pinned.results) {
    const left = deadline - Date.now();
    if (left <= 0) return;
    try {
      // A read that outlives the budget is abandoned: it only reads, and nothing is released on its behalf.
      const state = await withinBudget(paymentState(env, pull.tx_signature!, pull.payment_last_valid_block_height), left);
      if (state === 'failed' || state === 'expired') await expireFailedPaymentAuthorization(db, pull, pull.tx_signature!, now);
    } catch { /* the RPC is unavailable: the next request asks again */ }
    // Asked, whatever the answer: the next sweep starts with pulls asked about less recently (#306).
    await db.prepare('UPDATE pulls SET payment_checked_at = ? WHERE id = ?').bind(new Date().toISOString(), pull.id).run()
      .catch(() => { /* the rotation is best-effort; the next sweep asks again */ });
  }
}

function withinBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('sweep budget spent')), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A pinned pull committed without its signed bytes: the signature to verify if the payment landed, or the outcome that
 *  ends it. Releases the reservation only when the chain says the payment can never move money. */
async function resolvePinnedPayment(env: Env, db: D1Database, pull: PullRow): Promise<string> {
  const signature = pull.tx_signature!;
  const state = await paymentState(env, signature, pull.payment_last_valid_block_height);
  if (state === 'confirmed') return signature;
  if (state === 'failed' || state === 'expired') {
    await expireFailedPaymentAuthorization(db, pull, signature, new Date().toISOString());
    throw state === 'failed'
      ? new PaymentOutcome('TX_MISMATCH', 'The payment did not go through. Nothing was charged.', true)
      : new PaymentOutcome('EXPIRED', 'The signed payment authorization expired', true);
  }
  throw new ApiError('TX_NOT_FOUND', 'We could not see your payment yet; retry safely', 503);
}

async function pinPaymentSignature(db: D1Database, pull: PullRow, signature: string): Promise<PullRow> {
  try {
    await db.prepare(`UPDATE pulls SET tx_signature = ? WHERE id = ? AND user_id = ?
      AND status = 'prepared' AND (tx_signature IS NULL OR tx_signature = ?)`)
      .bind(signature, pull.id, pull.user_id, signature).run();
  } catch {
    const owner = await db.prepare('SELECT id FROM pulls WHERE tx_signature = ?').bind(signature).first<{ id: string }>();
    if (owner?.id !== pull.id) throw new ApiError('TX_MISMATCH', 'That payment was already used');
  }
  const pinned = await pullById(db, pull.user_id, pull.id);
  if (pinned.status !== 'prepared') throw new ApiError('EXPIRED', 'That pull timed out');
  if (pinned.tx_signature !== signature) throw new ApiError('TX_MISMATCH', 'That pull has a different payment');
  return pinned;
}

async function recordConfirmedPayment(
  db: D1Database,
  pull: PullRow,
  payment: Awaited<ReturnType<typeof verifyPayment>>,
): Promise<void> {
  const existing = await db.prepare(`SELECT signature, pull_id, asset, amount, destination, slot
    FROM payment_receipts WHERE pull_id = ? OR signature = ?`)
    .bind(pull.id, payment.signature).first<{
      signature: string; pull_id: string; asset: Asset; amount: number; destination: string; slot: number;
    }>();
  if (existing) {
    if (existing.pull_id !== pull.id || existing.signature !== payment.signature
      || existing.asset !== pull.asset || existing.amount !== pull.cost_base
      || existing.destination !== payment.destination || existing.slot !== payment.slot) {
      throw new ApiError('TX_MISMATCH', 'That payment was already used');
    }
    return;
  }
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO payment_receipts
        (signature, pull_id, asset, amount, destination, slot, finalized_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(payment.signature, pull.id, pull.asset, pull.cost_base, payment.destination, payment.slot, now),
      db.prepare(`INSERT INTO payment_obligations
        (pull_id, signature, status, reason, created_at, updated_at)
        VALUES (?, ?, 'pending', 'awaiting_allocation', ?, ?)`)
        .bind(pull.id, payment.signature, now, now),
      db.prepare(`UPDATE pulls SET tx_signature = ?
        WHERE id = ? AND status = 'prepared' AND (tx_signature IS NULL OR tx_signature = ?)`)
        .bind(payment.signature, pull.id, payment.signature),
    ]);
  } catch {
    const winner = await db.prepare(`SELECT signature, pull_id, asset, amount, destination, slot
      FROM payment_receipts WHERE pull_id = ? OR signature = ?`)
      .bind(pull.id, payment.signature).first<{
        signature: string; pull_id: string; asset: Asset; amount: number; destination: string; slot: number;
      }>();
    if (winner?.pull_id === pull.id && winner.signature === payment.signature
      && winner.asset === pull.asset && winner.amount === pull.cost_base
      && winner.destination === payment.destination && winner.slot === payment.slot) return;
    throw new ApiError('UNKNOWN', 'The confirmed payment is waiting to be recorded; retry safely', 503);
  }
}

async function markPaymentPending(db: D1Database, pullId: string, error: unknown): Promise<void> {
  const reason = error instanceof ApiError ? error.code : 'UNKNOWN';
  try {
    await db.prepare(`UPDATE payment_obligations SET status = 'pending', reason = ?, updated_at = ?
      WHERE pull_id = ? AND status = 'pending'`)
      .bind(reason, new Date().toISOString(), pullId).run();
  } catch { /* preserving the original settlement error is more useful to the caller */ }
}

export async function preparePull(db: D1Database, env: Env, userId: string, input: Record<string, unknown>, idem: string,
  retried = false): Promise<ReturnType<typeof prepareResponse>> {
  const count = asInt(input.count, 'count', [1, 5, 10]) as PullCount;
  const targeted = bool(input.targeted, 'targeted');
  const asset = requiredString(input.asset, 'asset') as Asset;
  const requestedAlbumId = typeof input.albumId === 'string' && input.albumId ? input.albumId : null;
  const requestedGachaId = requiredString(input.gachaId, 'gachaId');
  if (!enabledAssets(env).includes(asset)) throw new ApiError('UNKNOWN', 'Invalid asset');
  provingKey(env); // before anything is reserved or a payment built: commit could not resolve this pull otherwise (#274)
  if (env.ENVIRONMENT === 'production' && input.clientSeed === undefined) {
    throw new ApiError('UNKNOWN', 'clientSeed is required', 400);
  }
  const seed = normalizeClientSeed(input.clientSeed);

  if (requestedAlbumId) {
    const requestedAlbum = await db.prepare('SELECT status FROM albums WHERE id = ?')
      .bind(requestedAlbumId).first<{ status: string }>();
    if (!requestedAlbum) throw new ApiError('UNKNOWN', 'No such album', 404);
    if (requestedAlbum.status !== 'live') throw new ApiError('RESTOCKING', 'That album is not open yet');
  }

  const user = await db.prepare('SELECT wallet, free_paid, free_common FROM users WHERE id = ?').bind(userId)
    .first<{ wallet: string; free_paid: number; free_common: number }>();
  if (!user) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);
  const existing = await db.prepare('SELECT * FROM pulls WHERE user_id = ? AND idem = ?').bind(userId, idem).first<PullRow>();
  if (existing) return replayPrepare(existing, { count, targeted, asset, gachaId: requestedGachaId }, env);

  const gacha = await db.prepare(`SELECT id, album_id, supports_targeted, inventory_version, paid_odds_config_id,
    free_odds_config_id, price_base, targeted_price_base FROM gachas WHERE id = ? AND status = 'active'`)
    .bind(requestedGachaId).first<GachaRow>();
  if (!gacha) throw new ApiError('RESTOCKING', 'That gacha is not available');
  if (requestedAlbumId && gacha.album_id !== requestedAlbumId) {
    throw new ApiError('UNKNOWN', 'That gacha does not belong to the selected album');
  }
  if (targeted && !gacha.supports_targeted) {
    throw new ApiError('UNKNOWN', 'That gacha does not support album pulls');
  }
  const albumId = gacha.album_id;

  if (albumId) {
    const album = await db.prepare('SELECT status FROM albums WHERE id = ?').bind(albumId).first<{ status: string }>();
    if (!album) throw new ApiError('UNKNOWN', 'No such album', 404);
    if (album.status !== 'live') throw new ApiError('RESTOCKING', 'That album is not open yet');
  }
  const usePaid = targeted ? 0 : Math.min(user.free_paid, count);
  const useCommon = targeted ? 0 : Math.min(user.free_common, count - usePaid);
  const paidCount = count - usePaid - useCommon;
  const costBase = paidCount * (targeted ? gacha.targeted_price_base : gacha.price_base);
  await assertInventoryCapacity(db, gacha, useCommon, count - useCommon);
  const funds = env.PAYMENTS_MODE === 'solana-rpc'
    ? (await walletBalance(env, user.wallet))[asset.toLowerCase() as 'usdc' | 'usdt']
    : (await db.prepare('SELECT amount FROM balances WHERE user_id = ? AND asset = ?').bind(userId, asset).first<{ amount: number }>())?.amount ?? 0;
  if (funds < costBase) throw new ApiError('INSUFFICIENT_FUNDS', 'Out of pulls', 402, `Add ${asset} to keep going`);
  // A paid $1 pull draws from MagicBlock when the switch is on (#406): its pool is frozen and hashed now, before any random
  // byte exists, and the draw settings are checked before anyone is asked to pay.
  let frozen: { json: string; hash: string } | null = null;
  if (wantsMagicBlock(env, { cost_base: costBase, targeted: targeted ? 1 : 0 })) {
    drawConfig(env);
    const [paidOdds, freeOdds] = await Promise.all([oddsTiers(db, gacha.paid_odds_config_id), oddsTiers(db, gacha.free_odds_config_id)]);
    frozen = await freezePool(db, gacha, { count, reservedPaid: usePaid, reservedCommon: useCommon }, paidOdds, freeOdds,
      DRAWABLE_SQL);
    // Decision (Ben, 6 Oct 2026; #406): a pool holding finite stock stays on the server proof. Said out loud, so a switched-on
    // MagicBlock that draws nothing is seen, not silent.
    if (!frozen) console.warn('MagicBlock draw is on, but this pull stays on the server proof: its pool holds finite stock',
      { gachaId: gacha.id, inventoryVersion: gacha.inventory_version });
  }

  const now = new Date();
  const pullId = randomId('pull');
  const payment = costBase > 0 && env.PAYMENTS_MODE === 'solana-rpc'
    ? await preparePaymentWithLifetime(env, { wallet: user.wallet, memo: pullId, asset, amount: costBase })
    : null;
  const pull: PullRow = {
    id: pullId, user_id: userId, idem, sequence: 0, gacha_id: gacha.id,
    inventory_version: gacha.inventory_version,
    album_id: albumId, odds_config_id: gacha.paid_odds_config_id,
    free_odds_config_id: gacha.free_odds_config_id, client_seed: seed.value, seed_source: seed.source,
    count, targeted: targeted ? 1 : 0, asset,
    cost_base: costBase, reserved_paid: usePaid, reserved_common: useCommon, status: 'prepared',
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    payment_transaction_base64: payment?.transactionBase64 ?? null,
    payment_last_valid_block_height: payment?.lastValidBlockHeight ?? null, tx_signature: null,
    vrf_public_key: null, vrf_input: null, vrf_proof: null, vrf_output: null,
    draw_source: frozen ? 'magicblock' : 'ecvrf', pool_json: frozen?.json ?? null, pool_hash: frozen?.hash ?? null,
    draw_account: null, draw_request_signature: null, draw_requested_at: null, draw_randomness: null, draw_failed_at: null,
    draw_fulfil_signature: null,
    resolved_at: null,
    response_json: null, created_at: now.toISOString(),
  };
  // Only a MagicBlock pull names #406's columns: a server-proof pull leaves them to their defaults, so a Worker deployed with
  // the switch off still prepares on a D1 that scripts/magicblock-draw.sql has not reached yet (PR #410's review).
  const drawColumns = frozen ? ',\n        draw_source, pool_json, pool_hash' : '';
  const drawValues = frozen ? ', ?, ?, ?' : '';
  const drawBinds = frozen ? [pull.draw_source, pull.pool_json, pull.pool_hash] : [];
  try {
    await db.batch([
      db.prepare('UPDATE users SET free_paid = free_paid - ?, free_common = free_common - ? WHERE id = ?').bind(usePaid, useCommon, userId),
      db.prepare('UPDATE gacha_state SET next_pull_sequence = next_pull_sequence + 1 WHERE singleton = 1'),
      db.prepare(`INSERT INTO pulls (id, user_id, idem, sequence, gacha_id, inventory_version, album_id, odds_config_id,
        free_odds_config_id, client_seed, seed_source, count, targeted, asset, cost_base, reserved_paid,
        reserved_common, status, expires_at, payment_transaction_base64, payment_last_valid_block_height, created_at${drawColumns})
        VALUES (?, ?, ?, (SELECT next_pull_sequence - 1 FROM gacha_state WHERE singleton = 1),
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?${drawValues})`)
        .bind(pull.id, userId, idem, gacha.id, gacha.inventory_version, albumId, pull.odds_config_id,
          pull.free_odds_config_id, pull.client_seed, pull.seed_source, count, pull.targeted, asset, costBase,
          usePaid, useCommon, pull.expires_at, pull.payment_transaction_base64, pull.payment_last_valid_block_height, pull.created_at,
          ...drawBinds),
    ]);
  } catch (error) {
    const winner = await db.prepare('SELECT * FROM pulls WHERE user_id = ? AND idem = ?').bind(userId, idem).first<PullRow>();
    if (winner) return replayPrepare(winner, { count, targeted, asset, gachaId: requestedGachaId }, env);
    // No pull under this key: another prepare took the free pulls this one priced in, between the read above and this batch
    // (the users row's CHECK (free_paid >= 0) refused it). A §2 answer, not a raw 500 (#277, reproduced: 3 of 4 racing prepares).
    const now = await db.prepare('SELECT free_paid, free_common FROM users WHERE id = ?').bind(userId)
      .first<{ free_paid: number; free_common: number }>();
    if (now && (now.free_paid < usePaid || now.free_common < useCommon)) {
      throw new ApiError('UNKNOWN', 'Your free pulls changed while this pull was being prepared. Try again.', 409);
    }
    // The counts look sufficient now: something released a reservation between the failure and this read, or the batch
    // failed for another reason. Nothing was written, so price it once more from a fresh read (#306) rather than answer a
    // raw 500; a second failure is passed on.
    if (!retried) return preparePull(db, env, userId, input, idem, true);
    throw error;
  }
  // The sequence is assigned inside the batch; the response carries the stored one.
  // Never a made-up 0: a commitment the user keeps must be the stored one.
  const stored = await db.prepare('SELECT sequence FROM pulls WHERE id = ?').bind(pull.id).first<{ sequence: number }>();
  if (!stored) throw new ApiError('UNKNOWN', 'The pull could not be read back; try again', 503);
  return prepareResponse({ ...pull, sequence: stored.sequence }, env);
}

/** An idempotent replay answers the pull it made, but only for the same request (#277): a reused key with another count,
 *  gacha, asset or targeting is refused, as a deposit's is, instead of quietly returning a different pull. */
function replayPrepare(pull: PullRow, request: { count: PullCount; targeted: boolean; asset: Asset; gachaId: string }, env: Env) {
  if (pull.count !== request.count || !!pull.targeted !== request.targeted || pull.asset !== request.asset
    || pull.gacha_id !== request.gachaId) {
    throw new ApiError('TX_MISMATCH', 'That idempotency key belongs to a different pull', 409);
  }
  return prepareResponse(pull, env);
}

function drawablePool(pull: PullRow): FrozenPool | null {
  try {
    const pool = JSON.parse(pull.pool_json ?? '') as FrozenPool;
    const slots = pool?.slots;
    return slots && slots.count === pull.count && slots.reservedPaid === pull.reserved_paid
      && slots.reservedCommon === pull.reserved_common ? pool : null;
  } catch {
    return null;
  }
}

function prepareResponse(pull: PullRow, env: Env) {
  const destination = pull.asset === 'USDC' ? env.TREASURY_USDC_TOKEN_ACCOUNT : env.TREASURY_USDT_TOKEN_ACCOUNT;
  const mint = pull.asset === 'USDC' ? env.USDC_MINT : env.USDT_MINT;
  return {
    pullId: pull.id,
    costUsd: pull.cost_base / BASE,
    useFreePulls: pull.reserved_paid + pull.reserved_common,
    transfer: pull.cost_base > 0 ? { to: destination, mint, amount: pull.cost_base, memo: pull.id,
      transactionBase64: pull.payment_transaction_base64 ?? undefined } : undefined,
    expiresAt: pull.expires_at,
    // A MagicBlock pull's commitment, handed to the user BEFORE they pay (#406): the one sequence this pull is drawn under and
    // the hash of its frozen pool. The draw program allows one request per sequence, so with these in the user's hands the
    // house cannot request the pull under a second sequence and publish the answer it prefers; the verifier checks against them.
    ...(pull.draw_source === 'magicblock' ? { draw: { source: 'magicblock' as const, sequence: pull.sequence, poolHash: pull.pool_hash } } : {}),
  };
}

type WeightedInventoryCard = InventoryCard & { selection_weight: number };

/** Drawable stock for one tier. A chase (`targeted`) does not narrow this: any card in the album can land, including one already held (#391). */
async function inventoryFor(
  db: D1Database,
  tier: Tier,
  gachaId: string,
  inventoryVersion: number,
): Promise<WeightedInventoryCard[]> {
  const sql = `SELECT i.inventory_key, i.album_id, i.tier, i.available, i.supply, i.serial_counter,
    gi.selection_weight, c.*
    FROM gacha_inventory gi JOIN stock_items i ON i.inventory_key = gi.inventory_key
    JOIN cards c ON c.id = i.card_id
    LEFT JOIN albums a ON a.id = i.album_id
    WHERE gi.gacha_id = ? AND gi.inventory_version = ? AND gi.enabled = 1 AND i.tier = ?
      AND ${DRAWABLE_SQL} AND (i.album_id IS NULL OR a.status = 'live')
    ORDER BY i.inventory_key`;
  return (await db.prepare(sql).bind(gachaId, inventoryVersion, tier).all<WeightedInventoryCard>()).results;
}

/** The cards a MagicBlock pull drew, by inventory key, whatever their live state: the pull draws from the pool frozen at
 *  prepare, so a card disabled or an album closed since then still lands (AC-5). */
async function rowsByKey(db: D1Database, keys: string[]): Promise<Map<string, InventoryCard>> {
  const unique = [...new Set(keys)];
  const rows = unique.length ? (await db.prepare(`SELECT i.inventory_key, i.album_id, i.tier, i.available, i.supply,
    i.serial_counter, c.* FROM stock_items i JOIN cards c ON c.id = i.card_id
    WHERE i.inventory_key IN (${unique.map(() => '?').join(', ')})`).bind(...unique).all<InventoryCard>()).results : [];
  return new Map(rows.map((row) => [row.inventory_key, row]));
}

async function assertInventoryCapacity(
  db: D1Database,
  gacha: Pick<GachaRow, 'id' | 'inventory_version' | 'paid_odds_config_id' | 'free_odds_config_id'>,
  freeCommonRolls: number,
  paidOddsRolls: number,
): Promise<void> {
  const [paidOdds, freeOdds] = await Promise.all([
    oddsTiers(db, gacha.paid_odds_config_id),
    oddsTiers(db, gacha.free_odds_config_id),
  ]);
  const required = new Map<Tier, number>();
  for (const row of paidOdds) if (row.weight > 0) required.set(row.tier, (required.get(row.tier) ?? 0) + paidOddsRolls);
  for (const row of freeOdds) if (row.weight > 0) required.set(row.tier, (required.get(row.tier) ?? 0) + freeCommonRolls);
  const offered = await offeredTiers(db, gacha.id, gacha.inventory_version);
  for (const [tier, count] of required) {
    if (count === 0) continue;
    // A tier the gacha does not offer (the model still lists it; the pull pool does not) is not a vault this pull can exhaust.
    if (!offered.has(tier)) continue;
    const candidates = await inventoryFor(db, tier, gacha.id, gacha.inventory_version);
    // One infinite row covers every roll of its tier. A finite tier must hold the whole count up front.
    if (candidates.some((item) => item.supply === 'infinite')) continue;
    const available = candidates.reduce((sum, item) => sum + item.available, 0);
    // Any positive-odds tier the gacha offers can win every roll. Requiring the full count in each
    // reachable finite tier ensures a prepared payment cannot fail solely because its
    // random tier distribution exhausted stock that was already short at quote time.
    if (available < count) throw new ApiError('RESTOCKING', 'That gacha is restocking', 409);
  }
}

/** Tiers this gacha version actually lists, including a finite row that is already at zero. */
async function offeredTiers(db: D1Database, gachaId: string, inventoryVersion: number): Promise<Set<Tier>> {
  const rows = await db.prepare(`SELECT DISTINCT i.tier AS tier FROM gacha_inventory gi
    JOIN stock_items i ON i.inventory_key = gi.inventory_key
    WHERE gi.gacha_id = ? AND gi.inventory_version = ? AND gi.enabled = 1`)
    .bind(gachaId, inventoryVersion).all<{ tier: Tier }>();
  return new Set(rows.results.map((row) => row.tier));
}

export async function commitPull(
  db: D1Database,
  env: Env,
  userId: string,
  pullId: string,
  signature?: string,
  signedTransactionBase64?: string,
) {
  let pull = await pullById(db, userId, pullId);
  const account = await db.prepare('SELECT wallet FROM users WHERE id = ?').bind(userId).first<{ wallet: string }>();
  if (!account) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);
  if (pull.status === 'committed' && pull.response_json) return JSON.parse(pull.response_json);
  if (pull.status !== 'prepared') throw new ApiError('EXPIRED', 'That pull timed out');
  const expired = Date.now() > Date.parse(pull.expires_at);
  let payment: Awaited<ReturnType<typeof verifyPayment>> | null = null;
  if (pull.cost_base > 0) {
    if (env.PAYMENTS_MODE === 'solana-rpc' && !signedTransactionBase64 && pull.tx_signature) {
      // A pull whose signature is pinned, committed again without the bytes (#273): the chain says where it stands. It used
      // to answer EXPIRED here while its free pulls stayed reserved, and a payment that then landed had no pull to go to.
      signature = await resolvePinnedPayment(env, db, pull);
    } else if (env.PAYMENTS_MODE === 'solana-rpc') {
      if (!signedTransactionBase64) {
        if (expired) await expirePreparedPull(db, pull, new Date().toISOString());
        if (expired) throw new ApiError('EXPIRED', 'That pull timed out');
        throw new ApiError('TX_NOT_FOUND', 'The signed payment transaction is missing');
      }
      if (!pull.payment_transaction_base64) {
        throw new ApiError('TX_MISMATCH', 'That pull has no prepared payment transaction');
      }
      const sponsored = await sponsorPaymentTransaction(
        env, pull.payment_transaction_base64, signedTransactionBase64, account.wallet,
      );
      signature = sponsored.signature;
      pull = await pinPaymentSignature(db, pull, signature);
      try {
        signature = await broadcastPaymentTransaction(env, sponsored.transactionBase64, pull.payment_last_valid_block_height);
      } catch (error) {
        // Only a payment the chain says can never move money gives back what the pull reserved (#273): one that failed on
        // chain, or whose blockhash expired with no status. Anything else can still land, so the pull stays pinned.
        if (error instanceof PaymentOutcome && error.release) {
          await expireFailedPaymentAuthorization(db, pull, signature, new Date().toISOString());
        }
        throw error;
      }
    }
    if (expired && !signature) {
      await expirePreparedPull(db, pull, new Date().toISOString());
      throw new ApiError('EXPIRED', 'That pull timed out');
    }
    if (!signature) throw new ApiError('TX_NOT_FOUND', 'We could not see your payment yet');
    const used = await db.prepare('SELECT id FROM pulls WHERE tx_signature = ? AND id != ?').bind(signature, pull.id).first();
    if (used) throw new ApiError('TX_MISMATCH', 'That payment was already used');
    payment = await verifyPayment(env, { signature, memo: pull.id, asset: pull.asset, amount: pull.cost_base });
    await recordConfirmedPayment(db, pull, payment);
  } else if (expired) {
    await expirePreparedPull(db, pull, new Date().toISOString());
    throw new ApiError('EXPIRED', 'That pull timed out');
  }

  try {
  // A MagicBlock pull (#406) draws from its frozen pool with MagicBlock's 32 bytes; every other pull keeps the server proof.
  const magic = pull.draw_source === 'magicblock';
  const vrf = magic ? null : await resolveVrf(env, pull);
  // The pool was frozen from this pull's own count and free split. One that cannot be drawn (unreadable, a pool frozen before
  // it carried slots, or a row that disagrees with it) is never re-split: the pull is failed into a refund before any draw is
  // asked for, while failDraw can still fail it.
  const frozenPool = magic ? drawablePool(pull) : null;
  if (magic && !frozenPool) {
    await failDraw(db, pull);
    // "Refunded" only when this left the pull expired. failDraw changes nothing for a pull whose bytes are already stored
    // (that can only be a row edited by hand): such a pull can neither settle nor be refunded here, and is reported.
    const now = await db.prepare('SELECT status FROM pulls WHERE id = ?').bind(pull.id).first<{ status: string }>();
    if (now?.status === 'expired') throw new ApiError('EXPIRED', 'We could not draw your card. Your payment will be refunded.', 409);
    console.error('MagicBlock pull cannot be drawn and was not failed', { pullId: pull.id });
    throw new ApiError('UNKNOWN', 'This pull could not be opened; it has been reported', 503);
  }
  const randomness = magic ? await awaitDraw(db, env, pull) : null;
  const derived = randomness ? await deriveSlots(frozenPool!, randomness) : null;
  const drawnRows = derived ? await rowsByKey(db, derived.map((slot) => slot.key)) : null;
  const oracle = new RandomOracle(vrf?.outputBytes ?? new Uint8Array(32));
  const [paidOdds, freeOdds] = magic ? [[], []] : await Promise.all([
    oddsTiers(db, pull.odds_config_id),
    oddsTiers(db, pull.free_odds_config_id),
  ]);

  const existingHoldings = await db.prepare(`SELECT card_id, tier, COUNT(*) AS qty FROM user_inventory
    WHERE user_id = ? AND status = 'owned' GROUP BY card_id, tier`).bind(userId)
    .all<{ card_id: string; tier: Tier; qty: number }>();
  const quantities = new Map(existingHoldings.results.map((row) => [`${row.card_id}#${row.tier}`, row.qty]));
  const offered = await offeredTiers(db, pull.gacha_id, pull.inventory_version);
  // Odds may still name a tier this gacha does not stock (the model table). The roll uses only tiers the gacha offers.
  // A finite tier that is offered but empty stays in the roll and then restocks — it is not silently replaced.
  const playable = (rows: WeightedTier[]) => {
    const kept = rows.filter((row) => offered.has(row.tier));
    if (!kept.length) throw new ApiError('RESTOCKING', 'Cards are restocking', 409);
    return kept;
  };
  const stock = new Map<string, WeightedInventoryCard[]>();
  if (!magic) for (const tier of ['common', 'reverse', 'holo', 'ultra', 'graded'] as Tier[]) {
    stock.set(tier, await inventoryFor(db, tier, pull.gacha_id, pull.inventory_version));
  }
  const remaining = new Map<string, number>();
  for (const items of stock.values()) for (const item of items) {
    if (item.supply !== 'infinite') remaining.set(item.inventory_key, item.available);
  }
  const serialUses = new Map<string, number>();
  const outcomes: Outcome[] = [];
  const settledAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO pull_settlements (pull_id, kind, created_at) VALUES (?, 'committed', ?)").bind(pull.id, settledAt),
  ];
  if (payment) statements.push(db.prepare(`UPDATE payment_obligations
    SET status = 'fulfilled', reason = NULL, updated_at = ? WHERE pull_id = ? AND status = 'pending'`)
    .bind(settledAt, pull.id));
  let extras = (await db.prepare(`SELECT COALESCE(SUM(qty - 1), 0) AS count FROM (
    SELECT COUNT(*) AS qty FROM user_inventory
    WHERE user_id = ? AND tier = 'common' AND status = 'owned' GROUP BY card_id HAVING COUNT(*) > 1)`)
    .bind(userId).first<{ count: number }>())?.count ?? 0;

  for (let index = 0; index < pull.count; index++) {
    let tier: Tier;
    let selected: InventoryCard | undefined;
    if (derived) {
      // The frozen pool holds only unlimited stock, so a drawn card never needs a count.
      tier = derived[index].tier;
      selected = drawnRows!.get(derived[index].key);
      if (!selected) throw new ApiError('UNKNOWN', 'A drawn card is missing from the catalog', 503);
    } else {
    const freeCommon = index >= pull.reserved_paid && index < pull.reserved_paid + pull.reserved_common;
    tier = await selectTier(oracle, playable(freeCommon ? freeOdds : paidOdds), index);
    const candidates = (stock.get(tier) ?? []).filter((item) => item.supply === 'infinite' || (remaining.get(item.inventory_key) ?? 0) > 0);
    if (!candidates.length) throw new ApiError('RESTOCKING', 'Cards are restocking', 409);
    const candidateWeight = candidates.reduce((sum, candidate) => sum + candidate.selection_weight, 0);
    const candidateValue = await oracle.index(candidateWeight, index, 'inventory');
    let cursor = 0;
    selected = candidates.find((candidate) => {
      cursor += candidate.selection_weight;
      return candidateValue < cursor;
    });
    if (!selected) throw new Error('inventory weights did not resolve');
    }
    if (selected.supply !== 'infinite') remaining.set(selected.inventory_key, (remaining.get(selected.inventory_key) ?? 0) - 1);
    const key = `${selected.id}#${tier}`;
    const oldQty = quantities.get(key) ?? 0;
    quantities.set(key, oldQty + 1);
    const isDupe = oldQty > 0;
    if (tier === 'common' && isDupe) extras++;
    const use = serialUses.get(selected.inventory_key) ?? 0;
    serialUses.set(selected.inventory_key, use + 1);
    const serial = tier === 'graded' ? `PG95-${String(selected.serial_counter + use + 1).padStart(7, '0')}`
      : tier === 'holo' || tier === 'ultra' ? `${tier.toUpperCase()}-${selected.serial_counter + use + 1}` : undefined;
    const inventoryItemId = randomId('item');
    outcomes.push({ inventoryItemId, cardId: selected.id, rarity: tier, serial, isDupe,
      ...(selected.album_id ? { albumId: selected.album_id } : {}), card: card(selected) });
    statements.push(db.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, serial, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pull', ?, ?, ?)`)
      .bind(inventoryItemId, userId, selected.inventory_key, selected.id, tier, serial ?? null, pull.id, index, settledAt));
    statements.push(db.prepare(`INSERT INTO pull_outcomes
      (pull_id, outcome_index, inventory_key, user_inventory_item_id, card_id, tier, serial, is_dupe, randomness_tag, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(pull.id, index, selected.inventory_key, inventoryItemId, selected.id, tier,
        serial ?? null, isDupe ? 1 : 0, magic ? `${index}:magicblock` : `${index}:tier|inventory`, settledAt));
    if (selected.supply !== 'infinite') statements.push(finiteDecrement(db, selected.inventory_key, serial ? 1 : 0));
  }

  const user = await db.prepare('SELECT free_paid + free_common AS free_pulls FROM users WHERE id = ?').bind(userId).first<{ free_pulls: number }>();
  // The ledger balance is only a thing in mock payments; on a real RPC the wallet's balance is read AFTER the allocation
  // commits, best-effort (#277): a balance-display read must never fail a pull whose payment is already recorded.
  if (env.PAYMENTS_MODE === 'mock') {
    const currentBalance = (await db.prepare('SELECT amount FROM balances WHERE user_id = ? AND asset = ?')
      .bind(userId, pull.asset).first<{ amount: number }>())?.amount ?? 0;
    if (currentBalance < pull.cost_base) throw new ApiError('INSUFFICIENT_FUNDS', 'Balance changed before the pull completed', 409);
  }
  const albumCounts = await db.prepare(`SELECT i.album_id, COUNT(DISTINCT ui.card_id) AS held
    FROM stock_items i JOIN user_inventory ui ON ui.inventory_key = i.inventory_key
    WHERE ui.user_id = ? AND ui.tier = 'common' AND ui.status = 'owned' AND i.tier = 'common'
    GROUP BY i.album_id`)
    .bind(userId).all<{ album_id: string; held: number }>();
  const counts = new Map(albumCounts.results.map((row) => [row.album_id, row.held]));
  for (const outcome of outcomes) if (outcome.rarity === 'common' && outcome.albumId && !existingHoldings.results.some((h) => h.card_id === outcome.cardId && h.tier === 'common')) {
    counts.set(outcome.albumId, (counts.get(outcome.albumId) ?? 0) + (outcomes.findIndex((o) => o.cardId === outcome.cardId && o.rarity === 'common') === outcomes.indexOf(outcome) ? 1 : 0));
  }
  let albumCompleted: string | undefined;
  for (const [albumId, held] of counts) {
    const album = await db.prepare('SELECT size FROM albums WHERE id = ?').bind(albumId).first<{ size: number }>();
    if (album && held >= album.size) {
      const already = await db.prepare('SELECT 1 FROM album_completions WHERE user_id = ? AND album_id = ?').bind(userId, albumId).first();
      if (!already) albumCompleted = albumId;
    }
  }
  // Recorded from what the batch sees when it runs, for every album this user collects in (#305): a burn committing between
  // the count above and this batch can finish an album this count still calls short.
  const completedAt = new Date().toISOString();
  for (const albumId of counts.keys()) statements.push(recordCompletionIfFull(db, userId, albumId, completedAt));
  let ledgerBalance: { usdc: number; usdt: number; pulls: number } | undefined;
  if (env.PAYMENTS_MODE === 'mock') {
    ledgerBalance = { usdc: 0, usdt: 0, pulls: 0 };
    const allBalances = await db.prepare('SELECT asset, amount FROM balances WHERE user_id = ?').bind(userId).all<{ asset: string; amount: number }>();
    for (const row of allBalances.results) ledgerBalance[row.asset.toLowerCase() as 'usdc' | 'usdt'] = row.amount - (row.asset === pull.asset ? pull.cost_base : 0);
    ledgerBalance.pulls = Math.floor((ledgerBalance.usdc + ledgerBalance.usdt) / BASE);
  }
  // The stored response (an idempotent replay's answer) carries no chain balance: it would be stale on any replay.
  // Raffle tickets are the paid slots only (6a). The grant is in this batch, so a replay returns the stored
  // ticketsEarned / myTickets and does not add them again. A paid streak bonus is separate: one per calendar
  // day that reaches 5, added to myTickets and not to ticketsEarned (#376).
  const ticketsEarned = ticketsEarnedForPull(pull);
  const today = dayKey();
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const storedStreak = await readStreak(db, userId);
  const streakNext = ticketsEarned > 0 ? advancePaidStreak(storedStreak, today, yesterday) : null;
  // The bonus is 0 or 2, once, on the pull that reaches day 5. It is not × the day's dollars.
  const streakBonus = streakNext?.bonus === 2 ? 2 : 0;
  const streak = streakNext
    ? { count: streakNext.state.count, countedToday: true }
    : visibleStreak(storedStreak, today, yesterday);
  const myTickets = (await seasonTicketCount(db, userId)) + ticketsEarned + streakBonus;
  const response: Record<string, unknown> = { outcomes, extras, freePulls: user?.free_pulls ?? 0, ticketsEarned, streakBonus, myTickets, streak,
    ...(albumCompleted ? { albumCompleted } : {}),
    ...(ledgerBalance ? { balance: ledgerBalance } : {}) };
  if (env.PAYMENTS_MODE === 'mock') statements.push(db.prepare('UPDATE balances SET amount = amount - ? WHERE user_id = ? AND asset = ?').bind(pull.cost_base, userId, pull.asset));
  statements.push(...seasonTicketStatements(db, userId, pull.id, ticketsEarned, settledAt));
  if (streakNext) statements.push(...seasonStreakStatements(db, userId, pull.id, streakNext, settledAt));
  statements.push(db.prepare(`UPDATE pulls SET status = 'committed', tx_signature = ?, vrf_public_key = ?,
    vrf_input = ?, vrf_proof = ?, vrf_output = ?, resolved_at = ?, response_json = ?
    WHERE id = ? AND status = 'prepared'`)
    .bind(signature ?? null, vrf?.publicKey ?? null, vrf?.input ?? null, vrf?.proof ?? null, vrf?.output ?? null, settledAt,
      JSON.stringify(response), pull.id));
  statements.push(announceRecordedCompletion(db, { pullId: pull.id }, userId, completedAt));
  try { await db.batch(statements); }
  catch (error) {
    const settled = await pullById(db, userId, pull.id);
    if (settled.status === 'committed' && settled.response_json) return JSON.parse(settled.response_json);
    if (signature) {
      const receipt = await db.prepare('SELECT pull_id FROM payment_receipts WHERE signature = ?').bind(signature)
        .first<{ pull_id: string }>();
      if (receipt && receipt.pull_id !== pull.id) throw new ApiError('TX_MISMATCH', 'That payment was already used');
    }
    console.error('pull batch failed', error);
    throw new ApiError('RESTOCKING', 'Stock changed while the pull was opening; retry commit', 409);
  }
  // The stored answer, which carries a completion the batch recorded (PR #308's review); the one built above if it cannot be
  // read back. The pull is settled either way.
  const stored = await db.prepare('SELECT response_json FROM pulls WHERE id = ?').bind(pull.id).first<{ response_json: string | null }>()
    .catch(() => null);
  if (stored?.response_json) Object.assign(response, JSON.parse(stored.response_json));
  if (env.PAYMENTS_MODE === 'solana-rpc') {
    // Best-effort, after the pull is settled: without it the app re-reads the balance itself.
    const chainBalance = await walletBalance(env, account.wallet).catch(() => null);
    if (chainBalance) return { ...response, balance: chainBalance };
  }
  return response;
  } catch (error) {
    if (payment) await markPaymentPending(db, pull.id, error);
    throw error;
  }
}
