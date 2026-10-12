import { getAddMemoInstruction } from '@solana-program/memo';
import {
  findAssociatedTokenPda, getApproveCheckedInstruction, getApproveInstruction, getCreateAssociatedTokenIdempotentInstruction,
  getSetAuthorityInstruction, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS, AuthorityType,
} from '@solana-program/token';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
  address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner, createTransactionMessage, getCompiledTransactionMessageDecoder, getTransactionDecoder,
  getBase64EncodedWireTransaction, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from '@solana/kit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
// The client's guard (#186) held to the server's own builder, not to a copy of it: the app has to accept exactly what
// /pulls/prepare sends and refuse everything else. It lives here, not beside the guard in src/, because jest cannot load
// @solana/kit's ESM build and because a change to preparePaymentTransaction has to fail THIS suite, which is the one it runs in.
import type { Transfer } from '../../src/api/contract';
import { depositAsExpected, paysAsExpected, type ExpectedDeposit, type ExpectedPayment } from '../../src/api/paymentGuard';
import { SERVED_PAYMENT, SERVED_PAYMENT_INPUT } from '../../src/api/__fixtures__/servedPayment';
import { buildDepositTransaction, preparePaymentTransaction } from '../src/payments';
import type { Env } from '../src/types';

// mainnet-dev's values from server/wrangler.jsonc and server/config/mainnet-dev.json.
const TREASURY = '5J5wfNFJREQ43C9LBeb6qHJm3uN1aKWhb9351BhRgEpt';
const MINT = '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547';
const FEE_PAYER = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
const WALLET = '9d4LUccwNb1JehNAW4rgy4CzBpxNv32KZ2YZcMTywEV6';
const OTHER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // any other valid address
const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
const PULL = 'pull_0123456789abcdef';
const AMOUNT = 1_000_000;
const expected: ExpectedPayment = { to: TREASURY, mint: MINT };

const env = {
  TREASURY_USDC_TOKEN_ACCOUNT: TREASURY, USDC_MINT: MINT, ENABLED_ASSETS: 'USDC',
  FEE_PAYER_ADDRESS: FEE_PAYER, SOLANA_RPC_URL: 'https://rpc.invalid',
} as unknown as Env;

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true); // @solana/kit derives addresses with SubtleCrypto, which asks for one
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    jsonrpc: '2.0', id: 'getLatestBlockhash', result: { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 } },
  })));
});
afterEach(() => { vi.unstubAllGlobals(); });

async function served(over: { memo?: string; amount?: number; wallet?: string } = {}): Promise<Transfer> {
  const tx = await preparePaymentTransaction(env, {
    wallet: over.wallet ?? WALLET, memo: over.memo ?? PULL, asset: 'USDC', amount: over.amount ?? AMOUNT,
  });
  return { to: TREASURY, mint: MINT, amount: AMOUNT, memo: PULL, transactionBase64: tx };
}

/** A transaction built by hand, for the shapes the server never builds. Same fee payer, lifetime and version. */
async function built(instructions: (source: string) => Instruction[]): Promise<Transfer> {
  const [source] = await findAssociatedTokenPda({ owner: address(WALLET), mint: address(MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(FEE_PAYER), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(BLOCKHASH), lastValidBlockHeight: BigInt(1000) }, m),
    (m) => appendTransactionMessageInstructions(instructions(source), m),
  );
  return { to: TREASURY, mint: MINT, amount: AMOUNT, memo: PULL, transactionBase64: getBase64EncodedWireTransaction(compileTransaction(message)) };
}

const transfer = (source: string, o: { to?: string; mint?: string; amount?: number; decimals?: number; authority?: string; program?: string } = {}) =>
  getTransferCheckedInstruction({
    source: address(source), mint: address(o.mint ?? MINT), destination: address(o.to ?? TREASURY),
    authority: createNoopSigner(address(o.authority ?? WALLET)), amount: BigInt(o.amount ?? AMOUNT), decimals: o.decimals ?? 6,
  }, o.program ? { programAddress: address(o.program) } : undefined);
