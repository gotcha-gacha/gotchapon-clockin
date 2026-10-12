// The draw program on chain (#406): open a used page when needed, send one `request_draw` per pull sequence, and read the
// per-pull draw account. `fake` stands in for the chain locally and in tests; it is refused anywhere else.
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
} from '@solana/kit';
import { bytesToHex, framed, sha256 } from './drawDerive';
import { isFulfilment, type FulfilTx } from './drawFulfil';
import { ApiError } from './http';
import type { Env } from './types';

/** Must match the program: 10,224 bytes of bits a page. */
export const PAGE_BITS = 10_224 * 8;
const DEFAULT_QUEUE = 'Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh';
const VRF_PROGRAM = 'Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz';
const SLOT_HASHES = 'SysvarS1otHashes111111111111111111111111111';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const DISC = {
  initPage: [153, 126, 170, 81, 47, 213, 67, 13],
  requestDraw: [22, 180, 8, 81, 47, 21, 86, 159],
  drawAccount: [225, 131, 41, 222, 122, 20, 146, 202],
};
/** Anchor error 6001, `AlreadyRequested`: this sequence's used bit is set. */
const ALREADY_REQUESTED = 6001;

export type DrawRequest = { sequence: number; pullIdHash: Uint8Array; count: number; poolHash: Uint8Array };
export type DrawState = {
  exists: boolean; randomness: Uint8Array | null; requestSlot: number; fulfilledSlot: number;
  /** What the account was requested for: a pull reads only a draw whose pull id and pool hash are its own. */
  pullIdHash: Uint8Array | null; poolHash: Uint8Array | null;
};
const NO_DRAW: DrawState = { exists: false, randomness: null, requestSlot: 0, fulfilledSlot: 0, pullIdHash: null, poolHash: null };
export interface DrawChain {
  /** The draw account for this sequence (deterministic; it may not exist yet). */
  account(sequence: number): Promise<string>;
  /** Sends the request and waits for it to confirm. `signature` is null when the chain says this sequence was already
   *  requested (by an earlier send whose answer was lost): the draw account is then the source of truth. */
  request(input: DrawRequest): Promise<{ signature: string | null; account: string }>;
  read(sequence: number): Promise<DrawState>;
  /** The newest transaction on the draw account other than its request: the oracle's fulfilment, once fulfilled. */
  fulfilment(sequence: number): Promise<string | null>;
}

export type DrawConfig = { chain: 'solana' | 'fake'; waitMs: number; timeoutMs: number };

function milliseconds(value: string | undefined, fallback: number, name: string, min: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new ApiError('UNKNOWN', `${name} is invalid`, 503);
  return parsed;
}

/** The draw settings, or a 503: checked at prepare as well as commit, so a pull that could never be drawn is refused before
 *  anyone is asked to pay (the way `provingKey` is, #274). */
export function drawConfig(env: Env): DrawConfig {
  const chain = env.DRAW_CHAIN ?? 'solana';
  if (chain !== 'solana' && chain !== 'fake') throw new ApiError('UNKNOWN', 'DRAW_CHAIN is invalid', 503);
  if (chain === 'fake' && env.ENVIRONMENT !== 'local') throw new ApiError('UNKNOWN', 'The fake draw chain is local only', 503);
  if (chain === 'solana') {
    if (!env.DRAW_PROGRAM_ID) throw new ApiError('UNKNOWN', 'The draw program is not configured', 503);
    authorityBytes(env.DRAW_AUTHORITY_KEYPAIR);
  }
  return {
    chain,
    // 0 reads the draw once and answers; the timeout must leave the draw some time.
    waitMs: milliseconds(env.DRAW_WAIT_MS, 10_000, 'DRAW_WAIT_MS', 0),
    timeoutMs: milliseconds(env.DRAW_TIMEOUT_MS, 60_000, 'DRAW_TIMEOUT_MS', 1),
  };
}

function authorityBytes(secret: string | undefined): Uint8Array {
  if (!secret) throw new ApiError('UNKNOWN', 'The draw authority is not configured', 503);
  let parsed: unknown;
  try { parsed = JSON.parse(secret); } catch { throw new ApiError('UNKNOWN', 'The draw authority is invalid', 503); }
  if (!Array.isArray(parsed) || parsed.length !== 64
    || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new ApiError('UNKNOWN', 'The draw authority is invalid', 503);
  }
  return Uint8Array.from(parsed as number[]);
}

export function drawChain(env: Env): DrawChain {
  return drawConfig(env).chain === 'fake' ? fakeChain(env) : solanaChain(env);
}

const u32le = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64le = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const text = (s: string) => new TextEncoder().encode(s);

/** The draw account layout after the discriminator: sequence @8, pull_id @16, pool_hash @48, randomness @80,
 *  request_slot @112, fulfilled_slot @120 (see the program's `Draw`). */
