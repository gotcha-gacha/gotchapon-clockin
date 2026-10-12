import { getAddMemoInstruction } from '@solana-program/memo';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  address,
  appendTransactionMessageInstructions,
  assertIsFullySignedTransaction,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
  type Base64EncodedWireTransaction,
} from '@solana/kit';
import { ApiError } from './http';
import type { Asset, Env } from './types';

type VerifyInput = { signature: string; memo: string; asset: Asset; amount: number };
export type VerifiedPayment = { signature: string; destination: string; slot: number };
export type ConfirmationStatus = 'processed' | 'confirmed' | 'finalized';

export function hasConfirmed(status: ConfirmationStatus | undefined): boolean {
  return status === 'confirmed' || status === 'finalized';
}

export function enabledAssets(env: Env): Asset[] {
  const configured = (env.ENABLED_ASSETS ?? 'USDC,USDT').split(',').map((value) => value.trim());
  return (['USDC', 'USDT'] as Asset[]).filter((asset) => configured.includes(asset));
}

function expected(env: Env, asset: Asset) {
  const config = asset === 'USDC'
    ? { destination: env.TREASURY_USDC_TOKEN_ACCOUNT, mint: env.USDC_MINT }
    : { destination: env.TREASURY_USDT_TOKEN_ACCOUNT, mint: env.USDT_MINT };
  if (!enabledAssets(env).includes(asset) || !config.destination || !config.mint) {
    throw new ApiError('UNKNOWN', `${asset} payments are not enabled`, 400);
  }
  return { destination: config.destination, mint: config.mint };
}

function feePayerBytes(secret: string | undefined): Uint8Array {
  if (!secret) throw new ApiError('UNKNOWN', 'Payment fee payer is not configured', 503);
  let parsed: unknown;
  try { parsed = JSON.parse(secret); }
  catch { throw new ApiError('UNKNOWN', 'Payment fee payer is invalid', 503); }
  if (!Array.isArray(parsed) || parsed.length !== 64
    || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new ApiError('UNKNOWN', 'Payment fee payer is invalid', 503);
  }
  return Uint8Array.from(parsed as number[]);
}

/** Build the exact paid-pull transfer without signing it. Privy signs the user's slot first;
 * the API adds its fee-payer signature only after validating that signed authorization at commit. */
export async function preparePaymentTransaction(
  env: Env,
  input: { wallet: string; memo: string; asset: Asset; amount: number },
): Promise<string> {
  return (await preparePaymentWithLifetime(env, input)).transactionBase64;
}

/** The payment and the last block height its blockhash is valid through, which the pull stores (#273): expiry is decided
 *  by comparing a confirmed block height with it, never by a node's opinion of the blockhash. */
export async function preparePaymentWithLifetime(
  env: Env,
  input: { wallet: string; memo: string; asset: Asset; amount: number },
): Promise<{ transactionBase64: string; lastValidBlockHeight: number }> {
  const wanted = expected(env, input.asset);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new ApiError('UNKNOWN', 'Payment amount is invalid', 503);
  }
  if (!env.FEE_PAYER_ADDRESS) throw new ApiError('UNKNOWN', 'Payment fee payer is not configured', 503);
  const owner = address(input.wallet);
  const mint = address(wanted.mint);
  const [source] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const latest = await rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
    env, 'getLatestBlockhash', [{ commitment: 'confirmed' }],
  );
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (current) => setTransactionMessageFeePayer(address(env.FEE_PAYER_ADDRESS!), current),
    (current) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash(latest.value.blockhash),
      lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
    }, current),
    (current) => appendTransactionMessageInstructions([getTransferCheckedInstruction({
      source,
      mint,
      destination: address(wanted.destination),
      authority: createNoopSigner(owner),
      amount: BigInt(input.amount),
      decimals: 6,
    }),
    getAddMemoInstruction({ memo: input.memo })], current),
  );
  const lastValidBlockHeight = Number(latest.value.lastValidBlockHeight);
  if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
    throw new ApiError('TX_NOT_FOUND', 'Payment RPC returned an invalid response', 503);
  }
  return { transactionBase64: getBase64EncodedWireTransaction(compileTransaction(message)), lastValidBlockHeight };
}

