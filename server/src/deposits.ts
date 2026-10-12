import { address } from '@solana/kit';
import { ApiError } from './http';
import {
  acceptUserSignedTransaction,
  broadcastPaymentTransaction,
  buildDepositWithLifetime,
  PaymentOutcome,
} from './payments';
import type { Env } from './types';

const DEPOSIT_LIFETIME_MS = 90_000;

type DepositStatus = 'prepared' | 'signed' | 'committed';
type DepositRow = {
  id: string;
  user_id: string;
  idem: string;
  source_wallet: string;
  destination_wallet: string;
  mint: string;
  amount: number;
  status: DepositStatus;
  expires_at: string;
  transaction_base64: string;
  signed_transaction_base64: string | null;
  tx_signature: string | null;
  last_valid_block_height: number | null;
  created_at: string;
  committed_at: string | null;
};

export interface DepositChain {
  build(env: Env, input: { sourceWallet: string; destinationWallet: string; memo: string; amount: number }): Promise<{
    transactionBase64: string;
    lastValidBlockHeight: number | null;
  }>;
  accept(prepared: string, signed: string, wallet: string): Promise<{ signature: string; transactionBase64: string }>;
  broadcast(env: Env, transactionBase64: string, lastValidBlockHeight: number | null): Promise<string>;
}

const solanaChain: DepositChain = {
  build: buildDepositWithLifetime,
  accept: acceptUserSignedTransaction,
  broadcast: broadcastPaymentTransaction,
};

/** The signed bytes can never move money, so the same idempotency key may be built again (#266). `release` is the proof:
 *  the transfer failed on chain, or a confirmed block height is past the stored lifetime. A row with no stored lifetime
 *  can never get that proof; the EXPIRED its broadcast already reports is what unsticks it. Anything else (a lost
 *  response, not enough funds, still confirming) keeps the signature, and the next try sends those same bytes. */
function depositSignatureIsDead(error: unknown, storedLifetime: number | null): boolean {
  if (!(error instanceof PaymentOutcome)) return false;
  if (error.release) return true;
  return storedLifetime == null && error.code === 'EXPIRED';
}

async function reopenSignedDeposit(db: D1Database, id: string, userId: string, signature: string): Promise<void> {
  // Expire the prepared row so the next build replaces the bytes. The id stays: it is the same deposit.
  await db.prepare(`UPDATE deposits SET status = 'prepared', expires_at = ?, signed_transaction_base64 = NULL,
      tx_signature = NULL, last_valid_block_height = NULL
      WHERE id = ? AND user_id = ? AND status = 'signed' AND tx_signature = ?`)
    .bind(new Date(0).toISOString(), id, userId, signature).run();
}

function wallet(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ApiError('UNKNOWN', `Invalid ${label}`);
  try { return address(value); }
  catch { throw new ApiError('UNKNOWN', `Invalid ${label}`); }
}

function amount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ApiError('UNKNOWN', 'Invalid deposit amount');
  return parsed;
}

function preparedResponse(row: DepositRow) {
  return {
    depositId: row.id,
    asset: 'USDC' as const,
    amount: row.amount,
    destination: row.destination_wallet,
    transactionBase64: row.transaction_base64,
    expiresAt: row.expires_at,
    status: row.status,
    ...(row.tx_signature ? { signature: row.tx_signature } : {}),
  };
}

async function byIdem(db: D1Database, userId: string, idem: string) {
  return db.prepare('SELECT * FROM deposits WHERE user_id = ? AND idem = ?')
    .bind(userId, idem).first<DepositRow>();
}

