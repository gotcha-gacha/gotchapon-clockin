/**
 * When the Pull page starts CanvasKit on the web (W3.5, #142): not at mount, so the machine is up first; when the browser is
 * idle (at most IDLE_START_MS after the page mounts); or when the first turn starts, if that is sooner, because the capsule is
 * then only a commit away and a CanvasKit that is not ready by the capsule means the tap capsule. The loader itself (one fetch,
 * the wasm check, the cancel) is capsule.web.test.tsx's.
 * Animation frames are batched, one fake timer per frame (@/test/batchAnimationFrames), as in keyboard.web.test.tsx.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import * as skiaWeb from '@/components/reveal/skiaWeb';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider } from '@/state/session';
import { batchAnimationFrames } from '@/test/batchAnimationFrames';

jest.mock('@/audio/sfx', () => ({ playSfx: jest.fn(), crankSfx: () => 'tick', tierSfx: () => 'pop', scratchSfx: () => 'tick', dropSfx: () => 'tick', setSoundMuted: jest.fn(), setRollLoop: jest.fn() }));
jest.mock('@shopify/react-native-skia/lib/module/web', () => ({ LoadSkiaWeb: async () => {} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader = skiaWeb as typeof skiaWeb & { resetSkiaWebForTests: () => void; IDLE_START_MS: number };
const G = globalThis as unknown as { fetch?: unknown; requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;
let fetched: jest.Mock;
const wasmFetches = () => fetched.mock.calls.filter((c) => c[0] === '/canvaskit.wasm').length;

let root: Root; let host: HTMLElement;
const ritual: { current: ReturnType<typeof useRitual> | null } = { current: null };
function Probes() {
  const r = useRitual(); const a = useAuth();
  useEffect(() => { ritual.current = r; });
  useEffect(() => { if (a.stage === 'idle') a.signIn('Apple'); else if (a.stage === 'onboarding') a.skipOnboarding(); }, [a]);
  return null;
}
const pass = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
const open = () => act(async () => { root.render(<SafeAreaProvider><AuthProvider><SessionProvider initialPage={PAGE.pull}><RitualProvider><Probes /><PullPage /></RitualProvider></SessionProvider></AuthProvider></SafeAreaProvider>); });

beforeEach(() => {
  jest.useFakeTimers(); batchAnimationFrames(); // one timer per frame, not one per running animation: see batchAnimationFrames.ts
  localStorage.clear(); mock!.dev.reset(); loader.resetSkiaWebForTests();
  fetched = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => WASM })); G.fetch = fetched;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove();
  delete G.fetch; delete G.requestIdleCallback; delete G.cancelIdleCallback;
  jest.restoreAllMocks(); jest.useRealTimers();
});

test('the first turn starts CanvasKit when the browser has not been idle yet; before it, nothing is fetched', async () => {
  G.requestIdleCallback = jest.fn(() => 1); // a browser that stays busy: the idle start never comes
  G.cancelIdleCallback = jest.fn();
  await open();
  await pass(4000); // signed in, the machine up and idle
  expect(ritual.current!.ritual.phase).toBe('idle');
  expect(wasmFetches()).toBe(0);
  await act(async () => { ritual.current!.dispatch({ type: 'CRANK_START' }); });
  await pass(50);
  expect(wasmFetches()).toBe(1);
});

test('with no turn it starts when the browser is idle, and not at mount (no requestIdleCallback: IDLE_START_MS after mount)', async () => {
  expect(G.requestIdleCallback).toBeUndefined(); // jsdom has none, as Safari
  await open();
  await pass(loader.IDLE_START_MS - 1);
  expect(wasmFetches()).toBe(0);
  await pass(1);
  expect(wasmFetches()).toBe(1);
  expect(ritual.current!.ritual.phase).toBe('idle'); // no turn was needed
});
