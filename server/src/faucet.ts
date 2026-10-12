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
import { ApiError } from './http';
import { hasConfirmed, paymentState, type ConfirmationStatus } from './payments';
import type { Env } from './types';

const TOKEN_DECIMALS = 6;

type GrantRow = {
  id: string;
  user_id: string;
  wallet: string;
  mint: string;
  amount: number;
  status: 'reserved' | 'prepared' | 'sent';
  signature: string | null;
  transaction_base64: string | null;
  last_valid_block_height: number | null;
  sent_at: string | null;
};

/** `lastValidBlockHeight` is an upper bound on the height the transfer's blockhash is valid through; null when unknown. */
export type PreparedFaucetTransfer = { signature: string; transactionBase64: string; lastValidBlockHeight: number | null };
export interface FaucetChain {
  prepare(env: Env, grant: Pick<GrantRow, 'id' | 'wallet' | 'mint' | 'amount'>): Promise<PreparedFaucetTransfer>;
  /** 'sent' once the transfer is confirmed; 'void' when the chain proves it can never move money (it failed on chain, or
   *  its blockhash expired with no status), so the grant may be signed again. Anything unproven throws. */
  broadcast(env: Env, transfer: PreparedFaucetTransfer): Promise<'sent' | 'void'>;
}

function enabled(env: Env): boolean {
  return env.ENVIRONMENT === 'preview' && env.PAYMENTS_MODE === 'solana-rpc' && env.FAUCET_ENABLED === 'true';
}

function grantAmount(env: Env): number {
  const amount = Number(env.FAUCET_GRANT_BASE);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ApiError('UNKNOWN', 'Faucet amount is not configured', 503);
  return amount;
}

function keypairBytes(secret: string | undefined): Uint8Array {
  if (!secret) throw new ApiError('UNKNOWN', 'Faucet signer is not configured', 503);
  let parsed: unknown;
  try { parsed = JSON.parse(secret); }
  catch { throw new ApiError('UNKNOWN', 'Faucet signer is invalid', 503); }
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new ApiError('UNKNOWN', 'Faucet signer is invalid', 503);
  }
  return Uint8Array.from(parsed as number[]);
}

async function rpc<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });
  if (!response.ok) throw new ApiError('UNKNOWN', 'Faucet RPC is unavailable', 503);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  // The node's own message stays in the log, never in a response (#273: it carried simulation logs to the client).
  if (payload.error) console.error('faucet rpc error', method, payload.error.message);
  if (payload.error || payload.result === undefined) throw new ApiError('UNKNOWN', 'Faucet RPC returned an error', 503);
  return payload.result;
}