export async function buildDeposit(
  db: D1Database,
  env: Env,
  userId: string,
  input: Record<string, unknown>,
  idem: string,
  chain: DepositChain = solanaChain,
) {
  const sourceWallet = wallet(input.sourceWallet, 'source wallet');
  const depositAmount = amount(input.amount);
  const user = await db.prepare('SELECT wallet FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId).first<{ wallet: string }>();
  if (!user) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);

  let row = await byIdem(db, userId, idem);
  if (row && (row.source_wallet !== sourceWallet || row.destination_wallet !== user.wallet
    || row.mint !== env.USDC_MINT || row.amount !== depositAmount)) {
    throw new ApiError('TX_MISMATCH', 'That idempotency key belongs to a different deposit');
  }
  if (row && (row.status !== 'prepared' || Date.parse(row.expires_at) > Date.now())) return preparedResponse(row);

  const id = row?.id ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + DEPOSIT_LIFETIME_MS).toISOString();
  const built = await chain.build(env, {
    sourceWallet,
    destinationWallet: user.wallet,
    amount: depositAmount,
    memo: `deposit:${id}`,
  });
  const now = new Date().toISOString();
  if (row) {
    await db.prepare(`UPDATE deposits SET status = 'prepared', expires_at = ?, transaction_base64 = ?,
      signed_transaction_base64 = NULL, tx_signature = NULL, last_valid_block_height = ?, committed_at = NULL
      WHERE id = ? AND user_id = ? AND status = 'prepared'`)
      .bind(expiresAt, built.transactionBase64, built.lastValidBlockHeight, id, userId).run();
  } else {
    await db.prepare(`INSERT OR IGNORE INTO deposits
      (id, user_id, idem, source_wallet, destination_wallet, mint, amount, status, expires_at,
       transaction_base64, last_valid_block_height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`).bind(
      id, userId, idem, sourceWallet, user.wallet, env.USDC_MINT, depositAmount,
      expiresAt, built.transactionBase64, built.lastValidBlockHeight, now,
    ).run();
  }
  row = await byIdem(db, userId, idem);
  if (!row) throw new ApiError('UNKNOWN', 'Could not build deposit', 503);
  return preparedResponse(row);
}

function committedResponse(row: DepositRow) {
  if (!row.tx_signature) throw new ApiError('UNKNOWN', 'Deposit receipt is incomplete', 503);
  return {
    depositId: row.id,
    asset: 'USDC' as const,
    amount: row.amount,
    destination: row.destination_wallet,
    signature: row.tx_signature,
  };
}

export async function submitDeposit(
  db: D1Database,
  env: Env,
  userId: string,
  depositId: string,
  signedTransactionBase64: string | undefined,
  chain: DepositChain = solanaChain,
) {
  let row = await db.prepare('SELECT * FROM deposits WHERE id = ? AND user_id = ?')
    .bind(depositId, userId).first<DepositRow>();
  if (!row) throw new ApiError('UNKNOWN', 'Deposit not found', 404);
  if (row.status === 'committed') return committedResponse(row);

  if (row.status === 'prepared') {
    if (Date.parse(row.expires_at) <= Date.now()) throw new ApiError('EXPIRED', 'The deposit authorization expired');
    if (!signedTransactionBase64) throw new ApiError('TX_NOT_FOUND', 'The connected wallet signature is required');
    const accepted = await chain.accept(row.transaction_base64, signedTransactionBase64, row.source_wallet);
    await db.prepare(`UPDATE deposits SET status = 'signed', signed_transaction_base64 = ?, tx_signature = ?
      WHERE id = ? AND user_id = ? AND status = 'prepared' AND tx_signature IS NULL`)
      .bind(accepted.transactionBase64, accepted.signature, row.id, userId).run();
    row = await db.prepare('SELECT * FROM deposits WHERE id = ? AND user_id = ?')
      .bind(row.id, userId).first<DepositRow>();
    if (!row) throw new ApiError('UNKNOWN', 'Deposit disappeared', 503);
  }

  const signedTransaction = row.signed_transaction_base64;
  const storedSignature = row.tx_signature;
  if (!signedTransaction || !storedSignature) {
    throw new ApiError('UNKNOWN', 'Deposit authorization is incomplete', 503);
  }
  const rowId = row.id;
  const depositUserId = row.user_id;
  const storedLifetime = row.last_valid_block_height ?? null;
  let signature: string;
  try {
    signature = await chain.broadcast(env, signedTransaction, storedLifetime);
  } catch (error) {
    if (depositSignatureIsDead(error, storedLifetime)) {
      await reopenSignedDeposit(db, rowId, depositUserId, storedSignature).catch((reopenError: unknown) => {
        console.error('could not reopen signed deposit', rowId, reopenError);
      });
    }
    throw error;
  }
  if (signature !== row.tx_signature) throw new ApiError('TX_MISMATCH', 'Deposit RPC returned a different signature', 503);
  const committedAt = new Date().toISOString();
  await db.prepare(`UPDATE deposits SET status = 'committed', committed_at = ?
    WHERE id = ? AND user_id = ? AND status = 'signed' AND tx_signature = ?`)
    .bind(committedAt, row.id, userId, signature).run();
  row = await db.prepare('SELECT * FROM deposits WHERE id = ? AND user_id = ?')
    .bind(row.id, userId).first<DepositRow>();
  if (!row || row.status !== 'committed') throw new ApiError('UNKNOWN', 'Could not record deposit receipt', 503);
  return committedResponse(row);
}
