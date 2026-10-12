// Privy's half of sign-in (F7.4, #6), mounted directly: `AuthProvider` only reaches it when the ids are set, and which of
// the two it picks is `authProvider.test.tsx`'s subject.
//
// Most of this is PR #114's, kept because every case in it was a bug first — the blank frame that no test could reach, the
// busy state that skipped its first step when Privy answered quickly, the cancel that left a live session behind.
import { beforeEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { api, currentAccessTokenProvider, mock } from '@/api';
import { pendingEvents, resetAnalyticsForTests } from '@/analytics';
import { useAuth } from '@/auth/context';
import { PrivyAuthProvider } from '@/auth/privyAuth';
import { transactionBytesFromBase64, transactionBytesToBase64 } from '@/auth/solanaTransactionBytes';

type PrivyJest = {
  login: jest.Mock; sendCode: jest.Mock; loginWithCode: jest.Mock; logout: jest.Mock;
  create: jest.Mock; getAccessToken: jest.Mock; refreshUser: jest.Mock; providerRequest: jest.Mock;
  WALLET: string;
  state: { isReady: boolean; user: unknown };
  wallets: { address: string }[];
  user: (k: 'google_oauth' | 'apple_oauth' | 'email', w?: string | null) => unknown;
  reset: () => void;
};
const privy = () => (globalThis as unknown as { __gachaponPrivy: PrivyJest }).__gachaponPrivy;
/** A mock reached through a global carries no signature, so its rejected value types as `never`: said once, here. */
const failOnce = (m: jest.Mock, error: unknown) => (m as unknown as { mockRejectedValueOnce: (e: unknown) => void }).mockRejectedValueOnce(error);

const live: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
const steps: string[] = [];
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    live.auth = auth;
    // Sampled from a committed render, so a step the user never actually saw cannot satisfy the test.
    if (auth.stage === 'busy' && steps[steps.length - 1] !== auth.step) steps.push(auth.step);
  });
  return null;
}
const mountBare = () => render(<PrivyAuthProvider><Probe /></PrivyAuthProvider>);
const mount = async () => { await mountBare(); await waitFor(() => expect(live.auth?.ready).toBe(true)); };
const tick = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });

beforeEach(() => { privy().reset(); mock!.dev.reset(); resetAnalyticsForTests(); live.auth = null; steps.length = 0; });

test('Google signs in through Privy OAuth, lands the Solana wallet, and hands the HTTP client its token', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().login).toHaveBeenCalledWith({ provider: 'google' });
  expect([live.auth!.provider, live.auth!.wallet, live.auth!.stage]).toEqual(['Google', privy().WALLET, 'onboarding']);
  await expect(currentAccessTokenProvider()()).resolves.toBe('test-token');
});

test('email is two steps: a code is asked for, then signed in with', async () => {
  await mount();
  await act(async () => { expect(await live.auth!.sendEmailCode('a@b.com')).toBe(true); });
  expect(privy().sendCode).toHaveBeenCalledWith({ email: 'a@b.com' });
  expect(privy().loginWithCode).not.toHaveBeenCalled(); // nobody is signed in by asking
  await act(async () => { await live.auth!.signIn('email', { email: 'a@b.com', code: '123456' }); });
  expect(privy().loginWithCode).toHaveBeenCalledWith({ email: 'a@b.com', code: '123456' });
  expect(live.auth!.stage).toBe('onboarding');
});

test('native signs the server-built v0 transaction with the embedded funds wallet', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('email', { email: 'a@b.com', code: '123456' }); });
  const message = new TransactionMessage({
    payerKey: new PublicKey('11111111111111111111111111111111'),
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [],
  }).compileToV0Message();
  const unsigned = new VersionedTransaction(message);
  const input = transactionBytesToBase64(unsigned.serialize());

  const output = await live.auth!.signSolanaTransaction!(input);
  const signed = VersionedTransaction.deserialize(transactionBytesFromBase64(output));

  expect(privy().providerRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'signTransaction' }));
  expect(Array.from(signed.signatures[0])).toEqual(new Array(64).fill(7));
});

test('an address that is not one is refused before Privy is asked anything', async () => {
  await mount();
  await act(async () => { expect(await live.auth!.sendEmailCode('not-an-email')).toBe(false); });
  expect(privy().sendCode).not.toHaveBeenCalled();
  expect(live.auth!.error).not.toBeNull();
});

