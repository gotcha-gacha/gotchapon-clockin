// The session loads on mount, as a child of the auth provider. Privy installs the access-token getter in an effect,
// which runs after this load has already started, so on a real API that first load is a 401. Wallet sign-in (and
// email) never reloads the page, and the Albums card was that 401: "Signed out", header still $0 · 0 pulls.
import { afterEach, expect, jest, test } from '@jest/globals';
import React, { useEffect, useState } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { api } from '@/api';
import { ApiError } from '@/api/errors';
import { AuthCtx, type Auth, type AuthStage } from '@/auth/context';
import { SessionProvider, useSession } from '@/state/session';

const live: { session: ReturnType<typeof useSession> | null; setStage: ((stage: AuthStage) => void) | null } = {
  session: null,
  setStage: null,
};

function Probe() {
  const session = useSession();
  useEffect(() => { live.session = session; }, [session]);
  return null;
}

function Host({ initial }: { initial: AuthStage }) {
  const [stage, setStage] = useState<AuthStage>(initial);
  useEffect(() => { live.setStage = setStage; }, [setStage]);
  const auth = {
    ready: true,
    stage,
    provider: stage === 'idle' ? null : 'wallet',
    step: '',
    wallet: null,
    onboardingIndex: 0,
    error: null,
    appleReady: true,
    signIn: async () => {},
    sendEmailCode: async () => false,
    signSolanaTransaction: null,
    depositFromConnectedWallet: null,
    signOut: () => {},
    nextSheet: () => {},
    skipOnboarding: () => {},
  } satisfies Auth;
  return (
    <AuthCtx.Provider value={auth}>
      <SessionProvider><Probe /></SessionProvider>
    </AuthCtx.Provider>
  );
}

const signedOut = () => new ApiError({ code: 'UNAUTHENTICATED', message: 'Sign in required' }, 401);

afterEach(() => {
  jest.restoreAllMocks();
  live.session = null;
  live.setStage = null;
});

test('a 401 from before sign-in is not the Albums card, and sign-in loads the session', async () => {
  const me = jest.spyOn(api, 'me');
  me.mockRejectedValueOnce(signedOut());
  await render(<Host initial="idle" />);
  await waitFor(() => expect(live.session?.ready).toBe(true));
  expect(live.session?.error).toBeNull();
  expect(live.session?.me).toBeNull();
  expect(live.session?.balanceKnown).toBe(false);
  expect(live.session?.balanceUsd).toBe(0);
  await act(async () => { live.setStage!('onboarding'); });
  await waitFor(() => expect(live.session?.me?.id).toBeTruthy());
  expect(live.session?.balanceKnown).toBe(true);
  expect(live.session?.error).toBeNull();
  expect(live.session?.albums.length).toBeGreaterThan(0);
  expect(me.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('a session that already loaded is not fetched again when sign-in finishes', async () => {
  const me = jest.spyOn(api, 'me');
  await render(<Host initial="idle" />);
  await waitFor(() => expect(live.session?.me?.id).toBeTruthy());
  const calls = me.mock.calls.length;
  await act(async () => { live.setStage!('done'); });
  await act(async () => { await Promise.resolve(); });
  expect(me.mock.calls.length).toBe(calls);
  expect(live.session?.balanceKnown).toBe(true);
  expect(live.session?.error).toBeNull();
});

test('a 401 once the app is open stays the signed-out card', async () => {
  jest.spyOn(api, 'me').mockRejectedValue(signedOut());
  await render(<Host initial="done" />);
  await waitFor(() => expect(live.session?.error?.code).toBe('UNAUTHENTICATED'));
  expect(live.session?.me).toBeNull();
  expect(live.session?.balanceKnown).toBe(false);
});

test('a pre-auth failure that lands after sign-in cannot replace the session', async () => {
  const realMe = api.me.bind(api);
  let failFirst!: (error: unknown) => void;
  const first = new Promise<never>((_, reject) => { failFirst = reject; });
  let calls = 0;
  jest.spyOn(api, 'me').mockImplementation((() => {
    calls += 1;
    if (calls === 1) return first;
    return realMe();
  }) as typeof api.me);
  await render(<Host initial="idle" />);
  await act(async () => { live.setStage!('done'); });
  await waitFor(() => expect(live.session?.me?.id).toBeTruthy());
  await act(async () => {
    failFirst(new ApiError({ code: 'NETWORK', message: 'offline' }));
    await Promise.resolve();
  });
  expect(live.session?.error).toBeNull();
  expect(live.session?.me?.id).toBeTruthy();
});
