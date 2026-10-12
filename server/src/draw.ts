// A MagicBlock pull's life in the Worker (#406): freeze the pool at prepare, then at commit request one draw for the pull's
// sequence, wait for MagicBlock's 32 bytes, and either hand them to settlement or, past the timeout, fail the pull with its
// payment owed back. No fallback to the server key, ever, and never a second request for the same sequence.
import { canonicalPool, hexToBytes, bytesToHex, poolHash, pullIdHash, type FrozenPool, type FrozenSlots, type WeightedTier } from './drawDerive';
import { drawChain, drawConfig } from './drawChain';
import { ApiError } from './http';
import type { Env, PullRow, Tier } from './types';

const TIERS: Tier[] = ['common', 'reverse', 'holo', 'ultra', 'graded'];

/** Whether a new pull draws from MagicBlock: the switch is on, money moves, and it is not an album chase (#406 scope). A pull
 *  paid entirely with burned free pulls stays on the server proof (Ben, 5 Oct 2026). */
export function wantsMagicBlock(env: Env, pull: { cost_base: number; targeted: number }): boolean {
  return env.DRAW_SOURCE === 'magicblock' && pull.cost_base > 0 && !pull.targeted;
}

type Row = { inventory_key: string; tier: Tier; supply: string; selection_weight: number };

/** The pool a MagicBlock pull draws from, as it stands at prepare: the gacha's offered tiers under the pinned paid and free odds,
 *  and every enabled, drawable card in them with its weight. `null` when any candidate is finite stock: the frozen list has no
 *  way to hold a count, so such a pool stays on the server proof rather than freeze a card that might sell out before it lands. */
export async function freezePool(
  db: D1Database,
  gacha: { id: string; inventory_version: number },
  slots: FrozenSlots,
  paidOdds: WeightedTier[],
  freeOdds: WeightedTier[],
  drawableSql: string,
): Promise<{ json: string; hash: string } | null> {
  const rows = (await db.prepare(`SELECT i.inventory_key, i.tier, i.supply, gi.selection_weight
    FROM gacha_inventory gi JOIN stock_items i ON i.inventory_key = gi.inventory_key
    LEFT JOIN albums a ON a.id = i.album_id
    WHERE gi.gacha_id = ? AND gi.inventory_version = ? AND gi.enabled = 1
      AND ${drawableSql} AND (i.album_id IS NULL OR a.status = 'live')
    ORDER BY i.inventory_key`).bind(gacha.id, gacha.inventory_version).all<Row>()).results;
  if (rows.some((row) => row.supply !== 'infinite')) return null;
  const offered = new Set(rows.map((row) => row.tier));
  const playable = (odds: WeightedTier[]) => odds.filter((row) => row.weight > 0 && offered.has(row.tier))
    .map((row) => ({ tier: row.tier, weight: row.weight }));
  const pool: FrozenPool = { v: 1, slots, paid: playable(paidOdds), free: playable(freeOdds), cards: {} };
  if (!pool.paid.length || !pool.free.length) return null;
  for (const tier of TIERS) {
    const cards = rows.filter((row) => row.tier === tier && row.selection_weight > 0)
      .map((row) => ({ key: row.inventory_key, weight: row.selection_weight }));
    if (cards.length) pool.cards[tier] = cards;
  }
  const json = canonicalPool(pool);
  return { json, hash: await poolHash(json) };
}

const ownsPull = `id = ? AND status = 'prepared'`;

/** The pull's 32 random bytes from MagicBlock, waiting up to DRAW_WAIT_MS in this request. Throws a retryable 503 while the
 *  draw is pending, and EXPIRED once it is past DRAW_TIMEOUT_MS from the first request (the pull is then failed: see failDraw). */
