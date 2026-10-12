// Which sign-in a browser runs (W5.1). No app id → the mock, and the Privy chunk is never asked for. An app id → the
// chunk. The optional web client id and the mobile client id do not decide whether Privy is enabled.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mock } from '@/api';
import { AuthProvider, useAuth, type Auth } from '@/auth/AuthProvider';
import '@privy-io/react-auth';

type Mod = { PrivyWebRoot: React.ComponentType<{ children: React.ReactNode }> };
type LoadGlobal = { __gachaponLoadPrivy?: () => Promise<Mod>; __gachaponLoadPrivyCalls?: number };
const loads = () => globalThis as unknown as LoadGlobal;
type PrivyJest = { initOAuth: jest.Mock; reset: () => void };
const privy = () => (globalThis as unknown as { __gachaponPrivy: PrivyJest }).__gachaponPrivy;

jest.mock('@/auth/loadPrivyWeb', () => ({
  loadPrivyWebChunk: () => {
    const g = globalThis as unknown as LoadGlobal;
    g.__gachaponLoadPrivyCalls = (g.__gachaponLoadPrivyCalls ?? 0) + 1;
    return g.__gachaponLoadPrivy!();
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const live: { auth: Auth | null } = { auth: null };
function Probe() { const auth = useAuth(); useEffect(() => { live.auth = auth; }); return null; }
let root: Root | null = null;
let host: HTMLElement | null = null;
const mountBare = async () => {
  live.auth = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<AuthProvider><Probe /></AuthProvider>); });
};
// See privyAuth.web.test.tsx. The real timer is captured here, before a test calls `useFakeTimers`.
const realSetTimeout = setTimeout;
const waitUntil = async (pred: () => boolean) => {
  for (let i = 0; i < 80; i++) {
    if (pred()) return;
    if (setTimeout !== realSetTimeout) {
      await act(async () => {
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        await Promise.resolve();
      });
    } else {
      await act(async () => { await new Promise((r) => realSetTimeout(r, 40)); });
    }
  }
  throw new Error(`timed out; ready=${live.auth?.ready} stage=${live.auth?.stage}`);
};
const tick = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });
const withApp = () => { process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'test-app'; };

beforeEach(() => {
  mock!.dev.reset();
  privy().reset();
  delete process.env.EXPO_PUBLIC_PRIVY_APP_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB;
  loads().__gachaponLoadPrivyCalls = 0;
  loads().__gachaponLoadPrivy = () => new Promise(() => {});
});
afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  host?.remove(); host = null;
  delete process.env.EXPO_PUBLIC_PRIVY_APP_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB;
  jest.useRealTimers();
});

test('with no ids: the mock signs in, and the Privy chunk is never loaded', async () => {
  jest.useFakeTimers();
  try {
    await mountBare();
    expect(live.auth!.appleReady).toBe(true);
    expect(loads().__gachaponLoadPrivyCalls).toBe(0);
    await act(async () => { void live.auth!.signIn('Apple'); });
    await tick(2200);
    await waitUntil(() => live.auth!.stage === 'onboarding');
    expect(live.auth!.provider).toBe('Apple');
    expect(privy().initOAuth).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('client ids without an app id use the mock', async () => {
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID = 'test-mobile-client';
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB = 'test-web-client';
  jest.useFakeTimers();
  try {
    await mountBare();
    expect(loads().__gachaponLoadPrivyCalls).toBe(0);
    await act(async () => { void live.auth!.signIn('Google'); });
    await tick(2200);
    await waitUntil(() => live.auth!.stage === 'onboarding');
    expect(privy().initOAuth).not.toHaveBeenCalled();
    expect(live.auth!.stage).toBe('onboarding');
  } finally { jest.useRealTimers(); }
});

test('with an app id: the chunk is loaded and Privy signs in', async () => {
  withApp();
  // Held open so the blank frame is observable. `act` would otherwise flush the import before the assertion.
  let resolveChunk: (m: Mod) => void = () => {};
  loads().__gachaponLoadPrivy = () => new Promise((r) => { resolveChunk = r; });
  await mountBare();
  expect(live.auth!.ready).toBe(false);
  expect(loads().__gachaponLoadPrivyCalls).toBe(1);
  const mod = await import('@/auth/privyWebChunk');
  await act(async () => { resolveChunk(mod); });
  await waitUntil(() => live.auth?.ready === true);
  expect(live.auth!.appleReady).toBe(true);
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().initOAuth).toHaveBeenCalledWith({ provider: 'google' });
  expect(live.auth!.stage).toBe('onboarding');
});

test('a chunk that never arrives stops blanking the app, and one that arrives later still takes over', async () => {
  withApp();
  let resolveChunk: (m: Mod) => void = () => {};
  loads().__gachaponLoadPrivy = () => new Promise((r) => { resolveChunk = r; });
  jest.useFakeTimers();
  try {
    await mountBare();
    expect(live.auth!.ready).toBe(false);
    await tick(7999);
    expect(live.auth!.ready).toBe(false);
    await tick(2);
    expect(live.auth!.ready).toBe(true);
    expect(live.auth!.error?.message).toBe('Sign-in could not load. Reload the page.');
    jest.useRealTimers();
    const mod = await import('@/auth/privyWebChunk');
    await act(async () => { resolveChunk(mod); });
    await waitUntil(() => live.auth?.error === null && live.auth?.ready === true);
    await act(async () => { await live.auth!.signIn('Google'); });
    expect(privy().initOAuth).toHaveBeenCalledWith({ provider: 'google' });
  } finally { jest.useRealTimers(); }
});
