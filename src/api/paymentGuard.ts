// Where a paid pull's money goes (#186, audit item 1). The server builds the payment transaction (`transfer.transactionBase64`,
// server/src/payments.ts `preparePaymentTransaction`) and the wallet signs those bytes as they are, so the JSON fields beside
// them (`to`, `mint`, `amount`, `memo`) describe the payment without being it. This reads the bytes the wallet would sign and
// holds them to the one shape the server builds, against a treasury and a mint the build pinned out of band (#101: a server
// that can move the destination can move the expected value beside it, so neither comes from an API response).
//
// The shape, as built on 24 Sept (#206): a v0 message, no address lookup tables, exactly two instructions —
//   1. SPL Token `TransferChecked` (discriminator 12): accounts [source, mint, destination, authority], amount u64 LE,
//      decimals u8 = 6;
//   2. Memo: the bare `pullId`, UTF-8.
// Anything else refuses. That includes a compute-budget instruction the server does not add today: if one is ever added,
// every paid pull refuses (loudly, as PREPARE_FAILED) until this is widened on purpose, which is the right way round for the
// one check that stands between a quote and a signature.
//
// Only what decides where money goes, and who pays for it, is checked. A transaction whose authority is not among its signers, or whose memo also
// names signers, fails or does nothing on chain; the server's own check at commit (`sponsorPaymentTransaction`) covers those.
//
// `source` is not pinned. The token program only moves funds out of an account `authority` owns (or is a delegate on), and
// `authority` is pinned to the signing wallet, so a different source still spends only the signer's own USDC, to the pinned
// treasury, for the pinned amount.
//
// A connected-wallet deposit (#278, `depositAsExpected` below) is the same problem the other way round: the server builds a
// transfer FROM the wallet the user signed in with (Phantom, Backpack, …) TO their embedded wallet, and that wallet signs it
// as the only signer and fee payer. Checking only the JSON beside the bytes left any instruction a buggy or compromised API
// cared to add (an Approve, a SetAuthority, another mint) one Phantom confirmation away.

import type { Transfer } from './contract';
import { base58Decode } from './solanaAddress';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TRANSFER_CHECKED = 12;
const CREATE_IDEMPOTENT = 1;
const USDC_DECIMALS = 6;

/** The destination and mint a build expects a paid pull to pay, pinned per environment. */
export type ExpectedPayment = { to: string; mint: string };

type Instruction = { program: number; accounts: number[]; data: Uint8Array };
type Message = { signatures: number; requiredSignatures: number; readonlySigners: number; keys: Uint8Array[]; instructions: Instruction[] };

/** Reads a compact-u16 at `at`; returns [value, next offset]. Throws past the end, and on any encoding but the shortest one.
 *  A non-canonical length (a count of 2 written as `0x82 0x00`) decoded to the same value here, and the wallet's own decoder
 *  then re-serialised it canonically, so the bytes it signed were not the bytes this checked (PR #186 audit: 294 against 295
 *  bytes). The server's message comparison refused it, but that is a second line, not this one. */
function shortVec(b: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const byte = b[at + i];
    if (byte === undefined) throw new Error('truncated');
    // A continuation that adds nothing (a trailing 0x00 group), or a third byte past u16, is not the shortest encoding.
    if (i > 0 && byte === 0) throw new Error('non-canonical compact-u16');
    if (i === 2 && byte > 0x03) throw new Error('compact-u16 past u16');
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return [value, at + i + 1];
  }
  throw new Error('bad compact-u16');
}

function take(b: Uint8Array, at: number, n: number): Uint8Array {
  if (at + n > b.length) throw new Error('truncated');
  return b.subarray(at, at + n);
}