/** Build a deposit whose connected source wallet pays its own network fee. The API still owns
 * blockhash lookup, instruction construction and broadcast; the browser wallet only signs.
 * `lastValidBlockHeight` is that blockhash's own lifetime. The deposit stores it so a later broadcast
 * can prove the signature expired (#266) instead of asking the wallet to sign the same dead bytes. */
export async function buildDepositWithLifetime(
  env: Env,
  input: { sourceWallet: string; destinationWallet: string; memo: string; amount: number },
): Promise<{ transactionBase64: string; lastValidBlockHeight: number }> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new ApiError('UNKNOWN', 'Deposit amount is invalid');
  }
  const sourceOwner = address(input.sourceWallet);
  const destinationOwner = address(input.destinationWallet);
  const mint = address(env.USDC_MINT);
  const [source] = await findAssociatedTokenPda({ owner: sourceOwner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destination] = await findAssociatedTokenPda({ owner: destinationOwner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const sourceSigner = createNoopSigner(sourceOwner);
  const latest = await rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
    env, 'getLatestBlockhash', [{ commitment: 'confirmed' }],
  );
  const lastValidBlockHeight = Number(latest.value.lastValidBlockHeight);
  if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
    throw new ApiError('TX_NOT_FOUND', 'Payment RPC returned an invalid response', 503);
  }
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (current) => setTransactionMessageFeePayer(sourceOwner, current),
    (current) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash(latest.value.blockhash),
      lastValidBlockHeight: BigInt(lastValidBlockHeight),
    }, current),
    (current) => appendTransactionMessageInstructions([
      getCreateAssociatedTokenIdempotentInstruction({
        payer: sourceSigner,
        ata: destination,
        owner: destinationOwner,
        mint,
      }),
      getTransferCheckedInstruction({
        source,
        mint,
        destination,
        authority: sourceSigner,
        amount: BigInt(input.amount),
        decimals: 6,
      }),
      getAddMemoInstruction({ memo: input.memo }),
    ], current),
  );
  return { transactionBase64: getBase64EncodedWireTransaction(compileTransaction(message)), lastValidBlockHeight };
}

export async function buildDepositTransaction(
  env: Env,
  input: { sourceWallet: string; destinationWallet: string; memo: string; amount: number },
): Promise<string> {
  return (await buildDepositWithLifetime(env, input)).transactionBase64;
}

function decodedTransaction(transactionBase64: string) {
  if (!transactionBase64 || transactionBase64.length > 4_096) {
    throw new ApiError('TX_MISMATCH', 'The signed payment transaction is invalid');
  }
  try {
    const bytes = Uint8Array.from(atob(transactionBase64), (character) => character.charCodeAt(0));
    return getTransactionDecoder().decode(bytes);
  } catch {
    throw new ApiError('TX_MISMATCH', 'The signed payment transaction is invalid');
  }
}