const memo = (text = PULL) => getAddMemoInstruction({ memo: text });

describe('paysAsExpected', () => {
  test('accepts what the server builds for this pull', async () => {
    expect(paysAsExpected(PULL, await served(), expected, WALLET)).toBe(true);
  });

  test("the app's jest fixture is still byte for byte what the server builds", async () => {
    // src/state/__tests__/paymentFlow.test.ts signs this fixture through the session seam; if the builder changes, the
    // fixture has to be regenerated from here (print `(await served()).transactionBase64`) or the app tests prove nothing.
    expect(SERVED_PAYMENT_INPUT).toEqual({ pullId: PULL, amount: AMOUNT, treasury: TREASURY, mint: MINT, wallet: WALLET });
    expect((await served()).transactionBase64).toBe(SERVED_PAYMENT);
  });

  test('accepts the same shape built by hand (the control for every refusal below)', async () => {
    expect(paysAsExpected(PULL, await built((s) => [transfer(s), memo()]), expected, WALLET)).toBe(true);
  });

  test('refuses a transaction paying another destination, even with the JSON field right', async () => {
    expect(paysAsExpected(PULL, await built((s) => [transfer(s, { to: OTHER }), memo()]), expected, WALLET)).toBe(false);
  });

  test('refuses a transaction in another mint, even with the JSON field right', async () => {
    expect(paysAsExpected(PULL, await built((s) => [transfer(s, { mint: OTHER }), memo()]), expected, WALLET)).toBe(false);
  });

  test('refuses a transaction for another amount than the quote says', async () => {
    expect(paysAsExpected(PULL, await served({ amount: AMOUNT + 1 }), expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, await built((s) => [transfer(s, { amount: AMOUNT * 100 }), memo()]), expected, WALLET)).toBe(false);
  });

  test('refuses other decimals', async () => {
    expect(paysAsExpected(PULL, await built((s) => [transfer(s, { decimals: 9 }), memo()]), expected, WALLET)).toBe(false);
  });

  test('refuses a transaction whose memo names another pull', async () => {
    expect(paysAsExpected(PULL, await served({ memo: 'pull_someone_else' }), expected, WALLET)).toBe(false);
  });

  test('refuses a memo that is only the start of the pull id, or longer than it', async () => {
    // The commit matches the memo exactly: a prefix would move the money and then fail the commit.
    for (const memo of [PULL.slice(0, 9), 'p', `${PULL}x`]) {
      expect(paysAsExpected(PULL, await served({ memo }), expected, WALLET)).toBe(false);
    }
  });

  test("refuses a transaction that makes the user's wallet pay its fees", async () => {
    const [source] = await findAssociatedTokenPda({ owner: address(WALLET), mint: address(MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(WALLET), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(BLOCKHASH), lastValidBlockHeight: BigInt(1000) }, m),
      (m) => appendTransactionMessageInstructions([transfer(source), memo()], m),
    );
    const t: Transfer = { to: TREASURY, mint: MINT, amount: AMOUNT, memo: PULL, transactionBase64: getBase64EncodedWireTransaction(compileTransaction(message)) };
    expect(paysAsExpected(PULL, t, expected, WALLET)).toBe(false);
  });

  test('refuses a transfer signed for by a wallet other than the one being asked', async () => {
    expect(paysAsExpected(PULL, await served({ wallet: OTHER }), expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, await served(), expected, OTHER)).toBe(false);
  });

  test('refuses a JSON description that disagrees with the pinned values', async () => {
    const t = await served();
    expect(paysAsExpected(PULL, { ...t, to: OTHER }, expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, { ...t, mint: OTHER }, expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, { ...t, mint: 'USDC' }, expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, { ...t, memo: 'pull_other' }, expected, WALLET)).toBe(false);
  });

  test('refuses anything besides the transfer and its memo', async () => {
    const approve = (s: string) => getApproveInstruction({
      source: address(s), delegate: address(OTHER), owner: createNoopSigner(address(WALLET)), amount: BigInt(10) ** BigInt(12),
    });
    expect(paysAsExpected(PULL, await built((s) => [transfer(s), memo(), approve(s)]), expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, await built((s) => [transfer(s), transfer(s, { to: OTHER }), memo()]), expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, await built((s) => [transfer(s)]), expected, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, await built((s) => [memo(), transfer(s)]), expected, WALLET)).toBe(false);
  });

  test('refuses an approval shaped like the transfer (same accounts, same data length): only TransferChecked pays', async () => {
    // ApproveChecked is [source, mint, delegate, owner] with a u64 and the decimals, exactly TransferChecked's layout: without
    // the discriminator check, a quote could hand the treasury account a standing allowance over the wallet instead.
    const approve = (s: string) => getApproveCheckedInstruction({
      source: address(s), mint: address(MINT), delegate: address(TREASURY), owner: createNoopSigner(address(WALLET)),
      amount: BigInt(AMOUNT), decimals: 6,
    });
    expect(paysAsExpected(PULL, await built((s) => [approve(s), memo()]), expected, WALLET)).toBe(false);
  });

  test('refuses the same transfer under another token program', async () => {
    expect(paysAsExpected(PULL, await built((s) => [transfer(s, { program: TOKEN_2022_PROGRAM_ADDRESS }), memo()]), expected, WALLET)).toBe(false);
  });

  test('refuses a "memo" sent to another program, even carrying the pull id', async () => {
    const fake: Instruction = { programAddress: address(OTHER), accounts: [], data: new TextEncoder().encode(PULL) };
    expect(paysAsExpected(PULL, await built((s) => [transfer(s), fake]), expected, WALLET)).toBe(false);
  });

  test('refuses a message that carries an address lookup table (the server uses none)', async () => {
    // The server's own bytes with one table entry added in place of the empty section (32-byte table address, no writable and
    // no read-only indexes). Every instruction still reads exactly as before, so the table is the only thing to refuse.
    const t = await served();
    const bytes = Uint8Array.from(atob(t.transactionBase64!), (c) => c.charCodeAt(0));
    expect(bytes.at(-1)).toBe(0); // the control: the message ends with an empty lookup-table section
    const table = Uint8Array.from([1, ...new Uint8Array(32).fill(7), 0, 0]);
    const withTable = Uint8Array.from([...bytes.subarray(0, bytes.length - 1), ...table]);
    const tx = btoa(String.fromCharCode(...withTable));
    // ... and the edit is a well-formed v0 message with exactly one table, not garbage
    expect(getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(withTable).messageBytes))
      .toMatchObject({ version: 0, addressTableLookups: [{ writableIndexes: [], readonlyIndexes: [] }] });
    expect(paysAsExpected(PULL, { ...t, transactionBase64: tx }, expected, WALLET)).toBe(false);
  });

  test('refuses when the build pinned nothing, or there is no wallet to sign', async () => {
    const t = await served();
    expect(paysAsExpected(PULL, t, null, WALLET)).toBe(false);
    expect(paysAsExpected(PULL, t, expected, null)).toBe(false);
    expect(paysAsExpected(PULL, t, expected, undefined)).toBe(false);
    expect(paysAsExpected(PULL, t, { to: '', mint: MINT }, WALLET)).toBe(false);
  });

  test('refuses unreadable bytes without throwing', async () => {
    const t = await served();
    const bytes = Uint8Array.from(atob(t.transactionBase64!), (c) => c.charCodeAt(0));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    for (const tx of [
      undefined, '', 'not base64 !!', 'AAAA', b64(bytes.subarray(0, bytes.length - 1)), b64(Uint8Array.from([...bytes, 0])),
      'A'.repeat(5000),
    ]) {
      expect(() => paysAsExpected(PULL, { ...t, transactionBase64: tx }, expected, WALLET)).not.toThrow();
      expect(paysAsExpected(PULL, { ...t, transactionBase64: tx }, expected, WALLET)).toBe(false);
    }
  });

  test('refuses a message whose version byte says it is not v0, however well the rest reads', async () => {
    // The same bytes with the prefix changed are a legacy message to the chain, laid out differently: read as v0 they would
    // describe a payment the chain does not make.
    const t = await served();
    const bytes = Uint8Array.from(atob(t.transactionBase64!), (c) => c.charCodeAt(0));
    const at = 1 + 64 * bytes[0]; // after the signature slots
    expect(bytes[at]).toBe(0x80); // the control: this is the version byte, and the message is v0
    bytes[at] = 0x02;
    expect(paysAsExpected(PULL, { ...t, transactionBase64: btoa(String.fromCharCode(...bytes)) }, expected, WALLET)).toBe(false);
  });

  test('refuses an amount that is not a whole number of base units, without throwing', async () => {
    const t = await served();
    for (const amount of [String(AMOUNT), AMOUNT + 0.5, Number.NaN, -AMOUNT, 0, null, undefined]) {
      const odd = { ...t, amount: amount as unknown as number };
      expect(() => paysAsExpected(PULL, odd, expected, WALLET)).not.toThrow();
      expect(paysAsExpected(PULL, odd, expected, WALLET)).toBe(false);
    }
  });

  test('refuses a legacy message (the server builds v0)', async () => {
    const [source] = await findAssociatedTokenPda({ owner: address(WALLET), mint: address(MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayer(address(FEE_PAYER), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(BLOCKHASH), lastValidBlockHeight: BigInt(1000) }, m),
      (m) => appendTransactionMessageInstructions([transfer(source), memo()], m),
    );
    const t: Transfer = { to: TREASURY, mint: MINT, amount: AMOUNT, memo: PULL, transactionBase64: getBase64EncodedWireTransaction(compileTransaction(message)) };
    expect(paysAsExpected(PULL, t, expected, WALLET)).toBe(false);
  });
});