test('Apple goes through the same OAuth call as Google, and the SDK picks the native sheet itself', async () => {
  // There is no Apple branch in the provider on purpose: `useLoginWithOAuth` calls `expo-apple-authentication`'s
  // `signInAsync` when the platform is iOS and the provider is apple, and runs the browser flow everywhere else. What this
  // pins is that the app asks for `apple` — the rest is the SDK's, and a missing package is its `configuration_error`.
  await mount();
  expect(live.auth!.appleReady).toBe(true);
  await act(async () => { await live.auth!.signIn('Apple'); });
  expect(privy().login).toHaveBeenCalledWith({ provider: 'apple' });
  expect([live.auth!.provider, live.auth!.wallet, live.auth!.stage]).toEqual(['Apple', privy().WALLET, 'onboarding']);
});

test('on Android Privy does not offer Apple: its browser flow there carries the bundle id, which Apple refuses (11 Oct 2026)', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android'); // the native jest project runs as iOS
  try {
    await mount();
    expect(live.auth!.appleReady).toBe(false);
  } finally { os.restore(); }
});

test('a missing expo-apple-authentication is a sign-in error, not a crash', async () => {
  // What the SDK throws when the package is not in the build: `configuration_error`, with a message naming it. It must
  // reach the sheet as an ordinary refusal, because an iOS build that forgot the package still has the button.
  await mount();
  failOnce(privy().login, Object.assign(new Error('`expo-apple-authentication` is not installed.'), { code: 'configuration_error' }));
  await act(async () => { await live.auth!.signIn('Apple'); });
  expect([live.auth!.stage, live.auth!.error !== null]).toEqual(['idle', true]);
});

test('the busy state is two steps, 0.9 s then 1.2 s, even when Privy answers instantly', async () => {
  jest.useFakeTimers();
  try {
    await mountBare();
    void live.auth!.signIn('Google');
    await tick(1);
    expect([live.auth!.stage, steps]).toEqual(['busy', ['Signing in with Google…']]);
    await tick(880);
    expect(steps).toEqual(['Signing in with Google…']); // still step 1 just before 0.9 s
    await tick(30);
    expect(steps).toEqual(['Signing in with Google…', 'Creating your Solana wallet…']);
    await tick(1150);
    expect(live.auth!.stage).toBe('busy'); // the 2.1 s floor is real, however fast Privy was
    await tick(100);
    await waitFor(() => expect(live.auth!.stage).toBe('onboarding'));
  } finally { jest.useRealTimers(); }
});

test('a cancelled sign-in leaves no error card and no session', async () => {
  await mount();
  failOnce(privy().login, Object.assign(new Error('nope'), { code: 'login_with_oauth_was_cancelled_by_user' }));
  await act(async () => { await live.auth!.signIn('Google'); });
  expect([live.auth!.stage, live.auth!.provider, live.auth!.error]).toEqual(['idle', null, null]);
});

test('a failure AFTER Privy authenticated ends the session rather than stranding it', async () => {
  await mount();
  jest.spyOn(api, 'me').mockRejectedValueOnce(new Error('network is down'));
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(live.auth!.stage).toBe('idle');
  expect(live.auth!.error).not.toBeNull();
  expect(privy().logout).toHaveBeenCalled(); // or the restore effect would skip this user id forever
});

// --- the cold-start restore, and the blank frame it gates ---

test('a restored session lands straight in the app, without showing the first screen', async () => {
  privy().state.user = privy().user('google_oauth'); // signed in on a previous launch
  await mountBare();
  expect(live.auth!.ready).toBe(false); // the frame is blank while the restore is in flight: that is what `ready` is for
  await waitFor(() => expect(live.auth!.ready).toBe(true));
  expect([live.auth!.wallet, live.auth!.provider, live.auth!.stage, live.auth!.error]).toEqual([privy().WALLET, 'Google', 'onboarding', null]);
});

test('a restore whose /me fails ends on the first screen with an error, never on the blank frame', async () => {
  privy().state.user = privy().user('google_oauth');
  jest.spyOn(api, 'me').mockRejectedValueOnce(new Error('network is down'));
  await mountBare();
  await waitFor(() => expect(live.auth!.ready).toBe(true));
  expect(live.auth!.stage).toBe('idle');
  expect(live.auth!.error).not.toBeNull();
  expect(privy().logout).toHaveBeenCalled();
});

test('a restore that fails while logout ALSO fails still reaches the first screen', async () => {
  // The dangerous pair. With either half alone the app recovers by luck: a successful logout clears Privy's user, which
  // un-blanks `ready` on its own. Only when the session survives the failure does the `hydrated` latch carry the app off
  // the blank frame.
  privy().state.user = privy().user('google_oauth');
  jest.spyOn(api, 'me').mockRejectedValueOnce(new Error('network is down'));
  privy().logout.mockImplementation(async () => { throw new Error('revoke failed'); });
  await mountBare();
  await waitFor(() => expect(live.auth!.ready).toBe(true));
  expect([live.auth!.stage, live.auth!.error !== null]).toEqual(['idle', true]);
});

