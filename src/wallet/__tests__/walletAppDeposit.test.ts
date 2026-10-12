// Deposit from a wallet app (Mobile Wallet Adapter, Android): the order of calls and every refusal. The byte check itself is
// `depositAsExpected`, whose tests run in the server's vitest suite against the real `buildDepositTransaction`
// (server/test/clientPaymentGuard.test.ts); here it is a spy, so these tests pin what it is asked and what its answer does.
import { beforeEach, expect, jest, test } from '@jest/globals';
import { getBase58Decoder } from '@solana/codecs-strings';
import type { DepositBuildResponse } from '@/api/contract';
import { depositAsExpected } from '@/api/paymentGuard';
import type { MobileWalletSession, MobileWalletTransact } from '../mobileWalletTypes';
import { WALLET_APP_CHAIN, connectWalletApp, depositFromWalletApp, walletAppAddress, walletAppSignature } from '../walletAppDeposit';

jest.mock('@/api/paymentGuard', () => ({ depositAsExpected: jest.fn() }));
const guard = jest.mocked(depositAsExpected);

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const KEY_B64 = Buffer.from(KEY).toString('base64');
const KEY_B58 = getBase58Decoder().decode(KEY);
const OTHER_B64 = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 200 - i)).toString('base64');
const OWNER = 'EmbeddedDepositWa11etAddressForTests1111111';
const MINT = '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547';

const SIG = Uint8Array.from({ length: 64 }, (_, i) => 255 - i);

function fakeWallet(accounts: string[] = [KEY_B64], signedMessage: (message: Uint8Array) => Uint8Array = () => SIG) {
  const calls: string[] = [];
  const wallet: MobileWalletSession = {
    authorize: jest.fn<MobileWalletSession['authorize']>(async (params) => {
      calls.push(params.auth_token ? `reauthorize:${params.auth_token}` : 'authorize');
      return { accounts: accounts.map((address) => ({ address, label: 'Seed Vault' })), auth_token: 'token-1' };
    }),
    signTransactions: jest.fn<MobileWalletSession['signTransactions']>(async ({ payloads }) => {
      calls.push(`sign:${payloads.join(',')}`);
      return { signed_payloads: payloads.map((p) => `signed(${p})`) };
    }),
    signMessages: jest.fn<MobileWalletSession['signMessages']>(async ({ addresses, payloads }) => {
      calls.push(`signMessage:${addresses.join(',')}`);
      return { signed_payloads: payloads.map((p) => Buffer.from(signedMessage(new Uint8Array(Buffer.from(p, 'base64')))).toString('base64')) };
    }),
  };
  const transact: MobileWalletTransact = async (session) => {
    calls.push('open');
    try { return await session(wallet); } finally { calls.push('close'); }
  };
  return { wallet, transact, calls };
}

function fakeApi(status: DepositBuildResponse['status'] = 'prepared', overrides: Partial<DepositBuildResponse> = {}) {
  const built: DepositBuildResponse = {
    depositId: 'dep-1', asset: 'USDC', amount: 5_000_000, destination: OWNER, transactionBase64: 'SERVER_BYTES',
    expiresAt: '2026-10-12T00:00:00.000Z', status, ...overrides,
  };
  return {
    buildDeposit: jest.fn(async () => built),
    submitDeposit: jest.fn(async () => ({ depositId: 'dep-1', asset: 'USDC' as const, amount: 5_000_000, destination: OWNER, signature: 'sig' })),
  };
}

const connection = { address: KEY_B58, label: 'Seed Vault', authToken: 'token-1' };

// Like the real guard, a null expectation (no pinned mint) is refused; anything else passes unless a test says otherwise.
beforeEach(() => { guard.mockReset(); guard.mockImplementation((_deposit, expected) => expected !== null); });

test('an MWA public key (base64) becomes the base58 address the API reads; anything not 32 bytes is refused', () => {
  expect(walletAppAddress(KEY_B64)).toBe(KEY_B58);
  expect(walletAppAddress(Buffer.from(KEY.slice(0, 31)).toString('base64'))).toBeNull();
  expect(walletAppAddress('')).toBeNull();
});

test('connecting asks the wallet app once, on mainnet, and keeps its account and auth token', async () => {
  const { wallet, transact, calls } = fakeWallet();
  await expect(connectWalletApp(transact)).resolves.toEqual({ address: KEY_B58, label: 'Seed Vault', authToken: 'token-1' });
  expect(calls).toEqual(['open', 'authorize', 'close']);
  expect(jest.mocked(wallet.authorize).mock.calls[0][0]).toMatchObject({ chain: WALLET_APP_CHAIN, identity: { name: 'Gotchapon' } });
});

test('a wallet app that shares no usable account is refused', async () => {
  await expect(connectWalletApp(fakeWallet([]).transact)).rejects.toThrow('shared no account');
  await expect(connectWalletApp(fakeWallet(['not-a-key']).transact)).rejects.toThrow('shared no account');
});

