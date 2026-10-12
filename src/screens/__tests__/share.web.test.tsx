/**
 * No image share on the web until W4.4 (plan §7.24; W3.5 #142 is where it is enforced, because the capture library it would
 * need is html2canvas, 201 KB of the entry chunk). A holo reveal on the web shows its card and its tag, and neither the Share
 * pill nor the off-stage poster it would capture. The native half is share.test.tsx: there the same reveal offers Share.
 * Its own file: it forces the tier the mock draws.
 * Animation frames are batched, one fake timer per frame (@/test/batchAnimationFrames), as in keyboard.web.test.tsx.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { DROP_MS, ROLL_FLOOR_X1_MS, stopPlan } from '@/ritual/rollTiming';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider } from '@/state/session';
import { batchAnimationFrames } from '@/test/batchAnimationFrames';

jest.mock('@/audio/sfx', () => ({ playSfx: jest.fn(), crankSfx: () => 'tick', tierSfx: () => 'pop', scratchSfx: () => 'tick', dropSfx: () => 'tick', setSoundMuted: jest.fn(), setRollLoop: jest.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
const ritual: { current: ReturnType<typeof useRitual> | null } = { current: null };
function Probes() {
  const r = useRitual(); const a = useAuth();
  useEffect(() => { ritual.current = r; });
  useEffect(() => { if (a.stage === 'idle') a.signIn('Apple'); else if (a.stage === 'onboarding') a.skipOnboarding(); }, [a]);
  return null;
}
const pass = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
// See keyboard.web.test.tsx: ×1 adds no rolling floor, so this pass covers the mock's answer, then the short lock and the drop.
const ANSWER_MS = 280;
async function landShow() {
  await pass(Math.max(ROLL_FLOOR_X1_MS, ANSWER_MS) + 80);
  await pass(stopPlan(1).stopMs + 40);
  await pass(DROP_MS + 40);
}
const phase = () => ritual.current!.ritual.phase;
const count = (text: string) => (host.textContent ?? '').split(text).length - 1;

beforeEach(() => {
  jest.useFakeTimers(); batchAnimationFrames(); // one timer per frame, not one per running animation: see batchAnimationFrames.ts
  localStorage.clear(); mock!.dev.reset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); jest.restoreAllMocks(); jest.useRealTimers(); });

test('a holo reveal on the web shows its card and offers no Share, and no poster is drawn off stage', async () => {
  mock!.dev.forceTier('holo');
  mock!.dev.creditFree(1); // a new session has no starter pulls; paid odds so the forced holo can land
  await act(async () => { root.render(<SafeAreaProvider><AuthProvider><SessionProvider initialPage={PAGE.pull}><RitualProvider><Probes /><PullPage /></RitualProvider></SessionProvider></AuthProvider></SafeAreaProvider>); });
  await pass(4000); // sign-in, /me and the session's first reads
  await act(async () => { ritual.current!.dispatch({ type: 'CRANK_START' }); }); await pass(400);
  expect(phase()).toBe('armed');
  await act(async () => { ritual.current!.dispatch({ type: 'RELEASE' }); }); await landShow();
  expect(phase()).toBe('capsule');
  await act(async () => { ritual.current!.dispatch({ type: 'CRACKED' }); }); await pass(1500);
  expect(phase()).toBe('card');
  // The state where Share would be offered on a phone: a holo card on stage, its tag drawn once (the stage's; a poster would
  // be a second).
  expect(count('HOLO RARE')).toBe(1);
  expect(host.querySelector('[aria-label="Share"]')).toBeNull();
});
