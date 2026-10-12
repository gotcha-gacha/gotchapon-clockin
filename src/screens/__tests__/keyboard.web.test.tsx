/**
 * The keyboard on the money path (W1.2, #124), end to end in a DOM: the real Pull page, the real ritual and reducer, the real
 * crank and its `autoCrank`, and the in-app mock of the API, with `preparePull` / `commitPull` / `burn` counted. Keys are real
 * `keydown` events on the page. Time is jest's: the mock answers in 120 ms and the keyboard's turn takes AUTO_TURN_MS.
 * Animation frames are batched, one fake timer per frame (@/test/batchAnimationFrames): with a timer per running animation,
 * each test here cost seconds of real time, and under load ran past jest's 15 s.
 * (The bridge's own rules, key by key, are useKeyboardBridge.web.test.tsx's.)
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { ApiError } from '@/api/errors';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AUTO_TURN_MS } from '@/components/machine/Crank';
import { DROP_MS, ROLL_FLOOR_X1_MS, stopPlan } from '@/ritual/rollTiming';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';
import { batchAnimationFrames } from '@/test/batchAnimationFrames';

jest.mock('@/audio/sfx', () => ({ playSfx: jest.fn(), crankSfx: () => 'tick', tierSfx: () => 'pop', scratchSfx: () => 'tick', dropSfx: () => 'tick', setSoundMuted: jest.fn(), setRollLoop: jest.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LATENCY = 120; // the mock's
// The commit sleeps, then the session reads holdings (another sleep), about 240ms. ×1 adds no rolling
// floor, so the first pass has to cover that answer, not a hold. The reel lock and the drop each arm
// their timers when the pass that scheduled them ends, so one long advance stops on `stopping`.
const ANSWER_MS = 280;
async function landShow() {
  await pass(Math.max(ROLL_FLOOR_X1_MS, ANSWER_MS) + 80);
  await pass(stopPlan(1).stopMs + 40);
  await pass(DROP_MS + 40);
}
let root: Root; let host: HTMLElement;
const ritual: { current: ReturnType<typeof useRitual> | null } = { current: null };
const session: { current: ReturnType<typeof useSession> | null } = { current: null };
const auth: { current: ReturnType<typeof useAuth> | null } = { current: null };
function Probes({ stopAtOnboarding }: { stopAtOnboarding?: boolean }) {
  const r = useRitual(); const s = useSession(); const a = useAuth();
  useEffect(() => { ritual.current = r; session.current = s; auth.current = a; });
  useEffect(() => { if (a.stage === 'idle') a.signIn('Apple'); else if (a.stage === 'onboarding' && !stopAtOnboarding) a.skipOnboarding(); }, [a, stopAtOnboarding]);
  return null;
}
const pass = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
const press = async (key: string, init: KeyboardEventInit = {}) => { await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); }); };
const calls = () => ({ prepare: jest.mocked(mock!.preparePull).mock.calls.length, commit: jest.mocked(mock!.commitPull).mock.calls.length, burn: jest.mocked(mock!.burn).mock.calls.length });
const phase = () => ritual.current!.ritual.phase;
const open = async (opts: { stopAtOnboarding?: boolean } = {}) => {
  await act(async () => { root.render(<SafeAreaProvider><AuthProvider><SessionProvider initialPage={PAGE.pull}><RitualProvider><Probes {...opts} /><PullPage /></RitualProvider></SessionProvider></AuthProvider></SafeAreaProvider>); });
  await pass(4000); // sign-in (0.9 s + 1.2 s), /me and the rest of the session's first reads
};

beforeEach(() => {
  jest.useFakeTimers(); batchAnimationFrames(); // one timer per frame, not one per running animation: see batchAnimationFrames.ts
  localStorage.clear(); mock!.dev.reset(); mock!.dev.creditFree(3);
  jest.spyOn(mock!, 'preparePull'); jest.spyOn(mock!, 'commitPull'); jest.spyOn(mock!, 'burn');
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); jest.restoreAllMocks(); jest.useRealTimers(); });

for (const key of [' ', 'Enter']) {
  test(`${key === ' ' ? 'space' : 'enter'} on an idle machine is one whole pull: prepare at once, the release only when the 650 ms turn is over, one commit, a capsule`, async () => {
    await open();
    expect([phase(), calls()]).toEqual(['idle', { prepare: 0, commit: 0, burn: 0 }]);
    await press(key);
    expect(calls().prepare).toBe(1); // the prepare goes out at t = 0, as it does when a hand lands on the crank
    expect(phase()).toBe('preparing');
    await pass(AUTO_TURN_MS - 60); // the quote is long back (120 ms); the knob is still turning
    expect([phase(), calls().commit]).toEqual(['armed', 0]); // never released early: the turn is a constant
    await pass(60 + 40 + LATENCY + 50);
    expect(calls()).toEqual({ prepare: 1, commit: 1, burn: 0 });
    await landShow();
    expect(phase()).toBe('capsule');
  });
}

test('the key\'s pull and a hand\'s pull ask the server for the same things in the same order', async () => {
  await open();
  await press(' '); await pass(AUTO_TURN_MS + 400); await landShow();
  const asked = () => [...jest.mocked(mock!.preparePull).mock.calls.map((c) => ['prepare', { ...(c[0] as object), idem: 'a fresh key each time', clientSeed: 'a fresh seed each time' }]), ...jest.mocked(mock!.commitPull).mock.calls.map((c) => ['commit', Object.keys(c[0] as object).sort()])];
  const byKey = asked();
  await act(async () => { ritual.current!.dispatch({ type: 'CRACKED' }); }); await pass(3000);
  await act(async () => { ritual.current!.dispatch({ type: 'INTO_BINDER' }); }); await pass(3000);
  expect(phase()).toBe('idle');
  jest.mocked(mock!.preparePull).mockClear(); jest.mocked(mock!.commitPull).mockClear();
  // what the pan gesture does: CRANK_START when the hand lands, RELEASE at 360°
  await act(async () => { ritual.current!.dispatch({ type: 'CRANK_START' }); }); await pass(300);
  await act(async () => { ritual.current!.dispatch({ type: 'RELEASE' }); }); await pass(400);
  const byHand = asked();
  expect(byKey).toEqual(byHand);
  expect(byKey.map((c) => c[0])).toEqual(['prepare', 'commit']);
});

test('no second pull from a second press inside the turn, nor from a held key: exactly one prepare and one commit', async () => {
  await open();
  await press(' ');
  await pass(200); await press(' '); // preparing → armed by now: a turn is under way
  await pass(200); await press('Enter');
  await press(' ', { repeat: true });
  await pass(AUTO_TURN_MS);
  expect(calls()).toEqual({ prepare: 1, commit: 1, burn: 0 });
  // and while it commits, shows its capsule, and after: only the capsule opens, no new pull
  await press(' '); await pass(50);
  expect(phase()).not.toBe('preparing');
  expect(calls()).toEqual({ prepare: 1, commit: 1, burn: 0 });
});

test('a held key alone starts nothing', async () => {
  await open();
  await press(' ', { repeat: true }); await press('Enter', { repeat: true });
  await pass(AUTO_TURN_MS + 300);
  expect([phase(), calls()]).toEqual(['idle', { prepare: 0, commit: 0, burn: 0 }]);
});

test('a prepare that fails inside the turn, then a second press: the first turn\'s end never releases the second pull; a later press runs its own 650 ms', async () => {
  await open();
  jest.mocked(mock!.preparePull).mockRejectedValueOnce(new ApiError({ code: 'NETWORK', message: 'down' }));
  await press(' '); // turn 1: its prepare fails almost at once, the machine is idle again, the knob is still going round
  await pass(250);
  expect([phase(), calls().prepare]).toEqual(['idle', 1]);
  await press(' '); // inside turn 1: refused by the crank, so nothing new is prepared for turn 1's end to release
  expect(calls().prepare).toBe(1);
  await pass(AUTO_TURN_MS); // turn 1 ends: its release lands on an idle machine
  expect([phase(), calls()]).toEqual(['idle', { prepare: 1, commit: 0, burn: 0 }]);
  await pass(100); // NOT long enough for the knob to come back: it still sits at turn 1's 360°. (With 800 here this test was green on a crank that released turn 2 ~100 ms in: PR #158's review.)
  await press(' '); // turn 2, its own
  expect(calls().prepare).toBe(2);
  await pass(AUTO_TURN_MS - 60);
  expect(calls().commit).toBe(0); // 590 ms into ITS turn: not released by anything earlier
  await pass(60 + 40 + LATENCY + 50);
  expect(calls()).toEqual({ prepare: 2, commit: 1, burn: 0 });
});

test('a lost commit stays on the reels: space and enter send no new pull', async () => {
  await open();
  jest.mocked(mock!.commitPull).mockRejectedValue(new ApiError({ code: 'NETWORK', message: 'lost' }));
  await press(' '); await pass(AUTO_TURN_MS + 400);
  expect(phase()).toBe('rolling');
  const prepares = calls().prepare;
  await press(' '); await press('Enter'); await pass(AUTO_TURN_MS + 400);
  expect(phase()).toBe('rolling');
  expect(calls().prepare).toBe(prepares); // a key never starts another pull, and never seals a lost answer
});

test('the capsule phase: the key opens it, once', async () => {
  await open();
  await press(' '); await pass(AUTO_TURN_MS + 400); await landShow();
  expect(phase()).toBe('capsule');
  await press(' ');
  expect(phase()).toBe('card');
  await press(' '); await press('Enter'); await pass(AUTO_TURN_MS + 400);
  expect(calls()).toEqual({ prepare: 1, commit: 1, burn: 0 }); // a card on screen: a key starts no pull behind it
});

test('arming a burn sends it without a crank, and a key during it does not start a pull', async () => {
  await open();
  await act(async () => { ritual.current!.dispatch({ type: 'BURN_STARTED' }); });
  await act(async () => { ritual.current!.dispatch({ type: 'BURN_ARMED', idem: 'burn-test-1' }); });
  expect(phase()).toBe('committing');
  await press(' '); await press('Enter');
  await pass(LATENCY + 50);
  expect(calls().burn).toBe(1);
  expect(calls().prepare).toBe(0);
});

test('no funds and no free pulls: a key sends nothing at all', async () => {
  await open();
  for (let i = 0; i < 3; i++) { // spend the free pulls credited for this file
    await press(' '); await pass(AUTO_TURN_MS + 400); await landShow();
    await act(async () => { ritual.current!.dispatch({ type: 'CRACKED' }); }); await pass(1500);
    await act(async () => { ritual.current!.dispatch({ type: 'INTO_BINDER' }); }); await pass(1500);
  }
  expect([phase(), session.current!.freePulls, session.current!.balanceUsd]).toEqual(['idle', 0, 0]);
  const before = calls();
  await press(' '); await press('Enter'); await pass(AUTO_TURN_MS + 400);
  expect([phase(), calls()]).toEqual(['idle', before]);
});

test('the album-complete takeover is up: a key sends nothing', async () => {
  await open();
  await act(async () => { ritual.current!.dispatch({ type: 'SHOW_TAKEOVER', albumId: 'little-lanterns' }); });
  expect(ritual.current!.ritual.takeover).toBe('little-lanterns');
  await press(' '); await press('Enter'); await pass(AUTO_TURN_MS + 400);
  expect(calls()).toEqual({ prepare: 0, commit: 0, burn: 0 });
});

test('off the Pull page the first press comes to Pull without cranking; the next one cranks', async () => {
  await open();
  await act(async () => { session.current!.setPage(0); });
  await press(' '); await pass(100);
  expect([session.current!.page, calls().prepare]).toEqual([1, 0]);
  await press(' ');
  expect(calls().prepare).toBe(1);
});

test('a capsule left on Pull while another page is on screen: the first press comes back to it shut; the next one opens it', async () => {
  await open();
  await press(' '); await pass(AUTO_TURN_MS + 400); await landShow();
  expect(phase()).toBe('capsule');
  await press('ArrowLeft'); // the turn is over, so the pager is free: the capsule waits on Pull while Albums is on screen
  expect(session.current!.page).toBe(0);
  await press(' '); await pass(100);
  expect([session.current!.page, phase()]).toEqual([1, 'capsule']);
  await press(' ');
  expect(phase()).toBe('card');
  expect(calls()).toEqual({ prepare: 1, commit: 1, burn: 0 });
});

test('during onboarding every key is the browser\'s', async () => {
  await open({ stopAtOnboarding: true });
  expect(auth.current!.stage).toBe('onboarding');
  await press(' '); await press('Enter'); await press('ArrowLeft'); await pass(AUTO_TURN_MS + 400);
  expect([calls(), session.current!.page]).toEqual([{ prepare: 0, commit: 0, burn: 0 }, 1]);
});
