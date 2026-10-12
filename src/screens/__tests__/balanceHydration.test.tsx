// A signed-in refresh paints the machine before /me and /balance land. Those start at 0. The counter, the
// header pill, the wallet line and the tray plate must not treat that 0 as an empty wallet.
import { afterEach, expect, jest, test } from '@jest/globals';
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import { AuthCtx, type Auth, type AuthStage } from '@/auth/context';
import Home from '@/screens/Home';
import { HYDRATION_VEIL_Z } from '@/screens/PullHydration';
import { SessionProvider } from '@/state/session';

const live: { setStage: ((stage: AuthStage) => void) | null } = { setStage: null };

function Host({ initial, children }: { initial: AuthStage; children: React.ReactNode }) {
  const [stage, setStage] = useState<AuthStage>(initial);
  useEffect(() => { live.setStage = setStage; }, [setStage]);
  const auth = {
    ready: true,
    stage,
    provider: 'wallet',
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
      <SessionProvider>{children}</SessionProvider>
    </AuthCtx.Provider>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  live.setStage = null;
  mock!.dev.reset();
});

test('while the wallet is still loading, nothing paints 0 pulls or a top-up', async () => {
  mock!.dev.reset();
  mock!.dev.deposit(19);
  const realMe = api.me.bind(api);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  jest.spyOn(api, 'me').mockImplementation((async () => {
    await gate;
    return realMe();
  }) as typeof api.me);

  await render(
    <SafeAreaProvider>
      <Host initial="done"><Home /></Host>
    </SafeAreaProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('pull-hydrating')).toBeTruthy());
  expect(screen.getByLabelText('Loading pulls')).toBeTruthy();
  // One layer over the app frame — header pill and the rail sit in that same frame, not under a machine-sized blur.
  const layer = screen.getByTestId('pull-hydrating');
  const box = StyleSheet.flatten(layer.props.style);
  expect(box.position).toBe('absolute');
  expect(box.top).toBe(0);
  expect(box.right).toBe(0);
  expect(box.bottom).toBe(0);
  expect(box.left).toBe(0);
  expect(box.zIndex).toBe(HYDRATION_VEIL_Z);
  const app = layer.parent;
  expect(app).not.toBeNull();
  expect(within(app!).getByLabelText('Balance loading')).toBeTruthy();
  expect(within(app!).getByLabelText('Albums page, current')).toBeTruthy();
  expect(within(layer).queryByTestId('pulls-count', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('pull-hydrating-machine')).toBeNull();
  // The counter sits under the blur, hidden from assistive tech, and it is not the digit 0.
  const count = screen.getByTestId('pulls-count', { includeHiddenElements: true });
  expect(count.props.children).toBe('…');
  expect(screen.getByLabelText('Balance loading')).toBeTruthy();
  expect(screen.getByText('Loading your balance.')).toBeTruthy();
  const hidden = { includeHiddenElements: true } as const;
  expect(screen.queryByText('$0 · 0 pulls', hidden)).toBeNull();
  expect(screen.queryByText('OUT OF PULLS', hidden)).toBeNull();
  expect(screen.queryByText('TOP UP · $1 A TURN', hidden)).toBeNull();
  expect(screen.queryByText(/LEFT/, hidden)).toBeNull();

  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByTestId('pulls-count').props.children).toBe(19));
  await waitFor(() => expect(screen.queryByTestId('pull-hydrating')).toBeNull());
  expect(screen.queryByLabelText('Loading pulls')).toBeNull();
  expect(screen.getByText('TURN THE CRANK · 19 LEFT')).toBeTruthy();
  expect(screen.getByLabelText('$19 · 19 pulls')).toBeTruthy();
  expect(screen.getByText('$19 · 19 pulls in your balance.')).toBeTruthy();
  expect(screen.queryByText('TOP UP · $1 A TURN')).toBeNull();
  expect(screen.queryByText('OUT OF PULLS')).toBeNull();
}, 20_000);

test('a real zero after the load is still an empty wallet', async () => {
  mock!.dev.reset();
  await render(
    <SafeAreaProvider>
      <Host initial="done"><Home /></Host>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getByText('TOP UP · $1 A TURN')).toBeTruthy());
  expect(screen.getByTestId('pulls-count').props.children).toBe(0);
  expect(screen.getByText('OUT OF PULLS')).toBeTruthy();
  expect(screen.getByLabelText('$0 · 0 pulls')).toBeTruthy();
}, 20_000);