function sameBytes(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

/** Require Privy to have signed the exact message produced by /prepare, then add the API
 * fee-payer signature. No fee-payer authorization leaves the API before this check succeeds. */
export async function sponsorPaymentTransaction(
  env: Env,
  preparedTransactionBase64: string,
  userSignedTransactionBase64: string,
  wallet: string,
): Promise<{ signature: string; transactionBase64: Base64EncodedWireTransaction }> {
  const prepared = decodedTransaction(preparedTransactionBase64);
  const submitted = decodedTransaction(userSignedTransactionBase64);
  if (!sameBytes(prepared.messageBytes, submitted.messageBytes)) {
    throw new ApiError('TX_MISMATCH', 'The signed payment differs from the prepared transaction');
  }
  const feePayer = await createKeyPairSignerFromBytes(feePayerBytes(env.FEE_PAYER_KEYPAIR));
  if (!env.FEE_PAYER_ADDRESS || feePayer.address !== address(env.FEE_PAYER_ADDRESS)) {
    throw new ApiError('UNKNOWN', 'Payment signer does not match the configured fee payer', 503);
  }
  const owner = address(wallet);
  const expectedSigners = Object.keys(prepared.signatures);
  if (expectedSigners.length !== 2 || !expectedSigners.includes(feePayer.address)
    || !expectedSigners.includes(owner) || Object.values(prepared.signatures).some(Boolean)
    || submitted.signatures[feePayer.address] !== null || !submitted.signatures[owner]) {
    throw new ApiError('TX_MISMATCH', 'The payment signatures do not match this pull');
  }
  const ownerSignature = submitted.signatures[owner]!;
  if (!(await verifySignature(await getPublicKeyFromAddress(owner), ownerSignature, submitted.messageBytes))) {
    throw new ApiError('TX_MISMATCH', 'The user payment signature is invalid');
  }
  const sponsored = await partiallySignTransaction([feePayer.keyPair], submitted);
  assertIsFullySignedTransaction(sponsored);
  return {
    signature: getSignatureFromTransaction(sponsored),
    transactionBase64: getBase64EncodedWireTransaction(sponsored),
  };
}

/** Accept only a valid signature over the exact deposit bytes issued by the API. Unlike a pull,
 * a deposit is not sponsored: its connected source wallet is the sole signer and fee payer. */
export async function acceptUserSignedTransaction(
  preparedTransactionBase64: string,
  userSignedTransactionBase64: string,
  wallet: string,
): Promise<{ signature: string; transactionBase64: Base64EncodedWireTransaction }> {
  const prepared = decodedTransaction(preparedTransactionBase64);
  const submitted = decodedTransaction(userSignedTransactionBase64);
  if (!sameBytes(prepared.messageBytes, submitted.messageBytes)) {
    throw new ApiError('TX_MISMATCH', 'The signed deposit differs from the prepared transaction');
  }
  const owner = address(wallet);
  const expectedSigners = Object.keys(prepared.signatures);
  if (expectedSigners.length !== 1 || expectedSigners[0] !== owner
    || prepared.signatures[owner] !== null || !submitted.signatures[owner]) {
    throw new ApiError('TX_MISMATCH', 'The deposit signatures do not match this request');
  }
  const ownerSignature = submitted.signatures[owner]!;
  if (!(await verifySignature(await getPublicKeyFromAddress(owner), ownerSignature, submitted.messageBytes))) {
    throw new ApiError('TX_MISMATCH', 'The deposit signature is invalid');
  }
  assertIsFullySignedTransaction(submitted);
  return {
    signature: getSignatureFromTransaction(submitted),
    transactionBase64: getBase64EncodedWireTransaction(submitted),
  };
}

function signedTransaction(transactionBase64: string) {
  try {
    const transaction = decodedTransaction(transactionBase64);
    assertIsFullySignedTransaction(transaction);
    return { signature: getSignatureFromTransaction(transaction), transactionBase64 };
  } catch {
    throw new ApiError('TX_MISMATCH', 'The signed payment transaction is invalid');
  }
}

/** A JSON-RPC error from the payment RPC, kept whole for the classification below and never shown to a user: its
 *  `message` is the node's own text (simulation logs included), so what reaches a response is the fixed message. */
export class PaymentRpcError extends ApiError {
  constructor(public rpcCode: number | undefined, public rpcData: unknown) {
    super('TX_NOT_FOUND', 'Payment RPC returned an error', 503);
  }
}

async function rpcCall<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  // Bounded, because the per-request sweep asks it on the user's request path (PR #298's review).
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => { throw new ApiError('TX_NOT_FOUND', 'Payment RPC is unavailable', 503); });
  if (!response.ok) throw new ApiError('TX_NOT_FOUND', 'Payment RPC is unavailable', 503);
  const payload = await response.json() as { result?: T; error?: { code?: number; message?: string; data?: unknown } };
  if (payload.error) throw new PaymentRpcError(payload.error.code, payload.error.data);
  if (payload.result === undefined) throw new ApiError('TX_NOT_FOUND', 'Payment RPC returned an invalid response', 503);
  return payload.result;
}

/**
 * A payment outcome the caller can act on (#273). `release` means the signed transaction can never move money: it landed and
 * failed on chain, or its blockhash has expired with no status for the signature. Only then may a pull hand back the free
 * pulls it reserved. Every other failure leaves the transaction able to land, so the pull stays pinned and retryable.
 */
