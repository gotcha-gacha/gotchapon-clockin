// The refund sweeper (#268). Product rule: a confirmed payment always resolves to pulls or a refund.
//
// A sweep (Cron Trigger, or POST /admin/refunds/run) does two things:
//  1. DECIDE, ledger only: a paid pull that can no longer become cards is failed into `refund_pending` — a MagicBlock draw past
//     its timeout (#406), or any confirmed payment still unsettled REFUND_AFTER_MS after it was recorded (15 min, Ben 7 Oct).
//     Failing a pull settles it as `expired` in the same batch that marks the obligation, so a late commit loses on
//     pull_settlements' primary key and can never also hand out cards. A pull whose drawn bytes are stored is owed cards, not
//     money: it is reported, never refunded.
//  2. SEND, only with REFUNDS_ENABLED=true: each `refund_pending` obligation is paid back from the dedicated refund wallet,
//     exactly the receipt's amount, to the wallet that signed the payment (read from the payment transaction itself), with
//     memo `refund:<pullId>`. The faucet's lifecycle (#304): the signed transfer is stored before it is broadcast, so a retry
//     rebroadcasts the same bytes and can never pay twice; the obligation turns `refunded` only once the chain confirms.
//     REFUND_BATCH refunds a sweep and REFUND_DAILY_CAP_BASE a UTC day; past either, the sweep stops and says so.
import { getAddMemoInstruction } from '@solana-program/memo';
import {
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { address, createClient, createKeyPairSignerFromBytes } from '@solana/kit';
import { solanaMainnetRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { failDraw } from './draw';
import { drawChain } from './drawChain';
import { bytesToHex, hexToBytes, pullIdHash } from './drawDerive';
import { commitPull } from './pulls';
import { signedLifetime } from './faucet';
import { ApiError } from './http';
import { hasConfirmed, paymentState, type ConfirmationStatus } from './payments';
import { hasDrawColumns, hasTable } from './schemaShape';
import type { Asset, Env, PullRow } from './types';

const TOKEN_DECIMALS = 6;

export type RefundConfig = { chain: 'solana' | 'fake'; sending: boolean; afterMs: number; batch: number; dailyCapBase: number };

function setting(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ApiError('UNKNOWN', `${name} is invalid`, 503);
  return parsed;
}

export function refundConfig(env: Env): RefundConfig {
  const chain = env.REFUND_CHAIN ?? 'solana';
  if (chain !== 'solana' && chain !== 'fake') throw new ApiError('UNKNOWN', 'REFUND_CHAIN is invalid', 503);
  if (chain === 'fake' && env.ENVIRONMENT !== 'local') throw new ApiError('UNKNOWN', 'The fake refund chain is local only', 503);
  return {
    chain,
    sending: env.REFUNDS_ENABLED === 'true',
    afterMs: setting(env.REFUND_AFTER_MS, 15 * 60_000, 'REFUND_AFTER_MS'),
    batch: setting(env.REFUND_BATCH, 5, 'REFUND_BATCH'),
    dailyCapBase: setting(env.REFUND_DAILY_CAP_BASE, 200_000_000, 'REFUND_DAILY_CAP_BASE'),
  };
}

// ---------------------------------------------------------------------------------------------------------------- decide

/** A paid pull that will never become cards, failed into a refund: free pulls back, settled `expired`, obligation
 *  `refund_pending` with `reason`. Only while it is still prepared, its payment pending and no drawn bytes are stored; a
 *  concurrent settlement wins on pull_settlements' key and this changes nothing. */
export async function failUnsettledPull(db: D1Database, pull: PullRow, reason: string, drawColumns = true): Promise<boolean> {
  const now = new Date().toISOString();
  // On a D1 without #406's columns no pull can hold drawn bytes, so the clause that guards them is left out (#419).
  const eligible = `id = ? AND status = 'prepared' ${drawColumns ? 'AND draw_randomness IS NULL' : ''}
    AND EXISTS (SELECT 1 FROM payment_obligations o WHERE o.pull_id = pulls.id AND o.status = 'pending')`;
  // In order, each condition true when its statement runs: the settlement row goes in while the pull is still prepared and
  // its payment pending; the obligation and the pull then follow that row. A committed settlement already there fails the
  // insert on its key and rolls the whole batch back.
  const settledHere = `EXISTS (SELECT 1 FROM pull_settlements s WHERE s.pull_id = ? AND s.kind = 'expired')`;
  try {
    await db.batch([
      db.prepare(`UPDATE users SET free_paid = free_paid + ?, free_common = free_common + ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM pulls WHERE ${eligible})`)
        .bind(pull.reserved_paid, pull.reserved_common, pull.user_id, pull.id),
      db.prepare(`INSERT INTO pull_settlements (pull_id, kind, created_at) SELECT id, 'expired', ? FROM pulls WHERE ${eligible}`)
        .bind(now, pull.id),
      db.prepare(`UPDATE payment_obligations SET status = 'refund_pending', reason = ?, updated_at = ?
        WHERE pull_id = ? AND status = 'pending' AND ${settledHere}`).bind(reason, now, pull.id, pull.id),
      db.prepare(`UPDATE pulls SET status = 'expired', resolved_at = ? WHERE id = ? AND status = 'prepared' AND ${settledHere}`)
        .bind(now, pull.id, pull.id),
    ]);
  } catch { /* a concurrent settlement won */ }
  const after = await db.prepare('SELECT status FROM pulls WHERE id = ?').bind(pull.id).first<{ status: string }>();
  return after?.status === 'expired';
}

export type Decided = { drawTimeouts: number; unsettled: number; settledForPlayer: number; cannotSettle: string[]; undecided: string[] };

export async function decideRefunds(db: D1Database, env: Env, config: RefundConfig, at = new Date()): Promise<Decided> {
  const decided: Decided = { drawTimeouts: 0, unsettled: 0, settledForPlayer: 0, cannotSettle: [], undecided: [] };
  const drawTimeoutMs = setting(env.DRAW_TIMEOUT_MS, 60_000, 'DRAW_TIMEOUT_MS');
  // A D1 that scripts/magicblock-draw.sql has not reached has no MagicBlock pulls, and no columns to ask about.
  const drawColumns = await hasDrawColumns(db);
  // Each list takes the pulls it looked at least recently first (never looked at before all), and stamps what it looks at,
  // so pulls a sweep can only skip (a chain it cannot read, a settle that keeps failing) cannot hold every sweep's places
  // (#420's review). A D1 that scripts/refunds.sql has not reached keeps the plain order.
  const checks = await hasTable(db, 'sweep_checks');
  const checkJoin = checks ? 'LEFT JOIN sweep_checks c ON c.pull_id = p.id' : '';
  const checkOrder = checks ? 'c.checked_at IS NOT NULL, c.checked_at, ' : '';
  const looked = async (pullId: string) => {
    if (checks) await db.prepare(`INSERT INTO sweep_checks (pull_id, checked_at) VALUES (?, ?)
      ON CONFLICT (pull_id) DO UPDATE SET checked_at = excluded.checked_at`).bind(pullId, new Date().toISOString()).run();
  };
  const tried = new Set<string>();

  // MagicBlock draws nobody re-committed: past the draw timeout with no bytes, exactly as a commit would fail them.
  const draws = !drawColumns ? { results: [] as PullRow[] } : await db.prepare(`SELECT p.* FROM pulls p ${checkJoin}
    WHERE p.status = 'prepared' AND p.draw_source = 'magicblock' AND p.draw_requested_at IS NOT NULL
      AND p.draw_requested_at <= ? AND p.draw_randomness IS NULL
    ORDER BY ${checkOrder}p.draw_requested_at LIMIT 50`)
    .bind(new Date(at.getTime() - drawTimeoutMs).toISOString()).all<PullRow>();
  for (const pull of draws.results) {
    await looked(pull.id);
    tried.add(pull.id);
    // The draw may have landed after the player's last commit gave up: then it is owed cards, never a refund (the README's
    // "a refund for a pull whose draw account was fulfilled" is the sign of a cheating house). Ask the chain first.
    if (await settledFromChain(db, env, pull, decided)) continue;
    await failDraw(db, pull);
    const after = await db.prepare('SELECT status FROM pulls WHERE id = ?').bind(pull.id).first<{ status: string }>();
    if (after?.status === 'expired') decided.drawTimeouts++;
  }

  // Any recorded payment still unsettled REFUND_AFTER_MS after it was recorded. Pulls whose drawn bytes are stored are
  // listed apart, so they can never take the places of refundable ones.
  const cutoff = new Date(at.getTime() - config.afterMs).toISOString();
  const stuck = await db.prepare(`SELECT p.* FROM payment_obligations o JOIN pulls p ON p.id = o.pull_id ${checkJoin}
    WHERE o.status = 'pending' AND p.status = 'prepared' AND o.created_at <= ?
      ${drawColumns ? 'AND p.draw_randomness IS NULL' : ''}
    ORDER BY ${checkOrder}o.created_at LIMIT 50`)
    .bind(cutoff).all<PullRow>();
  for (const pull of stuck.results) {
    if (tried.has(pull.id)) continue;
    await looked(pull.id);
    tried.add(pull.id);
    if (pull.draw_source === 'magicblock' && await settledFromChain(db, env, pull, decided)) continue;
    if (await failUnsettledPull(db, pull, 'UNSETTLED', drawColumns)) decided.unsettled++;
  }

  // Owed cards, not money: MagicBlock's bytes are stored, so the pull can only settle. Every sweep tries to settle it for the
  // player (a commit is safe to repeat: it reuses the stored bytes and settles once), and reports it only when that fails, so
  // one RPC blip or batch conflict never strands a paid pull. Past the draw timeout, so a player's own commit has had its turn.
  if (drawColumns) {
    const owedCards = await db.prepare(`SELECT p.* FROM payment_obligations o JOIN pulls p ON p.id = o.pull_id ${checkJoin}
      WHERE o.status = 'pending' AND p.status = 'prepared' AND o.created_at <= ? AND p.draw_randomness IS NOT NULL
      ORDER BY ${checkOrder}o.created_at LIMIT ?`)
      .bind(new Date(at.getTime() - drawTimeoutMs).toISOString(), OWED_CARDS_PER_SWEEP).all<PullRow>();
    for (const pull of owedCards.results) {
      if (tried.has(pull.id)) continue;
      await looked(pull.id);
      tried.add(pull.id);
      await settleForPlayer(db, env, pull, decided);
    }
  }
  return decided;
}

/** Settles retried a sweep. Each costs about 16 D1 statements when it fails and 27 when it settles (#420's review, measured in
 *  mock mode), so a pile of pulls that keep failing could otherwise take a sweep past D1's per-invocation limit and stop every
 *  refund behind them. The least recently checked go first, so all of them are reached in turn (#422). */
export const OWED_CARDS_PER_SWEEP = 10;

/** The commit the player's app never sent: its payment is recorded and its drawn bytes are stored, so this settles the cards
 *  into their binder. A failure is reported and the next sweep tries again. A pull already settled (the player's own commit
 *  got there first) is left alone and not counted. */
export async function settleForPlayer(db: D1Database, env: Env, pull: PullRow, decided: Decided): Promise<void> {
  const now = await db.prepare('SELECT status FROM pulls WHERE id = ?').bind(pull.id).first<{ status: string }>();
  if (now?.status !== 'prepared') return;
  try {
    await commitPull(db, env, pull.user_id, pull.id, pull.tx_signature ?? undefined);
    decided.settledForPlayer++;
  } catch (error) {
    console.error('paid pull has drawn bytes but could not be settled this sweep; the next sweep tries again',
      { pullId: pull.id, error: String(error) });
    decided.cannotSettle.push(pull.id);
  }
}

/** True when this MagicBlock pull must NOT be refunded: its draw landed (its bytes are stored and the pull is settled for the
 *  player, or reported if that fails), or the chain could not be asked (left for the next sweep, and reported). False only
 *  when the chain says no bytes exist for this pull, so a refund is right. */
async function settledFromChain(db: D1Database, env: Env, pull: PullRow, decided: Decided): Promise<boolean> {
  let state;
  try {
    state = await drawChain(env).read(pull.sequence);
  } catch (error) {
    console.error('a MagicBlock pull could not be checked on chain, so it is not refunded this sweep', { pullId: pull.id, error: String(error) });
    decided.undecided.push(pull.id);
    return true;
  }
  const own = state.exists && sameBytes(state.pullIdHash, await pullIdHash(pull.id))
    && sameBytes(state.poolHash, hexToBytes(pull.pool_hash ?? ''));
  if (!own || !state.randomness) return false;
  await db.prepare(`UPDATE pulls SET draw_randomness = ? WHERE id = ? AND status = 'prepared' AND draw_randomness IS NULL`)
    .bind(bytesToHex(state.randomness), pull.id).run();
  const stored = await db.prepare('SELECT * FROM pulls WHERE id = ?').bind(pull.id).first<PullRow>();
  if (stored?.status === 'prepared') await settleForPlayer(db, env, stored, decided);
  return true;
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return !!a && b.length > 0 && a.length === b.length && a.every((byte, i) => byte === b[i]);
}

// ------------------------------------------------------------------------------------------------------------------ send

export type PreparedRefund = { signature: string; transactionBase64: string; lastValidBlockHeight: number | null };
export interface RefundChain {
  /** The wallet that signed (owns the source of) this confirmed payment: where its refund goes. */
  payer(env: Env, paymentSignature: string, mint: string, treasury: string): Promise<string>;
  /** Signs the refund transfer. Throws INSUFFICIENT_FUNDS when the refund wallet cannot cover it (a low float). */
  prepare(env: Env, refund: { pullId: string; wallet: string; mint: string; amount: number }): Promise<PreparedRefund>;
  /** 'sent' once confirmed; 'void' when the chain proves it can never move money, so it may be signed again. */
  broadcast(env: Env, refund: PreparedRefund): Promise<'sent' | 'void'>;
}

type RefundRow = {
  pull_id: string; payment_signature: string; wallet: string; mint: string; amount: number;
  status: 'reserved' | 'prepared' | 'sent'; signature: string | null; transaction_base64: string | null;
  last_valid_block_height: number | null; created_at: string;
};

export type Sent = { sent: number; stoppedBy: 'batch' | 'daily-cap' | 'float' | null; errors: string[] };

function assetAccounts(env: Env, asset: Asset): { mint: string; treasury: string } {
  const mint = asset === 'USDC' ? env.USDC_MINT : env.USDT_MINT;
  const treasury = asset === 'USDC' ? env.TREASURY_USDC_TOKEN_ACCOUNT : env.TREASURY_USDT_TOKEN_ACCOUNT;
  if (!mint || !treasury) throw new ApiError('UNKNOWN', `${asset} has no mint or treasury configured`, 503);
  return { mint, treasury };
}

export async function sendRefunds(db: D1Database, env: Env, config: RefundConfig, chain: RefundChain,
  at = new Date()): Promise<Sent> {
  const result: Sent = { sent: 0, stoppedBy: null, errors: [] };
  if (!config.sending) return result;
  if (!(await hasTable(db, 'refunds')) || !(await hasTable(db, 'refund_attempts'))) {
    // Sending is on but scripts/refunds.sql has not reached this D1: nothing can be recorded, so nothing is sent.
    console.error('refunds are enabled but a refund table is missing; apply scripts/refunds.sql');
    result.errors.push('refund tables missing');
    return result;
  }
  const dayStart = `${at.toISOString().slice(0, 10)}T00:00:00.000Z`;
  // Least recently attempted first (never attempted before all), so refunds that keep failing cannot hold the batch's places.
  const owed = await db.prepare(`SELECT o.pull_id, r.signature AS payment_signature, r.amount, r.asset
    FROM payment_obligations o JOIN payment_receipts r ON r.pull_id = o.pull_id
    LEFT JOIN refund_attempts a ON a.pull_id = o.pull_id
    WHERE o.status = 'refund_pending' ORDER BY a.attempted_at IS NOT NULL, a.attempted_at, o.updated_at LIMIT ?`).bind(config.batch)
    .all<{ pull_id: string; payment_signature: string; amount: number; asset: Asset }>();

  for (const item of owed.results) {
    await db.prepare(`INSERT INTO refund_attempts (pull_id, attempts, attempted_at) VALUES (?, 1, ?)
      ON CONFLICT (pull_id) DO UPDATE SET attempts = attempts + 1, attempted_at = excluded.attempted_at`)
      .bind(item.pull_id, new Date().toISOString()).run();
    try {
      let row = await db.prepare('SELECT * FROM refunds WHERE pull_id = ?').bind(item.pull_id).first<RefundRow>();
      if (!row) {
        // A new refund counts against the day's cap before anything is signed.
        const today = (await db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE created_at >= ?')
          .bind(dayStart).first<{ total: number }>())?.total ?? 0;
        if (today + item.amount > config.dailyCapBase) {
          console.error('refund daily cap reached; the rest wait for tomorrow or a raised cap', { today, cap: config.dailyCapBase });
          result.stoppedBy = 'daily-cap';
          break;
        }
        const { mint, treasury } = assetAccounts(env, item.asset);
        const wallet = await chain.payer(env, item.payment_signature, mint, treasury);
        await db.prepare(`INSERT OR IGNORE INTO refunds (pull_id, payment_signature, wallet, mint, amount, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'reserved', ?)`).bind(item.pull_id, item.payment_signature, wallet, mint, item.amount,
          new Date().toISOString()).run();
        row = await db.prepare('SELECT * FROM refunds WHERE pull_id = ?').bind(item.pull_id).first<RefundRow>();
        if (!row) throw new Error('refund row was not reserved');
      }
      if (row.status === 'sent') { await markRefunded(db, row.pull_id); continue; }
      if (row.status === 'reserved') {
        const prepared = await chain.prepare(env, { pullId: row.pull_id, wallet: row.wallet, mint: row.mint, amount: row.amount });
        await db.prepare(`UPDATE refunds SET status = 'prepared', signature = ?, transaction_base64 = ?,
          last_valid_block_height = ? WHERE pull_id = ? AND status = 'reserved'`)
          .bind(prepared.signature, prepared.transactionBase64, prepared.lastValidBlockHeight, row.pull_id).run();
        row = (await db.prepare('SELECT * FROM refunds WHERE pull_id = ?').bind(row.pull_id).first<RefundRow>())!;
      }
      if (row.status !== 'prepared') continue;
      const outcome = await chain.broadcast(env, {
        signature: row.signature!, transactionBase64: row.transaction_base64!, lastValidBlockHeight: row.last_valid_block_height,
      });
      if (outcome === 'void') {
        // Proven unable to land: back to reserved, and the next sweep signs it again.
        await db.prepare(`UPDATE refunds SET status = 'reserved', signature = NULL, transaction_base64 = NULL,
          last_valid_block_height = NULL WHERE pull_id = ? AND status = 'prepared' AND signature = ?`)
          .bind(row.pull_id, row.signature).run();
        continue;
      }
      const now = new Date().toISOString();
      await db.batch([
        db.prepare(`UPDATE refunds SET status = 'sent', sent_at = ? WHERE pull_id = ? AND status = 'prepared'`).bind(now, row.pull_id),
        db.prepare(`UPDATE payment_obligations SET status = 'refunded', updated_at = ? WHERE pull_id = ? AND status = 'refund_pending'`)
          .bind(now, row.pull_id),
      ]);
      result.sent++;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_FUNDS') {
        console.error('refund wallet float is too low to refund; top it up', { pullId: item.pull_id, amount: item.amount });
        result.stoppedBy = 'float';
        break;
      }
      console.error('refund could not be sent this sweep; it is retried on the next', { pullId: item.pull_id, error: String(error) });
      result.errors.push(item.pull_id);
    }
  }
  if (!result.stoppedBy && owed.results.length >= config.batch) result.stoppedBy = 'batch';
  return result;
}

async function markRefunded(db: D1Database, pullId: string): Promise<void> {
  await db.prepare(`UPDATE payment_obligations SET status = 'refunded', updated_at = ? WHERE pull_id = ? AND status = 'refund_pending'`)
    .bind(new Date().toISOString(), pullId).run();
}

export async function runRefundSweep(db: D1Database, env: Env, chain: RefundChain = refundChain(env), at = new Date()) {
  const config = refundConfig(env);
  const decided = await decideRefunds(db, env, config, at);
  const sent = await sendRefunds(db, env, config, chain, at);
  return { decided, sent, sending: config.sending };
}

// ----------------------------------------------------------------------------------------------------------------- chains

export function refundChain(env: Env): RefundChain {
  return refundConfig(env).chain === 'fake' ? fakeRefundChain : solanaRefundChain;
}

function refundKey(secret: string | undefined): Uint8Array {
  if (!secret) throw new ApiError('UNKNOWN', 'The refund wallet is not configured', 503);
  let parsed: unknown;
  try { parsed = JSON.parse(secret); } catch { throw new ApiError('UNKNOWN', 'The refund wallet key is invalid', 503); }
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
    throw new ApiError('UNKNOWN', 'The refund wallet key is invalid', 503);
  }
  return Uint8Array.from(parsed as number[]);
}