test('a non-canonical length is refused: the wallet would re-encode it and sign other bytes than were checked', async () => {
  // The server's own pull transaction, with its leading signature count (a compact-u16) re-written in two bytes: the same
  // value, not the shortest encoding. Every other byte is untouched, so this is the only thing to refuse.
  const t = await served();
  const bytes = Uint8Array.from(atob(t.transactionBase64!), (c) => c.charCodeAt(0));
  expect(paysAsExpected(PULL, t, expected, WALLET)).toBe(true); // the control
  expect(bytes[0]).toBeLessThan(0x80);
  const padded = Uint8Array.from([bytes[0] | 0x80, 0x00, ...bytes.subarray(1)]);
  expect(paysAsExpected(PULL, { ...t, transactionBase64: btoa(String.fromCharCode(...padded)) }, expected, WALLET)).toBe(false);
});

// ---- the connected-wallet deposit (#278) ----
// Built by the server's own builder: from SOURCE (the wallet the user signed in with) to OWNER (their embedded wallet).
const SOURCE = WALLET;
const OWNER = FEE_PAYER; // any other valid address: the embedded wallet
const DEPOSIT = 'dep_0123456789abcdef';
const expectedDeposit: ExpectedDeposit = { source: SOURCE, owner: OWNER, mint: MINT };