export class PaymentOutcome extends ApiError {
  constructor(code: 'EXPIRED' | 'TX_MISMATCH' | 'INSUFFICIENT_FUNDS', message: string, public release: boolean, status = 409) {
    super(code, message, status);
  }
}

type SignatureStatus = { confirmationStatus?: ConfirmationStatus; err?: unknown } | null;

/** The SPL Token program's `InsufficientFunds` (custom error 1) at a preflight: what an RPC answers for a transfer larger than
 *  the source holds. Observed on Surfpool 1.5.0 (26 Sept): code -32002, `data.err = {"InstructionError":[0,{"Custom":1}]}`.
 *  Any instruction index: the transfer is instruction 0 in a pull and 1 in a deposit (after its create-idempotent), and
 *  nothing else in either can fail with Custom 1 (the Associated Token program's errors start at 0 = InvalidOwner). */
function isInsufficientFunds(error: unknown): boolean {
  if (!(error instanceof PaymentRpcError) || error.rpcCode !== -32002) return false;
  const err = (error.rpcData as { err?: unknown } | undefined)?.err as { InstructionError?: [number, { Custom?: number }] } | undefined;
  return err?.InstructionError?.[1]?.Custom === 1;
}

const invalidRpc = () => new ApiError('TX_NOT_FOUND', 'Payment RPC returned an invalid response', 503);

/** One signature's status, with the slot the answering node had reached. Anything off-shape throws: an answer that cannot be
 *  read must never read as "no status" (PR #298's review: `{value:null}` released a pinned pull). */