async function rpc<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => { throw new ApiError('UNKNOWN', 'Refund RPC is unavailable', 503); });
  if (!response.ok) throw new ApiError('UNKNOWN', 'Refund RPC is unavailable', 503);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) console.error('refund rpc error', method, payload.error.message);
  if (payload.error || payload.result === undefined) throw new ApiError('UNKNOWN', 'Refund RPC returned an error', 503);
  return payload.result;
}

type ParsedIx = { program?: string; parsed?: { type?: string; info?: { authority?: string; destination?: string; mint?: string } } };

/** How long a broadcast waits for confirmation in one sweep: 24 × 500 ms. Tests shorten it. */
export const refundTiming = { polls: 24, intervalMs: 500 };

export const solanaRefundChain: RefundChain = {
  async payer(env, paymentSignature, mint, treasury) {
    // The authority of the payment's one TransferChecked into the treasury: the wallet that paid, whatever the account says now.
    const tx = await rpc<{ meta: { err: unknown }; transaction: { message: { instructions: ParsedIx[] } } } | null>(env,
      'getTransaction', [paymentSignature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (!tx || tx.meta.err) throw new ApiError('UNKNOWN', 'The payment transaction could not be read', 503);
    const transfers = tx.transaction.message.instructions.filter((ix) => ix.parsed?.type === 'transferChecked'
      && ix.parsed.info?.mint === mint && ix.parsed.info.destination === treasury);
    const authority = transfers.length === 1 ? transfers[0].parsed?.info?.authority : undefined;
    if (!authority) throw new ApiError('UNKNOWN', 'The payment has no single transfer to the treasury', 503);
    return authority;
  },

  async prepare(env, refund) {
    const wallet = await createKeyPairSignerFromBytes(refundKey(env.REFUND_KEYPAIR));
    if (!env.REFUND_ADDRESS || wallet.address !== address(env.REFUND_ADDRESS)) {
      throw new ApiError('UNKNOWN', 'The refund key does not match REFUND_ADDRESS', 503);
    }
    const mint = address(refund.mint);
    const owner = address(refund.wallet);
    const client = await createClient().use(signer(wallet)).use(solanaMainnetRpc({ rpcUrl: env.SOLANA_RPC_URL }));
    const [source] = await findAssociatedTokenPda({ owner: wallet.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [destination] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const float = await fetchMaybeToken(client.rpc, source, { commitment: 'confirmed' });
    if (!float.exists || float.data.owner !== wallet.address || float.data.mint !== mint
      || float.data.amount < BigInt(refund.amount)) {
      throw new ApiError('INSUFFICIENT_FUNDS', 'The refund wallet cannot cover this refund', 503);
    }
    const signed = await client.signTransaction([
      getCreateAssociatedTokenIdempotentInstruction({ payer: wallet, ata: destination, owner, mint }),
      getTransferCheckedInstruction({ source, mint, destination, authority: wallet, amount: BigInt(refund.amount),
        decimals: TOKEN_DECIMALS }),
      getAddMemoInstruction({ memo: `refund:${refund.pullId}` }),
    ]);
    if (!signed.context.signature) throw new ApiError('UNKNOWN', 'The refund transaction was not fully signed', 503);
    return { signature: signed.context.signature, transactionBase64: signed.context.transactionBase64,
      lastValidBlockHeight: signedLifetime(signed.context.transaction) };
  },

  async broadcast(env, refund) {
    // The chain first, by #273's rule: landed is sent; failed or proven expired is void (signed again); else send and wait.
    const state = await paymentState(env, refund.signature, refund.lastValidBlockHeight);
    if (state === 'confirmed') return 'sent';
    if (state === 'failed' || state === 'expired') return 'void';
    try {
      await rpc<string>(env, 'sendTransaction', [refund.transactionBase64,
        { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 }]);
    } catch { /* ambiguous (a lost answer, an "already processed"): the stored signature decides below */ }
    for (let attempt = 0; attempt < refundTiming.polls; attempt += 1) {
      const status = (await rpc<{ value?: ({ err: unknown; confirmationStatus?: ConfirmationStatus } | null)[] }>(env,
        'getSignatureStatuses', [[refund.signature], { searchTransactionHistory: true }])).value?.[0];
      if (status?.err && hasConfirmed(status.confirmationStatus)) return 'void';
      if (status && !status.err && hasConfirmed(status.confirmationStatus)) return 'sent';
      await new Promise((resolve) => setTimeout(resolve, refundTiming.intervalMs));
    }
    throw new ApiError('UNKNOWN', 'The refund is still confirming; the next sweep picks it up', 503);
  },
};

// The fake chain (local and tests): payer is read from the payment's mock signature's pull owner, sends always confirm unless
// a test says otherwise through `fakeRefunds`.
export const fakeRefunds = {
  float: Number.POSITIVE_INFINITY,
  broadcastOutcomes: [] as ('sent' | 'void' | 'throw')[],
  /** Runs inside a broadcast, before it answers: a test's stand-in for another sweep acting meanwhile. */
  onBroadcast: null as null | (() => Promise<void>),
  prepared: [] as { pullId: string; wallet: string; amount: number; signature: string }[],
  payers: new Map<string, string>(),
  reset() {
    this.float = Number.POSITIVE_INFINITY; this.broadcastOutcomes = []; this.prepared = []; this.payers.clear(); this.onBroadcast = null;
  },
};

export const fakeRefundChain: RefundChain = {
  async payer(_env, paymentSignature) {
    const wallet = fakeRefunds.payers.get(paymentSignature);
    if (!wallet) throw new ApiError('UNKNOWN', 'The payment transaction could not be read', 503);
    return wallet;
  },
  async prepare(_env, refund) {
    if (fakeRefunds.float < refund.amount) throw new ApiError('INSUFFICIENT_FUNDS', 'The refund wallet cannot cover this refund', 503);
    fakeRefunds.float -= refund.amount;
    const signature = `fake-refund-${refund.pullId}-${fakeRefunds.prepared.length}`;
    fakeRefunds.prepared.push({ pullId: refund.pullId, wallet: refund.wallet, amount: refund.amount, signature });
    return { signature, transactionBase64: `tx:${signature}`, lastValidBlockHeight: 1 };
  },
  async broadcast() {
    if (fakeRefunds.onBroadcast) await fakeRefunds.onBroadcast();
    const next = fakeRefunds.broadcastOutcomes.shift() ?? 'sent';
    if (next === 'throw') throw new ApiError('UNKNOWN', 'The refund is still confirming; the next sweep picks it up', 503);
    return next;
  },
};
