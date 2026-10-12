// The Wallet's Copy address button (F5.2): it copies the deposit address and says "Copied" for 1.6 s.
//
// "Copied" erases itself 1.6 s after it appears (`WalletPage.tsx`, the effect on `copied`), well inside RNTL's 5 s
// `asyncUtilTimeout`, so an assertion that starts later than 1.6 s after the press can never find it — measured: a bare
// 1.8 s await between the press and `findByText('Copied')` fails with "Unable to find an element with text: Copied". The
// clock is held still for this file instead; `heldTimers.ts` says why, and what the hold still pins.
//
// Its own file rather than a line in `pages.test.tsx`, so the hold on 1600 ms timers is scoped to the tests that need it.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/auth/AuthProvider';
import { AuthCtx, type Auth } from '@/auth/context';
import { HeaderOverlay } from '@/components/HeaderOverlay';
import { SessionProvider } from '@/state/session';
import { RitualProvider } from '@/ritual/useRitual';
import { shortAddress } from '@/format';
import { WalletPage, depositWalletCopy } from '@/screens/WalletPage';
import { DEMO_WALLET } from '@/api/mock';
import { heldTimers } from './heldTimers';

// Copy, the QR and the address exist only on a build talking to a real server: on a mock build the deposit card is the demo
// notice instead (#185, `walletDemo.test.tsx`). Jest's own default is the mock (`__DEV__` with no API URL), so this file
// says otherwise — the data still comes from the in-app mock, only the flag the screen branches on changes.
jest.mock('@/api', () => ({ ...jest.requireActual<object>('@/api'), usingMock: false }));

const COPIED_MS = 1600; // `WalletPage.tsx`: how long the button reads "Copied"
const copies = heldTimers(COPIED_MS);
const ADDRESS = DEMO_WALLET; // whatever the in-app mock answers /me with is what the page shows

const connectedDeposit = jest.fn(async (_amountBase: number, _idem: string) => {});
const connectedAuth: Auth = {
  ready: true,
  stage: 'done',
  provider: 'wallet',
  step: '',
  wallet: 'EmbeddedWalletForDepositTest',
  loginWallet: { name: 'Phantom', address: 'ConnectedWalletForDepositTest' },
  onboardingIndex: 0,
  error: null,
  appleReady: true,
  signIn: async () => {},
  sendEmailCode: async () => false,
  signSolanaTransaction: null,
  depositFromConnectedWallet: connectedDeposit,
  signOut: () => {},
  nextSheet: () => {},
  skipOnboarding: () => {},
};

async function renderWallet() {
  jest.mocked(Clipboard.setStringAsync).mockClear();
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <RitualProvider><WalletPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  // Copy address is disabled until /me gives the page an address. A press before that copies nothing (measured: zero
  // clipboard calls), so a test that skipped this wait would be asserting on a button that was never live.
  await screen.findByText(ADDRESS);
}

test('social deposit copy is unchanged, and a SIWS binder deposits to the embedded wallet', () => {
  expect(depositWalletCopy(null)).toEqual({ title: 'Solana wallet', sub: 'Made for you at sign-in · nothing to write down' });
  expect(depositWalletCopy('Phantom')).toEqual({ title: 'Solana wallet', sub: 'Deposit address · not your Phantom address' });
  expect(depositWalletCopy('connected wallet').sub).toBe('Deposit address · not the wallet you signed in with');
});