type SignatureStatus = { err: unknown; confirmationStatus?: ConfirmationStatus } | null | undefined;
const signatureStatus = async (env: Env, signature: string): Promise<SignatureStatus> =>
  (await rpc<{ value?: SignatureStatus[] }>(env, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value?.[0];

/** A grant retrying may not finish: it was reserved under another mint or amount, its signed transfer's wallet is no longer
 *  this account's, or a transfer from before the stored lifetime cannot be proven expired. Hedged, because the last case
 *  can be a lagging node (README → "A stuck faucet grant"). */
export const FAUCET_STUCK = 'This account’s test grant may need a hand fix';

/** The last block height the signed transfer's own blockhash is valid through, read off the transaction the SDK signed
 *  (PR #309's second review). A second `getLatestBlockhash` was not a bound: behind one load-balanced URL it can land on a
 *  node that is behind, answer LOWER than the transfer's, and void a transfer that could still land, signing a second one.
 *  Anything unreadable is null, the safe direction: a null lifetime is never voided by expiry. */
export function signedLifetime(transaction: unknown): number | null {
  const lifetime = (transaction as { lifetimeConstraint?: { blockhash?: unknown; lastValidBlockHeight?: unknown } } | null)
    ?.lifetimeConstraint;
  const height = lifetime?.lastValidBlockHeight;
  if (typeof lifetime?.blockhash !== 'string' || typeof height !== 'bigint') return null;
  const value = Number(height);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export const solanaFaucetChain: FaucetChain = {
  async prepare(env, grant) {
    const feePayer = await createKeyPairSignerFromBytes(keypairBytes(env.FEE_PAYER_KEYPAIR));
    if (!env.FEE_PAYER_ADDRESS || feePayer.address !== address(env.FEE_PAYER_ADDRESS)) {
      throw new ApiError('UNKNOWN', 'Faucet signer does not match the configured fee payer', 503);
    }
    const mint = address(grant.mint);
    const owner = address(grant.wallet);
    const client = await createClient()
      .use(signer(feePayer))
      .use(solanaMainnetRpc({ rpcUrl: env.SOLANA_RPC_URL }));
    const [source] = await findAssociatedTokenPda({ owner: feePayer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [destination] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const sourceAccount = await fetchMaybeToken(client.rpc, source, { commitment: 'confirmed' });
    if (!sourceAccount.exists || sourceAccount.data.owner !== feePayer.address || sourceAccount.data.mint !== mint) {
      throw new ApiError('UNKNOWN', 'Faucet token account is not funded', 503);
    }
    if (sourceAccount.data.amount < BigInt(grant.amount)) throw new ApiError('INSUFFICIENT_FUNDS', 'The development faucet is empty', 503);

    const signed = await client.signTransaction([
      getCreateAssociatedTokenIdempotentInstruction({ payer: feePayer, ata: destination, owner, mint }),
      getTransferCheckedInstruction({ source, mint, destination, authority: feePayer,
        amount: BigInt(grant.amount), decimals: TOKEN_DECIMALS }),
      getAddMemoInstruction({ memo: `faucet:${grant.id}` }),
    ]);
    if (!signed.context.signature) throw new ApiError('UNKNOWN', 'Faucet transaction was not fully signed', 503);
    return { signature: signed.context.signature, transactionBase64: signed.context.transactionBase64,
      lastValidBlockHeight: signedLifetime(signed.context.transaction) };
  },

  async broadcast(env, transfer) {
    // The chain first (#304), by #273's rule: a transfer that already landed (its first answer lost) is `sent`; one that
    // failed on chain, or whose blockhash is proven expired with no status, moved nothing and is `void`, signed again. A
    // landed transfer used to fail simulation, and a failed or expired one said "try again" for ever.
    const state = await paymentState(env, transfer.signature, transfer.lastValidBlockHeight);
    if (state === 'confirmed') return 'sent';
    if (state === 'failed' || state === 'expired') return 'void';
    const simulation = await rpc<{ value?: { err?: unknown } }>(env, 'simulateTransaction', [
      transfer.transactionBase64,
      { encoding: 'base64', commitment: 'confirmed', sigVerify: true },
    ]);
    if (!simulation.value || simulation.value.err != null) {
      console.error('faucet simulation failed', JSON.stringify(simulation.value?.err));
      // A lagging node says BlockhashNotFound about a fresh blockhash too (#273), so it proves nothing. With a stored lifetime
      // the check above settles it on a later try. Without one (a grant from before the column) no try ever can: that is
      // the hedged hand-fix answer.
      if (simulation.value?.err === 'BlockhashNotFound' && transfer.lastValidBlockHeight === null) {
        throw new ApiError('UNKNOWN', FAUCET_STUCK, 409);
      }
      throw new ApiError('UNKNOWN', 'The faucet transfer could not be simulated', 503);
    }
    let sendError: unknown;
    try {
      const signature = await rpc<string>(env, 'sendTransaction', [
        transfer.transactionBase64,
        { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 },
      ]);
      if (signature !== transfer.signature) throw new ApiError('UNKNOWN', 'Faucet RPC returned a different signature', 503);
    } catch (error) {
      // A lost send response or an "already processed" retry is ambiguous. The
      // persisted signature is authoritative, so reconcile it before failing.
      sendError = error;
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const status = await signatureStatus(env, transfer.signature);
      if (status?.err && hasConfirmed(status.confirmationStatus)) return 'void'; // failed on chain: nothing moved
      if (!status?.err && hasConfirmed(status?.confirmationStatus)) return 'sent';
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (sendError instanceof ApiError) throw sendError;
    throw new ApiError('UNKNOWN', 'Faucet transfer is still confirming; retry safely', 503);
  },
};

/** Turns a link check that throws into a yes / no: only a definite "not linked" (403) is no. A directory outage, or anything
 *  else, stays the error it was, so a retryable failure is never answered with the hand-fix message (#304). */
export const linkedBy = (check: (wallet: string) => Promise<unknown>) => (wallet: string): Promise<boolean> =>
  check(wallet).then(() => true, (error: unknown) => {
    if (error instanceof ApiError && error.status === 403) return false;
    throw error;
  });

/** `wallet`: where the account's grant went, once sent, so the app can say so after a reload (#304). */
export function faucetInfo(env: Env, sentTo: string | null) {
  if (!enabled(env)) return undefined;
  return { asset: 'USDC' as const, amount: grantAmount(env), claimed: sentTo !== null, ...(sentTo ? { wallet: sentTo } : {}) };
}

/** The wallet the account's one grant was sent to, whichever it was (#276), or null before it is sent. */
export async function faucetGrantWallet(db: D1Database, userId: string): Promise<string | null> {
  return (await db.prepare("SELECT wallet FROM faucet_grants WHERE user_id = ? AND status = 'sent' ORDER BY created_at, id LIMIT 1")
    .bind(userId).first<{ wallet: string }>())?.wallet ?? null;
}

export async function claimFaucet(
  db: D1Database,
  env: Env,
  userId: string,
  // `targetWallet` has been checked as this account's by the caller. `isLinked` answers whether any other wallet still is: an
  // unfinished grant promised to a wallet may be finished only while that wallet is the account's own (#304). Without one,
  // only the account's own wallet counts.
  options: { targetWallet?: string; chain?: FaucetChain; isLinked?: (wallet: string) => Promise<boolean>; resigned?: boolean } = {},
): Promise<{ asset: 'USDC'; amount: number; signature: string; wallet: string; alreadyClaimed: boolean }> {
  if (!enabled(env)) throw new ApiError('UNKNOWN', 'The development faucet is not available', 404);
  const user = await db.prepare('SELECT wallet FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId).first<{ wallet: string }>();
  if (!user) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);
  const destinationWallet = options.targetWallet ?? user.wallet;
  const chain = options.chain ?? solanaFaucetChain;
  const amount = grantAmount(env);
  const now = new Date().toISOString();
  // One grant per account, to whichever wallet it first asks for (#276). Since #256 the table's key was (user, wallet), so
  // each wallet linked to one account drew its own grant, and each new wallet cost the fee payer a token account's rent.
  // One statement, so two concurrent claims cannot both find no grant: SQLite runs a single INSERT … SELECT atomically.
  // Written as a condition rather than a UNIQUE(user_id) so it holds on a database created under the (user, wallet) key,
  // which may already hold two grants for one account (the oldest is then the account's grant).
  await db.prepare(`INSERT OR IGNORE INTO faucet_grants
    (id, user_id, wallet, mint, amount, status, created_at)
    SELECT ?, ?, ?, ?, ?, 'reserved', ? WHERE NOT EXISTS (SELECT 1 FROM faucet_grants WHERE user_id = ?)`)
    .bind(crypto.randomUUID(), userId, destinationWallet, env.USDC_MINT, amount, now, userId).run();

  // The grant that may already have moved money wins: sent first, then prepared (a signed transaction that may have landed
  // and is re-broadcast, which checks its signature on chain), and only then the oldest reserved one. On a database from the
  // per-wallet key an account can hold an older unfinished grant beside a newer sent or prepared one (the first wallet's
  // prepare failed, the second's went out): preparing the older one sent a second grant (PR #302's reviews, both reproduced).
  // A prepared grant whose transaction never lands and has expired then fails every retry: the account waits on a hand fix
  // rather than risk a second send.
  let grant = await db.prepare(`SELECT * FROM faucet_grants WHERE user_id = ?
    ORDER BY CASE status WHEN 'sent' THEN 0 WHEN 'prepared' THEN 1 ELSE 2 END, created_at, id LIMIT 1`).bind(userId).first<GrantRow>();
  if (!grant) throw new ApiError('UNKNOWN', 'Could not reserve faucet grant', 503);
  if (grant.status === 'sent') {
    return { asset: 'USDC' as const, amount: grant.amount, signature: grant.signature!, wallet: grant.wallet, alreadyClaimed: true };
  }
  if (grant.mint !== env.USDC_MINT || grant.amount !== amount) {
    console.error('faucet grant does not match configuration', grant.id);
    throw new ApiError('UNKNOWN', FAUCET_STUCK, 409);
  }
  if (grant.status === 'reserved') {
    // Nothing is signed yet, so the grant goes to the wallet this request names, checked as the account's by the caller
    // (#304). Finishing it to the wallet it was first reserved for skipped that check, and that wallet may have been unlinked.
    // The wallet is written with the signed transfer in one statement, so the row always names the wallet its transfer pays.
    const prepared = await chain.prepare(env, { ...grant, wallet: destinationWallet });
    try {
      await db.prepare(`UPDATE faucet_grants SET status = 'prepared', wallet = ?, signature = ?, transaction_base64 = ?,
        last_valid_block_height = ? WHERE id = ? AND status = 'reserved' AND signature IS NULL`)
        .bind(destinationWallet, prepared.signature, prepared.transactionBase64, prepared.lastValidBlockHeight, grant.id).run();
    } catch (error) {
      // Only the per-wallet key's conflict is the hand fix: another of this account's rows already names that wallet
      // (UNIQUE (user_id, wallet), a database from before #276). Anything else, a D1 blip or a missing column, stays the
      // retryable error it was (PR #309's second review). Nothing was sent either way; the signed transfer is dropped.
      if (!/UNIQUE constraint failed: faucet_grants\.user_id, faucet_grants\.wallet/.test(String(error))) throw error;
      console.error('faucet grant could not take this wallet: another of the account\'s rows names it', grant.id);
      throw new ApiError('UNKNOWN', FAUCET_STUCK, 409);
    }
    grant = await db.prepare('SELECT * FROM faucet_grants WHERE id = ?').bind(grant.id).first<GrantRow>();
    if (!grant) throw new ApiError('UNKNOWN', 'Faucet grant disappeared', 503);
  } else if (grant.wallet !== destinationWallet && grant.wallet !== user.wallet
    && !(await (options.isLinked ?? (async () => false))(grant.wallet))) {
    // A signed transfer is bound to its wallet. Sent there only while that wallet is still this account's (#304).
    console.error('faucet grant wallet is no longer linked', grant.id);
    throw new ApiError('UNKNOWN', FAUCET_STUCK, 409);
  }
  if (!grant.signature || !grant.transaction_base64) throw new ApiError('UNKNOWN', 'Faucet grant is incomplete', 503);
  // `alreadyClaimed` whenever this request's wallet is not the one the account's grant went to, so no caller is told it was
  // funded when another wallet was; `wallet` says where the grant went.
  const elsewhere = grant.wallet !== destinationWallet;

  const outcome = await chain.broadcast(env, { signature: grant.signature, transactionBase64: grant.transaction_base64,
    lastValidBlockHeight: grant.last_valid_block_height });
  if (outcome === 'void') {
    // Proven never to move money: back to reserved, and signed again once, to the wallet this claim names.
    await db.prepare(`UPDATE faucet_grants SET status = 'reserved', signature = NULL, transaction_base64 = NULL,
      last_valid_block_height = NULL WHERE id = ? AND status = 'prepared' AND signature = ?`).bind(grant.id, grant.signature).run();
    if (options.resigned) throw new ApiError('UNKNOWN', 'The faucet transfer did not go through; retry safely', 503);
    return claimFaucet(db, env, userId, { ...options, resigned: true });
  }
  const sentAt = new Date().toISOString();
  await db.prepare(`UPDATE faucet_grants SET status = 'sent', sent_at = ?
    WHERE id = ? AND status = 'prepared' AND signature = ?`).bind(sentAt, grant.id, grant.signature).run();
  return { asset: 'USDC' as const, amount: grant.amount, signature: grant.signature, wallet: grant.wallet, alreadyClaimed: elsewhere };
}