export async function awaitDraw(db: D1Database, env: Env, pull: PullRow): Promise<Uint8Array> {
  if (pull.draw_randomness) return hexToBytes(pull.draw_randomness);
  const config = drawConfig(env);
  const chain = drawChain(env);

  // The timeout counts from the first time any commit started this draw.
  let requestedAt = pull.draw_requested_at;
  if (!requestedAt) {
    const now = new Date().toISOString();
    // The draw account is the program's address for this sequence, known before anything is sent: stored now, it is
    // published even when the request's own answer is lost (a 429 while confirming) and a retry finds the draw landed.
    await db.prepare(`UPDATE pulls SET draw_requested_at = ?, draw_account = ? WHERE ${ownsPull} AND draw_requested_at IS NULL`)
      .bind(now, await chain.account(pull.sequence), pull.id).run();
    requestedAt = (await db.prepare('SELECT draw_requested_at FROM pulls WHERE id = ?').bind(pull.id)
      .first<{ draw_requested_at: string | null }>())?.draw_requested_at ?? now;
  }
  const deadline = Date.parse(requestedAt) + config.timeoutMs;
  const ownPullId = await pullIdHash(pull.id);
  const ownPool = hexToBytes(pull.pool_hash!);
  // A draw account for this sequence that was requested for another pull or pool (two databases on one program, or a reset
  // database reusing sequences) is never read as this pull's: it is an operations fault, and the pull waits out its timeout
  // into a refund rather than settle on someone else's randomness.
  const read = async () => {
    const state = await chain.read(pull.sequence);
    if (state.exists && !(sameBytes(state.pullIdHash, ownPullId) && sameBytes(state.poolHash, ownPool))) {
      console.error('draw account belongs to another pull', { pullId: pull.id, sequence: pull.sequence });
      if (Date.now() >= deadline) await failOrRetry(db, pull);
      throw new ApiError('UNKNOWN', 'This pull could not be drawn yet; retry safely', 503);
    }
    return state;
  };

  let state = await read();
  if (!state.exists && Date.now() < deadline) {
    // No draw account: never sent, or sent and not landed. The program refuses a second request for this sequence, so a
    // resend can only cost a fee, never a second draw.
    const sent = await chain.request({ sequence: pull.sequence, pullIdHash: ownPullId, count: pull.count, poolHash: ownPool });
    await db.prepare(`UPDATE pulls SET draw_account = ?, draw_request_signature = COALESCE(draw_request_signature, ?)
      WHERE ${ownsPull}`).bind(sent.account, sent.signature, pull.id).run();
    state = await read();
  }

  const waitUntil = Math.min(Date.now() + config.waitMs, deadline);
  while (!state.randomness) {
    const left = waitUntil - Date.now();
    if (left <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(300, left)));
    try {
      state = await read();
    } catch (error) {
      // A rate-limited or briefly unreachable RPC costs this poll, not the commit: keep waiting within the budget.
      if (error instanceof ApiError && error.code === 'TX_NOT_FOUND') continue;
      throw error;
    }
  }
  if (state.randomness) {
    // The oracle's fulfilment transaction is archived with the bytes (spec step 4): public RPCs prune history. Best effort:
    // the verifier finds it on chain too, and nothing is decided from it.
    const fulfilment = await chain.fulfilment(pull.sequence).catch(() => null);
    await db.prepare(`UPDATE pulls SET draw_randomness = ?, draw_fulfil_signature = COALESCE(draw_fulfil_signature, ?)
      WHERE ${ownsPull} AND draw_randomness IS NULL`)
      .bind(bytesToHex(state.randomness), fulfilment, pull.id).run();
    const stored = await db.prepare('SELECT draw_randomness FROM pulls WHERE id = ?').bind(pull.id)
      .first<{ draw_randomness: string | null }>();
    return hexToBytes(stored?.draw_randomness ?? bytesToHex(state.randomness));
  }
  if (Date.now() >= deadline) await failOrRetry(db, pull);
  throw new ApiError('TX_NOT_FOUND', 'Your card is still being drawn; retry safely', 503);
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return !!a && a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Fails the pull, and answers EXPIRED only if this call left it expired. A stale commit that reaches the deadline after
 *  another commit settled the pull (failDraw then changes nothing) answers retry-safely instead: the retry replays the
 *  settled cards, where EXPIRED would have told the user a pull that landed was being refunded. */
async function failOrRetry(db: D1Database, pull: PullRow): Promise<never> {
  await failDraw(db, pull);
  const now = await db.prepare('SELECT status FROM pulls WHERE id = ?').bind(pull.id).first<{ status: string }>();
  if (now?.status === 'expired') throw drawExpired();
  throw new ApiError('TX_NOT_FOUND', 'Your card is being opened; retry safely', 503);
}