async function signatureStatus(env: Env, signature: string): Promise<{ slot: number; status: SignatureStatus }> {
  const answer = await rpcCall<{ context?: { slot?: unknown }; value?: unknown }>(
    env, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  const slot = answer?.context?.slot;
  const value = answer?.value;
  if (typeof slot !== 'number' || !Array.isArray(value) || value.length !== 1) throw invalidRpc();
  const status = value[0];
  if (status !== null && (typeof status !== 'object' || Array.isArray(status))) throw invalidRpc();
  return { slot, status: status as SignatureStatus };
}

/** The confirmed chain's block height, with the slot it was read at. */
async function confirmedHeight(env: Env): Promise<{ slot: number; blockHeight: number }> {
  const info = await rpcCall<{ absoluteSlot?: unknown; blockHeight?: unknown }>(env, 'getEpochInfo', [{ commitment: 'confirmed' }]);
  if (typeof info?.absoluteSlot !== 'number' || typeof info?.blockHeight !== 'number') throw invalidRpc();
  return { slot: info.absoluteSlot, blockHeight: info.blockHeight };
}

/** Whether the transaction's blockhash is one this node still accepts. Only for a deposit, which releases nothing and so may
 *  ask a node that could be behind; a pull's expiry is `paymentState`'s block-height proof. */
export async function blockhashStillValid(env: Env, transactionBase64: string): Promise<boolean> {
  const decoded = decodedTransaction(transactionBase64);
  const { lifetimeToken } = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const answer = await rpcCall<{ value?: unknown }>(env, 'isBlockhashValid', [lifetimeToken, { commitment: 'confirmed' }]);
  if (typeof answer?.value !== 'boolean') throw invalidRpc();
  return answer.value;
}

const landed = (status: NonNullable<SignatureStatus>): 'confirmed' | 'pending' | 'failed' =>
  // An error only ends a payment once it is on the confirmed chain: a `processed` failure could be on a fork that is dropped.
  !hasConfirmed(status.confirmationStatus) ? 'pending' : status.err ? 'failed' : 'confirmed';

/**
 * Where a signed payment stands, decided from state that fails safe on a node that is behind (#273, PR #298's review):
 *   - its status, when there is one: confirmed, failed (an error on the confirmed chain), or pending;
 *   - with no status: `expired` only if a confirmed block height is PAST the blockhash's last valid height — a node that is
 *     behind reports a lower height, which answers "not yet" — and a status read afterwards, from a node at least as far along
 *     as that height reading, still has nothing. A later status read from a node that is behind counts as unknown, not as
 *     "no status". `lastValidBlockHeight` null (a row from before the column) is never expired on chain evidence.
 *   **The re-read is load-bearing; never simplify it away.** The transaction can still land in the block at lastValid + 1
 *   (agave's replay age check counts from the parent's hash, PR #298's second review): a height past lastValid proves no
 *   later block can hold it, and only the slot-checked re-read covers the block that just could.
 * What the release still rests on, each unobserved or observed once, and each failing in the UNSAFE direction (a release, and
 * a payment that lands with no pull): the RPC's history lookup reaching a pull of any age (`searchTransactionHistory`;
 * observed once on api.mainnet-beta.solana.com, 26 Sept — re-observe on any provider change); no load-balanced node on a
 * minority fork answering the status read; agave 4.x's blockhash age matching 3.0.13's.
 * `isBlockhashValid` is not used here: false only means "this node does not know the hash", which a lagging node says about
 * a fresh one (observed on Surfpool for an unseen hash), and it would release a payment that then lands.
 */
export async function paymentState(env: Env, signature: string, lastValidBlockHeight: number | null):
  Promise<'confirmed' | 'pending' | 'failed' | 'expired' | 'unknown'> {
  const first = await signatureStatus(env, signature);
  if (first.status) return landed(first.status);
  if (lastValidBlockHeight === null) return 'unknown';
  const height = await confirmedHeight(env);
  if (height.blockHeight <= lastValidBlockHeight) return 'unknown';
  const last = await signatureStatus(env, signature);
  if (last.slot < height.slot) return 'unknown';
  if (last.status) return landed(last.status);
  return 'expired';
}

const failedOnChain = () => new PaymentOutcome('TX_MISMATCH', 'The payment did not go through. Nothing was charged.', true);
const expiredAuthorization = () => new PaymentOutcome('EXPIRED', 'The signed payment authorization expired', true);

/** Broadcast only a fully signed transaction. Pulls carry API + user signatures; deposits carry the connected
 * wallet's signature alone. Retries are idempotent because the wire transaction has one deterministic primary
 * signature; an already-landed transaction is not resent. `lastValidBlockHeight` is the stored lifetime (a pull's
 * column, or a deposit's). Null — a row from before that column — is never expired on block-height proof; a deposit
 * then reports an expired blockhash as EXPIRED with nothing to release. */
export async function broadcastPaymentTransaction(
  env: Env,
  transactionBase64: string,
  lastValidBlockHeight: number | null = null,
): Promise<string> {
  const signed = signedTransaction(transactionBase64);
  let current = (await signatureStatus(env, signed.signature)).status;
  if (!current) {
    try {
      const sent = await rpcCall<string>(env, 'sendTransaction', [signed.transactionBase64, {
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 5,
      }]);
      if (sent !== signed.signature) throw new ApiError('TX_MISMATCH', 'Payment RPC returned a different signature', 503);
    } catch (error) {
      // A retry can race the first broadcast: if the signature is now visible, confirmation below is the source of truth.
      // Otherwise the chain decides, not the error's text.
      const state = await paymentState(env, signed.signature, lastValidBlockHeight);
      if (state === 'failed') throw failedOnChain();
      if (state === 'expired') throw expiredAuthorization();
      if (state === 'unknown') {
        if (isInsufficientFunds(error)) {
          throw new PaymentOutcome('INSUFFICIENT_FUNDS', 'Not enough USDC in the wallet for this payment', false);
        }
        if (lastValidBlockHeight === null && !(await blockhashStillValid(env, signed.transactionBase64))) {
          throw new PaymentOutcome('EXPIRED', 'The signed payment authorization expired', false);
        }
        if (error instanceof PaymentRpcError) throw new ApiError('TX_NOT_FOUND', 'The payment could not be sent yet; retry safely', 503);
        throw error;
      }
    }
  }

  const deadline = Date.now() + 24_000;
  while (Date.now() < deadline) {
    current = (await signatureStatus(env, signed.signature)).status;
    if (current && landed(current) === 'failed') throw failedOnChain();
    if (current && landed(current) === 'confirmed') return signed.signature;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new ApiError('TX_NOT_FOUND', 'The payment is still confirming; retry safely', 503);
}

async function tokenBalance(env: Env, wallet: string, mint: string): Promise<number> {
  const [tokenAccount] = await findAssociatedTokenPda({
    owner: address(wallet),
    mint: address(mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: tokenAccount, method: 'getTokenAccountBalance',
      params: [tokenAccount, { commitment: 'confirmed' }] }),
  });
  if (!response.ok) throw new ApiError('UNKNOWN', 'Balance RPC is unavailable', 503);
  const rpc = await response.json() as {
    result?: { value?: { amount?: string } };
    error?: { code?: number; message?: string };
  };
  // A wallet that has never received this mint has no ATA and therefore a zero balance.
  if (rpc.error?.code === -32602 && /could not find account/i.test(rpc.error.message ?? '')) return 0;
  if (rpc.error) throw new ApiError('UNKNOWN', 'Balance RPC returned an error', 503);
  const raw = rpc.result?.value?.amount;
  if (!raw || !/^\d+$/.test(raw)) throw new ApiError('UNKNOWN', 'Balance RPC returned an invalid response', 503);
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount)) {
    throw new ApiError('UNKNOWN', 'Wallet balance exceeds supported precision', 503);
  }
  return amount;
}