async function servedDeposit(over: { source?: string; owner?: string; amount?: number; memo?: string; mint?: string } = {}) {
  const tx = await buildDepositTransaction({ ...env, USDC_MINT: over.mint ?? MINT } as Env, {
    sourceWallet: over.source ?? SOURCE, destinationWallet: over.owner ?? OWNER,
    memo: over.memo ?? `deposit:${DEPOSIT}`, amount: over.amount ?? AMOUNT,
  });
  return { depositId: DEPOSIT, amount: AMOUNT, transactionBase64: tx };
}

/** A deposit built by hand, for the shapes the server never builds: same lifetime and version, fee payer SOURCE unless said. */
async function builtDeposit(instructions: (a: { from: string; to: string }) => Instruction[], feePayer = SOURCE) {
  const [from] = await findAssociatedTokenPda({ owner: address(SOURCE), mint: address(MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [to] = await findAssociatedTokenPda({ owner: address(OWNER), mint: address(MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(BLOCKHASH), lastValidBlockHeight: BigInt(1000) }, m),
    (m) => appendTransactionMessageInstructions(instructions({ from, to }), m),
  );
  return { depositId: DEPOSIT, amount: AMOUNT, transactionBase64: getBase64EncodedWireTransaction(compileTransaction(message)) };
}
const create = (to: string, o: { owner?: string; payer?: string } = {}) => getCreateAssociatedTokenIdempotentInstruction({
  payer: createNoopSigner(address(o.payer ?? SOURCE)), ata: address(to), owner: address(o.owner ?? OWNER), mint: address(MINT),
});
const move = (from: string, to: string, o: { amount?: number; authority?: string; mint?: string } = {}) => getTransferCheckedInstruction({
  source: address(from), mint: address(o.mint ?? MINT), destination: address(to), authority: createNoopSigner(address(o.authority ?? SOURCE)),
  amount: BigInt(o.amount ?? AMOUNT), decimals: 6,
});
const depositMemo = (id = DEPOSIT) => getAddMemoInstruction({ memo: `deposit:${id}` });

describe('depositAsExpected', () => {
  test('accepts what the server builds for this deposit', async () => {
    expect(depositAsExpected(await servedDeposit(), expectedDeposit)).toBe(true);
  });

  test('accepts the same shape built by hand (the control for every refusal below)', async () => {
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to), move(from, to), depositMemo()]), expectedDeposit)).toBe(true);
  });

  test('refuses another amount, another deposit id, another mint', async () => {
    expect(depositAsExpected({ ...(await servedDeposit()), amount: AMOUNT + 1 }, expectedDeposit)).toBe(false);
    expect(depositAsExpected(await servedDeposit({ amount: AMOUNT * 100 }), expectedDeposit)).toBe(false);
    expect(depositAsExpected({ ...(await servedDeposit()), depositId: 'dep_other' }, expectedDeposit)).toBe(false);
    expect(depositAsExpected(await servedDeposit({ memo: 'deposit:dep_other' }), expectedDeposit)).toBe(false);
    expect(depositAsExpected(await servedDeposit({ mint: OTHER }), expectedDeposit)).toBe(false);
  });

  test('refuses money going to anyone but the embedded wallet', async () => {
    expect(depositAsExpected(await servedDeposit({ owner: OTHER }), expectedDeposit)).toBe(false);
    // The created account is the embedded wallet's, but the transfer credits another account: the money would not land there.
    const [elsewhere] = await findAssociatedTokenPda({ owner: address(OTHER), mint: address(MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to), move(from, elsewhere), depositMemo()]), expectedDeposit)).toBe(false);
  });

  test('refuses a deposit from, or authorised by, any wallet but the one the user signed in with', async () => {
    expect(depositAsExpected(await servedDeposit({ source: OTHER }), expectedDeposit)).toBe(false);
    expect(depositAsExpected(await servedDeposit(), { ...expectedDeposit, source: OTHER })).toBe(false);
  });

  test('refuses a second signer: the connected wallet pays the fee and signs alone', async () => {
    const t = await builtDeposit(({ from, to }) => [create(to), move(from, to), depositMemo()], OTHER);
    expect(depositAsExpected(t, expectedDeposit)).toBe(false);
  });

  test('refuses anything besides the create, the transfer and the memo', async () => {
    const approve = (from: string) => getApproveInstruction({
      source: address(from), delegate: address(OTHER), owner: createNoopSigner(address(SOURCE)), amount: BigInt(10) ** BigInt(12),
    });
    const setAuthority = (from: string) => getSetAuthorityInstruction({
      owned: address(from), owner: createNoopSigner(address(SOURCE)), authorityType: AuthorityType.AccountOwner, newAuthority: address(OTHER),
    });
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to), move(from, to), depositMemo(), approve(from)]), expectedDeposit)).toBe(false);
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to), move(from, to), setAuthority(from)]), expectedDeposit)).toBe(false);
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [move(from, to), depositMemo()]), expectedDeposit)).toBe(false);
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to), depositMemo(), move(from, to)]), expectedDeposit)).toBe(false);
  });

  test('refuses a create for another owner or paid by another wallet', async () => {
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to, { owner: OTHER }), move(from, to), depositMemo()]), expectedDeposit)).toBe(false);
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to, { payer: OTHER }), move(from, to), depositMemo()]), expectedDeposit)).toBe(false);
  });

  test('refuses a transfer of another mint into the account created for the pinned one', async () => {
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [create(to), move(from, to, { mint: OTHER }), depositMemo()]), expectedDeposit)).toBe(false);
  });

  test('refuses a create instruction sent to another program', async () => {
    const fake = (to: string): Instruction => ({ ...create(to), programAddress: address(OTHER) });
    expect(depositAsExpected(await builtDeposit(({ from, to }) => [fake(to), move(from, to), depositMemo()]), expectedDeposit)).toBe(false);
  });

  test('refuses a header that asks for a second signature, with every instruction right', async () => {
    // The server's own deposit, re-written to require two signatures (the header's first count, and a second signature slot):
    // the account after the fee payer becomes a signer without any instruction changing.
    const t = await servedDeposit();
    const bytes = Uint8Array.from(atob(t.transactionBase64), (c) => c.charCodeAt(0));
    expect([bytes[0], bytes[65], bytes[66]]).toEqual([1, 0x80, 1]); // the control: one signature, a v0 message, one signer
    const two = Uint8Array.from([2, ...bytes.subarray(1, 65), ...new Uint8Array(64), 0x80, 2, ...bytes.subarray(67)]);
    expect(getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(two).messageBytes).header.numSignerAccounts).toBe(2);
    expect(depositAsExpected({ ...t, transactionBase64: btoa(String.fromCharCode(...two)) }, expectedDeposit)).toBe(false);
  });

  test('refuses a read-only fee payer (the header marks a signer read-only)', async () => {
    const t = await servedDeposit();
    const bytes = Uint8Array.from(atob(t.transactionBase64), (c) => c.charCodeAt(0));
    expect(bytes[67]).toBe(0); // the control: no read-only signer in what the server builds
    const edited = Uint8Array.from(bytes); edited[67] = 1;
    expect(depositAsExpected({ ...t, transactionBase64: btoa(String.fromCharCode(...edited)) }, expectedDeposit)).toBe(false);
  });

  test('refuses a deposit whose source is its own destination, even built that way', async () => {
    const self = await servedDeposit({ owner: SOURCE });
    expect(depositAsExpected(self, { ...expectedDeposit, owner: SOURCE })).toBe(false);
  });

  test('refuses a non-canonical length in a deposit too', async () => {
    const t = await servedDeposit();
    const bytes = Uint8Array.from(atob(t.transactionBase64), (c) => c.charCodeAt(0));
    const padded = Uint8Array.from([bytes[0] | 0x80, 0x00, ...bytes.subarray(1)]);
    expect(depositAsExpected({ ...t, transactionBase64: btoa(String.fromCharCode(...padded)) }, expectedDeposit)).toBe(false);
  });

  test('refuses when nothing is pinned, when source and owner are one wallet, and unreadable bytes without throwing', async () => {
    const t = await servedDeposit();
    expect(depositAsExpected(t, null)).toBe(false);
    expect(depositAsExpected(t, { ...expectedDeposit, mint: '' })).toBe(false);
    expect(depositAsExpected(t, { ...expectedDeposit, owner: SOURCE })).toBe(false);
    for (const tx of ['', 'not base64 !!', 'AAAA', 'A'.repeat(5000)]) {
      expect(() => depositAsExpected({ ...t, transactionBase64: tx }, expectedDeposit)).not.toThrow();
      expect(depositAsExpected({ ...t, transactionBase64: tx }, expectedDeposit)).toBe(false);
    }
  });
});