function drawExpired() {
  return new ApiError('EXPIRED', 'We could not draw your card in time. Your payment will be refunded.', 409);
}

/** The pull ends with no card: its free pulls come back, it is settled as expired, and a recorded payment is owed back
 *  (`refund_pending`, picked up by the refund sweeper, #268). A late MagicBlock answer settles nothing after this. */
export async function failDraw(db: D1Database, pull: PullRow): Promise<void> {
  const now = new Date().toISOString();
  const eligible = `id = ? AND status = 'prepared' AND draw_randomness IS NULL`;
  try {
    await db.batch([
      db.prepare(`UPDATE users SET free_paid = free_paid + ?, free_common = free_common + ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM pulls WHERE ${eligible})`)
        .bind(pull.reserved_paid, pull.reserved_common, pull.user_id, pull.id),
      db.prepare(`UPDATE payment_obligations SET status = 'refund_pending', reason = 'DRAW_TIMEOUT', updated_at = ?
        WHERE pull_id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM pulls WHERE ${eligible})`)
        .bind(now, pull.id, pull.id),
      db.prepare(`INSERT INTO pull_settlements (pull_id, kind, created_at) SELECT id, 'expired', ? FROM pulls WHERE ${eligible}`)
        .bind(now, pull.id),
      db.prepare(`UPDATE pulls SET status = 'expired', resolved_at = ?, draw_failed_at = ? WHERE ${eligible}`)
        .bind(now, now, pull.id),
    ]);
  } catch { /* a concurrent settlement won: the pull is committed, and the next read answers it */ }
}

/** The cluster the draw program runs on, as the app may link it; null when DRAW_CLUSTER names none we know. */
export function drawCluster(env: Env): 'devnet' | 'mainnet-beta' | null {
  return env.DRAW_CLUSTER === 'devnet' || env.DRAW_CLUSTER === 'mainnet-beta' ? env.DRAW_CLUSTER : null;
}

/** What anyone needs to recompute a MagicBlock pull: the frozen pool and its hash, the program and the request, the 32 bytes,
 *  and the cards that were settled. */
export async function drawView(db: D1Database, env: Env, userId: string, pullId: string) {
  const pull = await db.prepare('SELECT * FROM pulls WHERE id = ? AND user_id = ?').bind(pullId, userId).first<PullRow>();
  if (!pull) throw new ApiError('EXPIRED', 'That pull was not found', 404);
  const outcomes = (await db.prepare(`SELECT outcome_index AS "index", tier, inventory_key AS key, card_id AS cardId
    FROM pull_outcomes WHERE pull_id = ? ORDER BY outcome_index`).bind(pull.id)
    .all<{ index: number; tier: Tier; key: string; cardId: string }>()).results;
  const common = { pullId: pull.id, status: pull.status, count: pull.count, outcomes };
  if (pull.draw_source === 'magicblock' && pull.draw_randomness && !pull.draw_fulfil_signature) {
    // The first look, right when the bytes landed, can miss the fulfilment in the account's history (index lag): try again.
    // Best effort: a missing or broken draw configuration (a rotated key) must not take the public view down with it.
    let found: string | null = null;
    try { found = await drawChain(env).fulfilment(pull.sequence); } catch { found = null; }
    if (found) {
      await db.prepare('UPDATE pulls SET draw_fulfil_signature = ? WHERE id = ? AND draw_fulfil_signature IS NULL')
        .bind(found, pull.id).run();
      pull.draw_fulfil_signature = found;
    }
  }
  if (pull.draw_source !== 'magicblock') {
    return { ...common, source: 'ecvrf' as const, vrf: { publicKey: pull.vrf_public_key, input: pull.vrf_input,
      proof: pull.vrf_proof, output: pull.vrf_output } };
  }
  return {
    ...common,
    source: 'magicblock' as const,
    programId: env.DRAW_PROGRAM_ID ?? null,
    cluster: drawCluster(env),
    sequence: pull.sequence,
    pullIdHash: bytesToHex(await pullIdHash(pull.id)),
    pool: pull.pool_json,
    poolHash: pull.pool_hash,
    drawAccount: pull.draw_account,
    requestSignature: pull.draw_request_signature,
    fulfilSignature: pull.draw_fulfil_signature,
    randomness: pull.draw_randomness,
    failedAt: pull.draw_failed_at,
  };
}