test('a restore that never settles is released by the wall-clock cap', async () => {
  jest.useFakeTimers();
  try {
    privy().state.user = privy().user('email', null); // no wallet on the user…
    privy().wallets.splice(0, 1);                     // …and none on the hook
    privy().create.mockImplementation(() => new Promise(() => {})); // create() never answers
    await mountBare();
    expect(live.auth!.ready).toBe(false);
    await tick(7999);
    expect(live.auth!.ready).toBe(false);
    await tick(2);
    expect([live.auth!.ready, live.auth!.stage]).toEqual([true, 'idle']);
  } finally { jest.useRealTimers(); }
});

test('signing out clears the session and leaves no unhandled rejection when logout fails', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  failOnce(privy().logout, new Error('revoke failed'));
  await act(async () => { live.auth!.signOut(); });
  expect([live.auth!.stage, live.auth!.wallet, live.auth!.provider]).toEqual(['idle', null, null]);
});

// --- what the SDK's per-render churn does to an effect, and what a wallet event is about ---

test('a failed restore settles once: a later render does not start it again', async () => {
  // The loop this pins: `usePrivy` builds `refreshUser` fresh on every render, so a callback that depended on it — and the
  // restore effect that depended on THAT — re-ran on every render. The failure handler writes state, which renders, which
  // restores again. Offline, with `logout()` failing too so Privy's user never clears, it never stops: 53,000 `/me` calls
  // in 15 seconds, measured. The jest mock's `refreshUser` is a fresh arrow now, so this test can see it.
  // `spyOn` on an already-spied method hands back the SAME spy, and earlier tests in this file leave theirs installed, so
  // its call log carries their calls too. Cleared, or this counts the whole file and passes for the wrong reason.
  const me = jest.spyOn(api, 'me').mockRejectedValue(new Error('offline'));
  me.mockClear();
  try {
    privy().logout.mockImplementation(async () => { throw new Error('offline too'); });
    privy().state.user = privy().user('google_oauth');
    await mountBare();
    await waitFor(() => expect(live.auth!.ready).toBe(true));
    const atSettle = me.mock.calls.length;
    // Any later render at all. The email guard is a convenient one: it writes provider state without touching sign-in.
    for (let i = 0; i < 5; i++) await act(async () => { await live.auth!.sendEmailCode('not-an-email'); });
    expect([atSettle, me.mock.calls.length]).toEqual([1, 1]);
    expect(privy().logout.mock.calls.length).toBe(1);
  } finally { me.mockRestore(); }
});

test('wallet_created is about creating a wallet: a cold start with one already there does not fire it', async () => {
  privy().state.user = privy().user('google_oauth'); // a wallet from a previous launch
  await mountBare();
  await waitFor(() => expect(live.auth!.ready).toBe(true));
  expect(live.auth!.wallet).toBe(privy().WALLET);
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(0);
});

test('wallet_created fires when there was none and Privy makes one', async () => {
  privy().state.user = null;
  privy().wallets.splice(0, privy().wallets.length); // nothing on the hook either
  privy().login.mockImplementation(async () => {
    privy().state.user = privy().user('google_oauth', null); // signed in, no wallet yet
    return privy().state.user;
  });
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().create).toHaveBeenCalled();
  expect(live.auth!.wallet).toBe(privy().WALLET);
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(1);
});

test('a login that authenticates and THEN throws leaves no session behind', async () => {
  // The provider asks Privy for a Solana wallet at login, so Privy can sign the user in and then fail creating it. The
  // promise rejects with nothing in this code having seen a success — while Privy's own store already holds the user. That
  // stranded it: the restore effect had pinned `landedId` to that id, so it skipped the live session forever (review).
  await mount();
  privy().login.mockImplementation(async () => {
    privy().state.user = privy().user('google_oauth');
    throw new Error('embedded_wallet_creation_error');
  });
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().logout).toHaveBeenCalled();
  expect([live.auth!.stage, live.auth!.error !== null]).toEqual(['idle', true]);
});

test('Privy taking its time to start does not blank the app for the full network cap', async () => {
  // A first-ever launch has no session to restore, but nobody knows that until `isReady`. It used to wait the whole 8 s
  // network cap to find out; the app is drawable after the shorter start-up cap, and `ready` never goes back down (review).
  jest.useFakeTimers();
  try {
    privy().state.isReady = false;
    privy().state.user = null;
    await mountBare();
    expect(live.auth!.ready).toBe(false);
    await tick(2499);
    expect(live.auth!.ready).toBe(false);
    await tick(2);
    expect(live.auth!.ready).toBe(true);
    // And when Privy finally answers with a session, `ready` stays up rather than flicking back to a blank frame.
    await act(async () => { privy().state.isReady = true; privy().state.user = privy().user('google_oauth'); });
    expect(live.auth!.ready).toBe(true);
  } finally { jest.useRealTimers(); }
});