/** Decodes a wire transaction (signatures, then a v0 message). Throws on anything else, legacy messages included. */
function decode(transactionBase64: string): Message {
  const bin = atob(transactionBase64);
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const [sigCount, start] = shortVec(b, 0);
  let at = start + 64 * sigCount;
  const prefix = take(b, at, 1)[0];
  if (prefix !== 0x80) throw new Error('not a v0 message');
  // Header: how many keys must sign, then the read-only counts. A pull does not read it (the server co-signs as fee payer);
  // a deposit does, because there the wallet is meant to be the only signer.
  const [requiredSignatures, readonlySigners] = take(b, at + 1, 3);
  at += 4;
  let n: number;
  [n, at] = shortVec(b, at);
  const keys: Uint8Array[] = [];
  for (let i = 0; i < n; i++, at += 32) keys.push(take(b, at, 32));
  at += 32; // recent blockhash
  [n, at] = shortVec(b, at);
  const instructions: Instruction[] = [];
  for (let i = 0; i < n; i++) {
    const program = take(b, at, 1)[0];
    let count: number;
    [count, at] = shortVec(b, at + 1);
    const accounts = Array.from(take(b, at, count));
    at += count;
    [count, at] = shortVec(b, at);
    const data = take(b, at, count);
    at += count;
    instructions.push({ program, accounts, data });
  }
  // What follows is the address-lookup-table section. The server uses none, so its count has to be the last byte: a table
  // leaves bytes after it and is refused here, which also refuses anything else appended.
  [n, at] = shortVec(b, at);
  if (n !== 0 || at !== b.length) throw new Error('lookup tables or trailing bytes');
  return { signatures: sigCount, requiredSignatures, readonlySigners, keys, instructions };
}

const same = (a: Uint8Array, b: Uint8Array | null): boolean =>
  b !== null && a.length === b.length && a.every((x, i) => x === b[i]);

const u64 = (d: Uint8Array, at: number): bigint => {
  let v = BigInt(0);
  for (let i = 7; i >= 0; i--) v = v * BigInt(256) + BigInt(d[at + i]);
  return v;
};

/**
 * Whether a paid quote's transaction pays exactly what the build expects: `transfer.amount` of the pinned mint, to the pinned
 * treasury, from `authority`'s funds, with the quote's own `pullId` as its memo, and nothing else. Also holds the JSON fields
 * to the same values, so the description cannot disagree with the payment. `false` on anything unreadable, never a throw.
 * `expected` null (a build with nothing pinned) refuses every paid pull.
 */
export function paysAsExpected(
  pullId: string,
  transfer: Transfer,
  expected: ExpectedPayment | null,
  authority: string | null | undefined,
): boolean {
  // A value that is not an address decodes to no key it could equal, so the byte comparisons below refuse it by themselves.
  if (!expected || !authority) return false;
  if (transfer.to !== expected.to || transfer.mint !== expected.mint || transfer.memo !== pullId) return false;
  const amount = transfer.amount;
  // Before `BigInt(amount)` below, which throws on a fraction or NaN and converts a string of digits as if it were the number.
  if (!Number.isSafeInteger(amount)) return false;
  const tx = transfer.transactionBase64;
  if (typeof tx !== 'string' || tx.length === 0) return false;
  let m: Message;
  try {
    m = decode(tx);
  } catch {
    return false;
  }
  const key = (i: number): Uint8Array | null => m.keys[i] ?? null;
  const is = (i: number, address: string) => {
    const k = key(i);
    return k !== null && same(k, base58Decode(address));
  };
  // The fee payer is the message's first key. The server sponsors every pull; a quote that makes the wallet pay its own fees
  // is not the payment the server builds.
  if (is(0, authority)) return false;
  if (m.instructions.length !== 2) return false;
  const [pay, memo] = m.instructions;

  if (!is(pay.program, TOKEN_PROGRAM) || pay.accounts.length !== 4) return false;
  const [, mint, destination, owner] = pay.accounts;
  if (!is(mint, expected.mint) || !is(destination, expected.to) || !is(owner, authority)) return false;
  const d = pay.data;
  if (d.length !== 10 || d[0] !== TRANSFER_CHECKED || d[9] !== USDC_DECIMALS || u64(d, 1) !== BigInt(amount)) return false;

  if (!is(memo.program, MEMO_PROGRAM)) return false;
  // Compared as bytes: TextEncoder is polyfilled on the phone (src/polyfills.ts), TextDecoder is not.
  return same(memo.data, new TextEncoder().encode(pullId));
}