export function decodeDrawAccount(data: Uint8Array): Omit<DrawState, 'exists'> {
  if (data.length < 130 || DISC.drawAccount.some((byte, i) => data[i] !== byte)) throw new Error('not a draw account');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fulfilledSlot = Number(view.getBigUint64(120, true));
  return {
    randomness: fulfilledSlot ? data.slice(80, 112) : null,
    requestSlot: Number(view.getBigUint64(112, true)),
    fulfilledSlot,
    pullIdHash: data.slice(16, 48),
    poolHash: data.slice(48, 80),
  };
}

function solanaChain(env: Env): DrawChain {
  const programAddress = address(env.DRAW_PROGRAM_ID!);
  const rpcUrl = env.DRAW_RPC_URL || env.SOLANA_RPC_URL;
  const pda = async (...seeds: Uint8Array[]) => (await getProgramDerivedAddress({ programAddress, seeds }))[0];
  // One signer instance for the authority: kit refuses two distinct signers for one address in a transaction (the fee payer
  // and the instruction's authority are the same key).
  let authority: ReturnType<typeof createKeyPairSignerFromBytes> | undefined;
  const authoritySigner = () => (authority ??= createKeyPairSignerFromBytes(authorityBytes(env.DRAW_AUTHORITY_KEYPAIR)));

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      signal: AbortSignal.timeout(8_000),
    }).catch((error) => {
      console.error('draw rpc unreachable', method, String(error));
      throw new ApiError('TX_NOT_FOUND', 'The draw RPC is unavailable; retry safely', 503);
    });
    if (!response.ok) {
      console.error('draw rpc answered', method, response.status);
      throw new ApiError('TX_NOT_FOUND', 'The draw RPC is unavailable; retry safely', 503);
    }
    const payload = await response.json() as { result?: T; error?: { code?: number; data?: { err?: unknown } } };
    if (payload.error) throw new DrawRpcError(payload.error.data?.err);
    return payload.result as T;
  }

  async function accountData(target: Address): Promise<Uint8Array | null> {
    const result = await rpc<{ value: { data: [string, string] } | null }>('getAccountInfo',
      [target, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!result?.value) return null;
    return Uint8Array.from(atob(result.value.data[0]), (c) => c.charCodeAt(0));
  }

  async function send(instruction: Instruction): Promise<string> {
    const signer = await authoritySigner();
    const latest = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash',
      [{ commitment: 'confirmed' }]);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({
        blockhash: blockhash(latest.value.blockhash), lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
      }, m),
      (m) => appendTransactionMessageInstruction(instruction, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signed);
    await rpc<string>('sendTransaction', [getBase64EncodedWireTransaction(signed),
      { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 }]);
    // Kept short so that, on a healthy RPC, a commit (this, then up to DRAW_WAIT_MS) answers inside the app's 30 s request
    // timeout. Each RPC call has its own 8 s cap, so a slow RPC can still push a commit past it; the app then retries, and a
    // request still confirming answers retry-safely and the next commit finds its draw account.
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const status = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(
        'getSignatureStatuses', [[signature]]);
      const current = status.value[0];
      if (current?.err) throw new DrawRpcError(current.err);
      if (current?.confirmationStatus === 'confirmed' || current?.confirmationStatus === 'finalized') return signature;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new ApiError('TX_NOT_FOUND', 'The draw request is still confirming; retry safely', 503);
  }

  const chain: DrawChain = {
    account: async (sequence) => pda(text('draw'), u64le(sequence)),
    async request({ sequence, pullIdHash, count, poolHash }) {
      const signer = await authoritySigner();
      const config = await pda(text('config'));
      const page = Math.floor(sequence / PAGE_BITS);
      const used = await pda(text('used'), u32le(page));
      const draw = await pda(text('draw'), u64le(sequence));
      if (!(await accountData(used))) {
        try {
          await send({
            programAddress,
            accounts: [
              { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
              { address: config, role: AccountRole.READONLY },
              { address: used, role: AccountRole.WRITABLE },
              { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
            ],
            data: Uint8Array.from([...DISC.initPage, ...u32le(page)]),
          } as Instruction);
        } catch (error) {
          // Another commit opened it first.
          if (!(await accountData(used))) throw error;
        }
      }
      const data = Uint8Array.from([...DISC.requestDraw, ...u64le(sequence), ...pullIdHash, count, ...poolHash]);
      try {
        const signature = await send({
          programAddress,
          accounts: [
            { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
            { address: config, role: AccountRole.READONLY },
            { address: used, role: AccountRole.WRITABLE },
            { address: draw, role: AccountRole.WRITABLE },
            { address: address(DEFAULT_QUEUE), role: AccountRole.WRITABLE },
            { address: await pda(text('identity')), role: AccountRole.READONLY },
            { address: address(VRF_PROGRAM), role: AccountRole.READONLY },
            { address: address(SLOT_HASHES), role: AccountRole.READONLY },
            { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
          ],
          data,
        } as Instruction);
        return { signature, account: draw };
      } catch (error) {
        if (error instanceof DrawRpcError && error.customCode() === ALREADY_REQUESTED) return { signature: null, account: draw };
        if (error instanceof ApiError) throw error;
        throw new ApiError('TX_NOT_FOUND', 'The draw request could not be sent yet; retry safely', 503);
      }
    },
    async read(sequence) {
      const data = await accountData(await pda(text('draw'), u64le(sequence)));
      if (!data) return NO_DRAW;
      return { exists: true, ...decodeDrawAccount(data) };
    },
    async fulfilment(sequence) {
      // The oracle's ProvideRandomness transaction: a successful one whose VRF top-level instruction makes the inner
      // fulfill_draw call on this draw account. Others can touch the account (anyone can list it in a transaction, the oracle's
      // resends fail, a later close_draw), so a count of successes is not enough: each candidate is read and checked.
      const draw = await pda(text('draw'), u64le(sequence));
      const history = await rpc<{ signature: string; err: unknown }[]>('getSignaturesForAddress',
        [draw, { limit: 50, commitment: 'confirmed' }]);
      // At most ten reads per call: both callers are best effort, and anyone can pad the account's history.
      for (const { signature } of history.filter((entry) => !entry.err).slice(0, 10)) {
        const tx = await rpc<FulfilTx | null>('getTransaction',
          [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
        if (tx && isFulfilment(tx, programAddress, draw)) return signature;
      }
      return null;
    },
  };
  return chain;
}

/** An RPC refusal: a failed preflight or a transaction that failed on chain. `customCode` reads an Anchor error number. */
export class DrawRpcError extends ApiError {
  constructor(public err: unknown) { super('TX_NOT_FOUND', 'The draw request was refused; retry safely', 503); }
  customCode(): number | null {
    const instructionError = (this.err as { InstructionError?: [number, { Custom?: number }] } | undefined)?.InstructionError;
    return typeof instructionError?.[1]?.Custom === 'number' ? instructionError[1].Custom : null;
  }
}

// The fake chain: one isolate's memory. Randomness is a hash of the sequence and the pool, so a test can recompute it.
type FakeDraw = { reads: number; poolHash: Uint8Array; pullIdHash: Uint8Array; requests: number };
const fakeDraws = new Map<number, FakeDraw>();
/** Requests sent to the fake chain per sequence (a repeat is refused, as the used bit refuses it): one per pull. */
export function fakeDrawRequests(sequence: number): number { return fakeDraws.get(sequence)?.requests ?? 0; }
export function resetFakeDrawChain(): void { fakeDraws.clear(); }
export async function fakeRandomness(sequence: number, poolHash: Uint8Array): Promise<Uint8Array> {
  return sha256(framed(['gachapon:fake-draw:v1', String(sequence), bytesToHex(poolHash)]));
}

function fakeChain(env: Env): DrawChain {
  // `instant` | `never` | `after:N` (fulfilled on read N), optionally `;fail:K` (read K answers a retryable RPC error).
  const [behaviour, failSpec] = (env.DRAW_FAKE ?? 'instant').split(';');
  const fulfilledOnRead = behaviour === 'instant' ? 1 : behaviour === 'never' ? Infinity
    : Number(behaviour.match(/^after:(\d+)$/)?.[1] ?? NaN);
  const failOnRead = failSpec ? Number(failSpec.match(/^fail:(\d+)$/)?.[1] ?? NaN) : 0;
  if ((!Number.isFinite(fulfilledOnRead) && behaviour !== 'never') || Number.isNaN(failOnRead)) {
    throw new ApiError('UNKNOWN', 'DRAW_FAKE is invalid', 503);
  }
  return {
    account: async (sequence) => `fake-draw-${sequence}`,
    fulfilment: async (sequence) => (fakeDraws.has(sequence) ? `fake-fulfil-${sequence}` : null),
    async request({ sequence, poolHash, pullIdHash }) {
      const existing = fakeDraws.get(sequence);
      if (existing) { existing.requests++; return { signature: null, account: `fake-draw-${sequence}` }; }
      fakeDraws.set(sequence, { reads: 0, poolHash, pullIdHash, requests: 1 });
      return { signature: `fake-request-${sequence}`, account: `fake-draw-${sequence}` };
    },
    async read(sequence) {
      const draw = fakeDraws.get(sequence);
      if (!draw) return NO_DRAW;
      draw.reads++;
      if (draw.reads === failOnRead) throw new ApiError('TX_NOT_FOUND', 'The draw RPC is unavailable; retry safely', 503);
      const requested = { exists: true, requestSlot: 1, pullIdHash: draw.pullIdHash, poolHash: draw.poolHash };
      if (draw.reads < fulfilledOnRead) return { ...requested, randomness: null, fulfilledSlot: 0 };
      return { ...requested, randomness: await fakeRandomness(sequence, draw.poolHash), fulfilledSlot: 4 };
    },
  };
}