test('Copy address copies the deposit address and says Copied, which clears itself on the design 1.6 s timer', async () => {
  await renderWallet();
  await fireEvent.press(screen.getByText('Copy address'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(ADDRESS);
  expect(await screen.findByText('Copied')).toBeTruthy();
  // The life, read off the timer the page armed. A wall-clock wait for "Copied" to go could only show that something took
  // it away by the time it woke — any life under the wait's budget would pass.
  expect(copies.pending().map((t) => t.ms)).toEqual([COPIED_MS]);
  await copies.fire(); // and what that timer does when it comes due is put the button back
  // ...and it stays back for at least as long as "Copied" was ever shown, polled rather than sampled at its ends. What that
  // leaves unseen: a "Copied" that comes back more than one life after the clear.
  await copies.holds(COPIED_MS, () => {
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.getByText('Copy address')).toBeTruthy();
  });
});

test('a SIWS user can deposit from the connected wallet into the embedded address', async () => {
  connectedDeposit.mockClear();
  await render(
    <SafeAreaProvider>
      <AuthCtx.Provider value={connectedAuth}>
        <SessionProvider>
          <RitualProvider><WalletPage /></RitualProvider>
        </SessionProvider>
      </AuthCtx.Provider>
    </SafeAreaProvider>,
  );
  await screen.findByText('EmbeddedWalletForDepositTest');
  await fireEvent.press(screen.getByText('Deposit from connected wallet'));
  await fireEvent.changeText(screen.getByLabelText('Deposit amount in USDC'), '2');
  await fireEvent.press(screen.getByText('Sign and deposit $2.00'));
  expect(connectedDeposit).toHaveBeenCalledTimes(1);
  expect(connectedDeposit).toHaveBeenCalledWith(2_000_000, expect.any(String));
  expect(screen.getByText('Solana wallet')).toBeTruthy();
  expect(screen.getByText('EmbeddedWalletForDepositTest')).toBeTruthy();
});

// The other half of #185: off a mock build the demo surfaces are gone. Both are gated on the same flag this file mocks
// false, and both are asserted here so the gate is proved in the direction that matters for a preview or production build.
test('off the mock there is no demo notice on the wallet and no DEMO pill in the header', async () => {
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <RitualProvider><WalletPage /><HeaderOverlay onOpenSettings={() => {}} /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await screen.findByText(ADDRESS); // the real deposit card is what this build draws
  // The real card's own parts, asserted here because the demo tests can only say they are absent: with both files saying
  // "not there", deleting `<Listening>` from the real card would have passed everywhere (PR #194's review).
  expect(screen.getByText('Listening for deposits')).toBeTruthy();
  expect(screen.getByText('Made for you at sign-in · nothing to write down')).toBeTruthy();
  expect(screen.queryByText('Approve each top-up in your wallet')).toBeNull();
  // The QR's contents, not its wrapper: an empty `<View testID="deposit-qr" />` satisfies `getByTestId` and draws no code
  // (measured — that mutant survived the first version of this line).
  expect(screen.getByTestId('deposit-qr').children.length).toBeGreaterThan(0);
  expect(screen.queryByText('Demo build — not a real wallet')).toBeNull();
  // The pill by its label, not by a search for "DEMO": the address on screen is the in-app mock's own fixture, which
  // carries that word. A real build's address comes from the server; the pill is what must not be there either way.
  expect(screen.queryByLabelText(/^Demo data:/)).toBeNull();
  expect(screen.queryByText('DEMO +$10')).toBeNull();
  expect(screen.queryByText('DEMO')).toBeNull(); // the off-Pull spelling
});

test('a SIWS wallet shows the deposit card for the embedded address, not an approve-in-Phantom prompt', async () => {
  const embedded = 'PrivyEmbeddedDepositAddressForSiwsTest0001';
  const phantom = 'So1anaExternalWalletAddressForSiwsTest11';
  const auth = {
    ready: true, stage: 'done', provider: 'wallet', step: '', wallet: embedded,
    loginWallet: { name: 'Phantom', address: phantom },
    onboardingIndex: 0, error: null, appleReady: true,
    signIn: jest.fn(), sendEmailCode: async () => false, signSolanaTransaction: null,
    depositFromConnectedWallet: null, signOut: jest.fn(), nextSheet: jest.fn(), skipOnboarding: jest.fn(),
  } as Auth;
  jest.mocked(Clipboard.setStringAsync).mockClear();
  await render(
    <SafeAreaProvider>
      <AuthCtx.Provider value={auth}>
        <SessionProvider>
          <RitualProvider><WalletPage /></RitualProvider>
        </SessionProvider>
      </AuthCtx.Provider>
    </SafeAreaProvider>,
  );
  expect(await screen.findByText(embedded)).toBeTruthy();
  expect(screen.queryByText(ADDRESS)).toBeNull();
  expect(screen.getByText('Deposit address · not your Phantom address')).toBeTruthy();
  expect(screen.getByText(`${shortAddress(phantom)} is your Phantom address. Deposits do not go there.`)).toBeTruthy();
  expect(screen.getByText('Listening for deposits')).toBeTruthy();
  expect(screen.getByTestId('deposit-qr').children.length).toBeGreaterThan(0);
  expect(screen.queryByText('Approve each top-up in your wallet')).toBeNull();
  expect(screen.queryByText('Connected wallet')).toBeNull();
  await fireEvent.press(screen.getByText('Copy address'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(embedded);
});

test('a clipboard that refuses never says Copied', async () => {
  await renderWallet();
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('clipboard unavailable'));
  await fireEvent.press(screen.getByText('Copy address'));
  // The press reached the copy — without this, a disabled button saying nothing would pass the assertions below.
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(ADDRESS);
  expect(copies.pending()).toEqual([]); // no "Copied" timer was ever armed
  await copies.holds(COPIED_MS, () => expect(screen.queryByText('Copied')).toBeNull());
});

// PR #302's second review: `alreadyClaimed` is also true when a retry finds this same wallet's grant already sent (a first
// response lost after the grant went out). "Sent to another of its wallets" is the grant's wallet differing from the one
// asked for, never the flag alone.
test.each([
  ['the same wallet, already sent', ADDRESS, false],
  ['another of the account\'s wallets', 'AnotherWalletOfThisAccount', true],
])('a faucet claim answered alreadyClaimed for %s', async (_case, grantWallet, saysElsewhere) => {
  const { api } = jest.requireActual<typeof import('@/api')>('@/api');
  const real = await api.fundingConfig();
  jest.spyOn(api, 'fundingConfig').mockResolvedValue({ ...real, faucet: { asset: 'USDC', amount: 20_000_000, claimed: false } });
  const claim = jest.spyOn(api, 'claimFaucet').mockResolvedValue({
    asset: 'USDC', amount: 20_000_000, signature: 'sig', alreadyClaimed: true, wallet: grantWallet,
  });
  await renderWallet();
  await fireEvent.press(await screen.findByText('Claim test USDC'));
  expect(claim).toHaveBeenCalledWith(undefined);
  await screen.findByText('Test USDC claimed');
  expect(!!screen.queryByText('This account already had its test USDC, sent to another of its wallets.')).toBe(saysElsewhere);
});

// #304: where the grant went is read from /funding, so it survives a reload; a stuck grant (the server's 409) says it needs a
// hand fix instead of promising that a retry works.
const ELSEWHERE = 'This account already had its test USDC, sent to another of its wallets.';
const STUCK = 'This account’s test USDC may need a hand fix. If trying again later doesn’t work, ask the team.';
const RETRY = 'The faucet did not finish. Try again—the same grant is safely retried.';

test.each([
  ['another of the account\'s wallets', 'AnotherWalletOfThisAccount', true],
  ['this wallet', ADDRESS, false],
])('after a reload, a grant already sent to %s', async (_case, sentTo, saysElsewhere) => {
  const { api } = jest.requireActual<typeof import('@/api')>('@/api');
  const real = await api.fundingConfig();
  jest.spyOn(api, 'fundingConfig').mockResolvedValue({ ...real, faucet: { asset: 'USDC', amount: 20_000_000, claimed: true, wallet: sentTo } });
  await renderWallet();
  await screen.findByText('Test USDC claimed');
  expect(!!screen.queryByText(ELSEWHERE)).toBe(saysElsewhere);
});

test.each([
  ['a 409 is a hand fix', 409, STUCK, RETRY],
  ['any other failure is a retry', 503, RETRY, STUCK],
])('a failed claim: %s', async (_case, status, shown, hidden) => {
  const { api, ApiError } = jest.requireActual<typeof import('@/api')>('@/api');
  const real = await api.fundingConfig();
  jest.spyOn(api, 'fundingConfig').mockResolvedValue({ ...real, faucet: { asset: 'USDC', amount: 20_000_000, claimed: false } });
  jest.spyOn(api, 'claimFaucet').mockRejectedValue(new ApiError({ code: 'UNKNOWN', message: 'server said so' }, status));
  await renderWallet();
  await fireEvent.press(await screen.findByText('Claim test USDC'));
  expect(await screen.findByText(shown)).toBeTruthy();
  expect(screen.queryByText(hidden)).toBeNull();
});

// USDC only (Ben, 11 Oct): every pull pays USDC, so the deposit card names nothing else. On the test site (the faucet runs
// there) it also says that only the test USDC counts, in words a player knows: no "token" (CLAUDE.md product rules).
test.each([
  ['the real site', false, 'USDC on Solana · no fees, no minimum', 'Only send USDC on Solana to this address. Anything else can’t be recovered.'],
  ['the test site', true, 'Test USDC on Solana · no fees, no minimum', 'Only the test USDC above counts here. Real USDC sent to this address is not counted on this test site.'],
])('the deposit card on %s names USDC alone', async (_case, faucet, sub, warn) => {
  const { api } = jest.requireActual<typeof import('@/api')>('@/api');
  const real = await api.fundingConfig();
  jest.spyOn(api, 'fundingConfig').mockResolvedValue({
    ...real, faucet: faucet ? { asset: 'USDC', amount: 20_000_000, claimed: false } : undefined,
  });
  await renderWallet();
  expect(await screen.findByText(sub)).toBeTruthy();
  expect(screen.getByText(warn)).toBeTruthy();
  expect(screen.queryByText(/USDT/)).toBeNull();
});