/** What a connected-wallet deposit must be, every value from the build or from the signed-in session, never from the API:
 *  `source` the wallet the user signed in with, `owner` their embedded (deposit) wallet, `mint` the build's pinned USDC mint. */
export type ExpectedDeposit = { source: string; owner: string; mint: string };

/**
 * Whether a deposit's transaction is exactly the transfer the user asked for (#278), as the server builds it
 * (server/src/payments.ts `buildDepositTransaction`, 25 Sept): a v0 message paid for and signed by `source` alone, no lookup
 * tables, and three instructions —
 *   1. Associated Token `CreateIdempotent` (data [1]): accounts [payer = source, account, owner, mint, System, Token];
 *   2. SPL Token `TransferChecked` of exactly `amount` of `mint`, decimals 6, INTO that same account, authority `source`;
 *   3. Memo `deposit:<depositId>`.
 * The source token account is not pinned, as for a pull: the authority is the connected wallet, so the transfer can only
 * spend from an account that wallet owns or is a delegate on, into the embedded wallet's account, of the pinned mint.
 * The account the money lands in is not derived here: the Associated Token program fails the whole transaction unless it is
 * `owner`'s account for `mint`, and the transfer must credit that very account (the same key index), so it can only be the
 * embedded wallet's. `false` on anything unreadable, never a throw. `expected` null (no pinned mint) refuses every deposit.
 */
export function depositAsExpected(
  deposit: { depositId: string; amount: number; transactionBase64: string },
  expected: ExpectedDeposit | null,
): boolean {
  // An empty expected value needs no check of its own: it decodes to no 32-byte key, so every comparison below refuses it.
  if (!expected) return false;
  if (expected.source === expected.owner) return false;
  const { amount, depositId, transactionBase64: tx } = deposit;
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  if (typeof depositId !== 'string' || depositId.length === 0) return false;
  if (typeof tx !== 'string' || tx.length === 0) return false;
  let m: Message;
  try {
    m = decode(tx);
  } catch {
    return false;
  }
  const is = (i: number, address: string) => {
    const k = m.keys[i];
    return k !== undefined && same(k, base58Decode(address));
  };
  // The connected wallet pays its own fee and is the only key asked to sign: nothing else can be authorised in its name.
  // With one signer, the fee payer, the create's payer and the transfer's authority below are each implied by the others (a
  // second one would be a second signer); they are checked anyway, so no single check carries the rule alone.
  if (m.signatures !== 1 || m.requiredSignatures !== 1 || !is(0, expected.source)) return false;
  // And its account is writable (a read-only fee payer is refused before it runs; PR #290's review). The read-only
  // unsigned count is not held to a number: the programs and the mint are read-only by nature.
  if (m.readonlySigners !== 0) return false;
  if (m.instructions.length !== 3) return false;
  const [create, pay, memo] = m.instructions;

  if (!is(create.program, ASSOCIATED_TOKEN_PROGRAM) || create.accounts.length !== 6) return false;
  if (create.data.length !== 1 || create.data[0] !== CREATE_IDEMPOTENT) return false;
  const [payer, account, owner, createMint, system, tokenProgram] = create.accounts;
  if (!is(payer, expected.source) || !is(owner, expected.owner) || !is(createMint, expected.mint)) return false;
  if (!is(system, SYSTEM_PROGRAM) || !is(tokenProgram, TOKEN_PROGRAM)) return false;

  if (!is(pay.program, TOKEN_PROGRAM) || pay.accounts.length !== 4) return false;
  const [, mint, destination, authority] = pay.accounts;
  if (destination !== account || !is(mint, expected.mint) || !is(authority, expected.source)) return false;
  const d = pay.data;
  if (d.length !== 10 || d[0] !== TRANSFER_CHECKED || d[9] !== USDC_DECIMALS || u64(d, 1) !== BigInt(amount)) return false;

  if (!is(memo.program, MEMO_PROGRAM) || memo.accounts.length !== 0) return false;
  return same(memo.data, new TextEncoder().encode(`deposit:${depositId}`));
}
