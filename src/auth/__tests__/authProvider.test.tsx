// Which sign-in the app runs (F7.4, #6). The ids decide: a build with none of them never loads Privy, which is every demo
// deploy, every TestFlight build and both jest projects; a build with them signs in for real.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { mock } from '@/api';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';

type PrivyJest = { login: jest.Mock; reset: () => void };
const privy = () => (globalThis as unknown as { __gachaponPrivy: PrivyJest }).__gachaponPrivy;

const live: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
function Probe() { const auth = useAuth(); useEffect(() => { live.auth = auth; }); return null; }
const mount = async () => { live.auth = null; await render(<AuthProvider><Probe /></AuthProvider>); await waitFor(() => expect(live.auth?.ready).toBe(true)); };
// The same `process.env` object, mutated: the preset's env plugin reads through a reference it took at load.
const withIds = () => { process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'test-app'; process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID = 'test-client'; };

beforeEach(() => { mock!.dev.reset(); delete process.env.EXPO_PUBLIC_PRIVY_APP_ID; delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID; });
afterEach(() => { delete process.env.EXPO_PUBLIC_PRIVY_APP_ID; delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID; jest.restoreAllMocks(); });

test('with no ids: the mock signs in, Privy is never called, and Apple works', async () => {
  jest.useFakeTimers();
  try {
    await mount();
    expect(live.auth!.appleReady).toBe(true);
    void live.auth!.signIn('Apple');
    await act(async () => { jest.advanceTimersByTime(2200); });
    await waitFor(() => expect(live.auth!.stage).toBe('onboarding'));
    expect(live.auth!.provider).toBe('Apple');
    expect(privy().login).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('with ids: Privy signs in, and Apple is offered too', async () => {
  withIds();
  await mount();
  expect(live.auth!.appleReady).toBe(true); // native Privy offers Apple; the web file is authProvider.web.test.tsx
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().login).toHaveBeenCalledWith({ provider: 'google' });
  expect(live.auth!.stage).toBe('onboarding');
});

test('one id without the other is not configured: half a Privy app cannot sign anyone in', async () => {
  process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'test-app'; // and no client id
  jest.useFakeTimers();
  try {
    await mount();
    expect(live.auth!.appleReady).toBe(true); // the mock: Privy was not mounted
    void live.auth!.signIn('Google');
    await act(async () => { jest.advanceTimersByTime(2200); });
    expect(privy().login).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