test('a deposit is built from the connected account, checked byte for byte, signed exactly as served, then submitted', async () => {
  const { transact, calls } = fakeWallet();
  const api = fakeApi();
  await depositFromWalletApp(transact, { api, connection, owner: OWNER, mint: MINT }, 5_000_000, 'idem-1');
  expect(api.buildDeposit).toHaveBeenCalledWith({ sourceWallet: KEY_B58, amount: 5_000_000, idem: 'idem-1' });
  expect(guard).toHaveBeenCalledWith(expect.objectContaining({ transactionBase64: 'SERVER_BYTES' }), { source: KEY_B58, owner: OWNER, mint: MINT });
  // The wallet app is opened only after the build and the check, re-authorized with the stored token, and signs the served bytes.
  expect(calls).toEqual(['open', 'reauthorize:token-1', 'sign:SERVER_BYTES', 'close']);
  expect(api.submitDeposit).toHaveBeenCalledWith({ depositId: 'dep-1', signedTransactionBase64: 'signed(SERVER_BYTES)', idem: 'idem-1' });
});

test.each([
  ['the byte check fails', () => { guard.mockReturnValue(false); return fakeApi(); }, MINT],
  ['no USDC mint is pinned', () => fakeApi(), null],
  ['the build pays someone else', () => fakeApi('prepared', { destination: 'SomeoneElse111111111111111111111111111111111' }), MINT],
  ['the build is for another amount', () => fakeApi('prepared', { amount: 1 }), MINT],
])('nothing is signed when %s', async (_case, makeApi, mint) => {
  const { transact, calls } = fakeWallet();
  const api = makeApi();
  await expect(depositFromWalletApp(transact, { api, connection, owner: OWNER, mint }, 5_000_000, 'idem-1')).rejects.toThrow('did not match');
  expect(calls).toEqual([]); // the wallet app was never opened
  expect(api.submitDeposit).not.toHaveBeenCalled();
});

test('a deposit the server already holds signed bytes for is submitted without asking the wallet app again', async () => {
  const { transact, calls } = fakeWallet();
  const api = fakeApi('signed');
  await depositFromWalletApp(transact, { api, connection, owner: OWNER, mint: MINT }, 5_000_000, 'idem-1');
  expect(calls).toEqual([]);
  expect(api.submitDeposit).toHaveBeenCalledWith({ depositId: 'dep-1', idem: 'idem-1' });
});

test('a committed deposit is done: nothing is signed or submitted', async () => {
  const { transact, calls } = fakeWallet();
  const api = fakeApi('committed');
  await depositFromWalletApp(transact, { api, connection, owner: OWNER, mint: MINT }, 5_000_000, 'idem-1');
  expect(calls).toEqual([]);
  expect(api.submitDeposit).not.toHaveBeenCalled();
});

test('a wallet app that now answers with a different account is refused before it signs', async () => {
  const { transact, calls } = fakeWallet([OTHER_B64]);
  const api = fakeApi();
  await expect(depositFromWalletApp(transact, { api, connection, owner: OWNER, mint: MINT }, 5_000_000, 'idem-1')).rejects.toThrow('Reconnect');
  expect(calls).toEqual(['open', 'reauthorize:token-1', 'close']);
  expect(api.submitDeposit).not.toHaveBeenCalled();
});

test('the signature is found whether the wallet app returns it bare, after the message, or before it', () => {
  const message = new TextEncoder().encode('sign in');
  expect(walletAppSignature(SIG, message)).toEqual(SIG);
  expect(walletAppSignature(Uint8Array.from([...message, ...SIG]), message)).toEqual(SIG);
  expect(walletAppSignature(Uint8Array.from([...SIG, ...message]), message)).toEqual(SIG);
  // Anything else is not trusted: a different message, or the wrong length.
  expect(walletAppSignature(Uint8Array.from([...new TextEncoder().encode('other!!'), ...SIG]), message)).toBeNull();
  expect(walletAppSignature(SIG.slice(0, 63), message)).toBeNull();
});

test('connect links the account in the same session: the wallet app signs the sign-in message for that exact account', async () => {
  const { transact, calls, wallet } = fakeWallet([KEY_B64], (m) => Uint8Array.from([...m, ...SIG]));
  const link = jest.fn(async (address: string, sign: (message: Uint8Array) => Promise<Uint8Array>) => {
    calls.push(`link:${address}`);
    expect(await sign(new TextEncoder().encode('sign in'))).toEqual(SIG);
  });
  await expect(connectWalletApp(transact, link)).resolves.toMatchObject({ address: KEY_B58 });
  expect(calls).toEqual(['open', 'authorize', `link:${KEY_B58}`, `signMessage:${KEY_B64}`, 'close']);
  expect(jest.mocked(wallet.signMessages).mock.calls[0][0].payloads).toEqual([Buffer.from('sign in').toString('base64')]);
  expect(wallet.signTransactions).not.toHaveBeenCalled();
});

test('a failed link fails the connect: no half-connected account is kept', async () => {
  const { transact } = fakeWallet([KEY_B64], () => new Uint8Array(10)); // a signature that is none of the three shapes
  const link = jest.fn(async (_address: string, sign: (message: Uint8Array) => Promise<Uint8Array>) => { await sign(new TextEncoder().encode('sign in')); });
  await expect(connectWalletApp(transact, link)).rejects.toThrow('no signature');
});