export async function walletBalance(env: Env, wallet: string) {
  const enabled = enabledAssets(env);
  const [usdc, usdt] = await Promise.all([
    enabled.includes('USDC') ? tokenBalance(env, wallet, env.USDC_MINT) : 0,
    enabled.includes('USDT') && env.USDT_MINT ? tokenBalance(env, wallet, env.USDT_MINT) : 0,
  ]);
  return { usdc, usdt, pulls: Math.floor((usdc + usdt) / 1_000_000) };
}

export async function verifyPayment(env: Env, input: VerifyInput): Promise<VerifiedPayment> {
  const wanted = expected(env, input.asset);
  if (env.PAYMENTS_MODE === 'mock') {
    if (env.ENVIRONMENT !== 'local') throw new ApiError('TX_NOT_FOUND', 'Mock payments are disabled outside local development', 503);
    if (input.signature !== `mock:${input.memo}`) throw new ApiError('TX_MISMATCH', `Local signatures must be mock:${input.memo}`);
    return { signature: input.signature, destination: wanted.destination, slot: 0 };
  }
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: input.signature, method: 'getTransaction', params: [input.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
  });
  if (!response.ok) throw new ApiError('TX_NOT_FOUND', 'Payment RPC is unavailable', 503);
  const rpc = await response.json() as { result?: { slot?: number; meta?: { err?: unknown }; transaction?: { message?: { instructions?: unknown[] } } }; error?: unknown };
  if (!rpc.result) throw new ApiError('TX_NOT_FOUND', 'We could not see your payment yet');
  if (!Number.isSafeInteger(rpc.result.slot) || (rpc.result.slot ?? -1) < 0) throw new ApiError('TX_NOT_FOUND', 'Payment RPC returned an invalid slot', 503);
  if (rpc.result.meta?.err) throw new ApiError('TX_MISMATCH', 'The payment transaction failed');
  const instructions = rpc.result.transaction?.message?.instructions ?? [];
  let memoMatches = false;
  let transferMatches = false;
  for (const raw of instructions) {
    if (!raw || typeof raw !== 'object') continue;
    const instruction = raw as { program?: string; parsed?: unknown };
    if (instruction.program === 'spl-memo' && instruction.parsed === input.memo) memoMatches = true;
    if ((instruction.program === 'spl-token' || instruction.program === 'spl-token-2022') && instruction.parsed && typeof instruction.parsed === 'object') {
      const parsed = instruction.parsed as { type?: string; info?: Record<string, unknown> };
      const info = parsed.info ?? {};
      const amount = typeof info.amount === 'string'
        ? info.amount
        : typeof info.tokenAmount === 'object' && info.tokenAmount !== null
          ? String((info.tokenAmount as Record<string, unknown>).amount)
          : undefined;
      const mintMatches = parsed.type === 'transfer' || info.mint === wanted.mint;
      if (info.destination === wanted.destination && amount === String(input.amount) && mintMatches) transferMatches = true;
    }
  }
  if (!memoMatches || !transferMatches) throw new ApiError('TX_MISMATCH', 'That payment did not match this request');
  return { signature: input.signature, destination: wanted.destination, slot: rpc.result.slot! };
}
