// The first screen (#211): what it offers before anyone has signed in, and the arming beat that hands over to Privy.
//
// The beat is the part with a clock in it, so it is driven on fake timers: the press arms, the label changes, a second press
// does nothing, and only when the 780 ms are up does the sheet arrive. The sheet's own contents are the old sign-in wall's and
// are covered where they always were (`home.test.tsx`, `a11y.web.test.tsx`).
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { playSfx } from '@/audio/sfx';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { armGeometry, FirstScreen, IDLE_MS, tiltIn } from '@/screens/FirstScreen';
import { ARM_MS, CAPSULE } from '@/screens/firstScreen/HeroCapsule';
import { DEFAULT_SETTINGS, writeSettings } from '@/state/settings';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));
// The hero's endless motion (glow, sway, sheen, rings: `withRepeat(…, -1)`) plays each loop once here. Nothing below
// asserts on it, and on fake timers every advanced millisecond drove all of it frame by frame: the test that passes 24 s of
// clock rendered ~1,500 frames and ran past its timeout whenever the machine was loaded (load average 100+, 27 Sept). The
// hint, the beat and the rattle are `setTimeout` and `Date.now`, on jest's clock either way.
// It also flattens the idle nudge's finite glow (`withRepeat(…, 4, true)`) to one half-cycle: a test of that glow needs
// the real `withRepeat`.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, withRepeat: (animation: unknown) => animation };
});

const live: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
function Probe() { const auth = useAuth(); useEffect(() => { live.auth = auth; }); return null; }
const open = () => render(<SafeAreaProvider><AuthProvider><Probe /><FirstScreen /></AuthProvider></SafeAreaProvider>);
const pass = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const sounds = () => jest.mocked(playSfx).mock.calls.map((c) => c[0]);

beforeEach(() => { jest.useFakeTimers(); writeSettings({ ...DEFAULT_SETTINGS }); live.auth = null; jest.mocked(playSfx).mockClear(); });
afterEach(() => { jest.useRealTimers(); });

test('the hero stands on its own: one call to action, and Privy nowhere until it is asked for', async () => {
  await open();
  expect(screen.getByLabelText('Gotchapon')).toBeTruthy();
  expect(screen.getByText('REAL CARDS · $1 A PULL')).toBeTruthy();
  expect(screen.getByText(/gotchapon\.fun/)).toBeTruthy();
  expect(screen.getByTestId('splash-lockup')).toBeTruthy();
  expect(screen.getByTestId('brand-mark-compact', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('Pull your first card')).toBeTruthy();
  expect(screen.getByText('Already collecting? Sign in')).toBeTruthy();
  expect(screen.getByTestId('hero-mark')).toBeTruthy();
  expect(screen.getByTestId('hero-g-mark', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('hero-sheen', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId('hero-ghost')).toBeNull();
  expect(screen.queryByTestId('auth-sheet')).toBeNull();
  expect(screen.queryByText('Continue with Apple')).toBeNull();
});

test('the CTA arms for 780 ms — the label says so, a second press does nothing — and the sheet rises at the end of it', async () => {
  await open();
  await fireEvent.press(screen.getByText('Pull your first card'));
  expect(screen.getByText('Loading a capsule…')).toBeTruthy();
  expect(screen.queryByTestId('auth-sheet')).toBeNull();
  await fireEvent.press(screen.getByText('Loading a capsule…')); // a second press mid-beat is not a second beat
  await pass(ARM_MS - 1);
  expect(screen.queryByTestId('auth-sheet')).toBeNull();
  await pass(1);
  expect(screen.getByTestId('auth-sheet')).toBeTruthy();
  expect(screen.getByText('Continue with Apple')).toBeTruthy();
  expect(sounds()).toEqual(['click', 'pop']); // the press, then the capsule landing in the mouth
});

test('"Already collecting?" is the quiet way in: the sheet at once, no beat, and the ✕ goes back to the hero', async () => {
  await open();
  await fireEvent.press(screen.getByText('Already collecting? Sign in'));
  expect(screen.getByTestId('auth-sheet')).toBeTruthy();
  expect(sounds()).toEqual(['click']);
  await fireEvent.press(screen.getByLabelText('Close'));
  expect(screen.queryByTestId('auth-sheet')).toBeNull();
  expect(screen.getByText('Pull your first card')).toBeTruthy();
});

test('while Privy is answering the sheet has no way out, and it opens itself for a sign-in that began elsewhere', async () => {
  await open();
  expect(screen.queryByTestId('auth-sheet')).toBeNull();
  await act(async () => { live.auth!.signIn('Apple'); }); // not from the sheet's own buttons
  expect(screen.getByTestId('auth-sheet')).toBeTruthy();
  expect(screen.queryByLabelText('Close')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Close sign in')); // the backdrop
  expect(screen.getByTestId('auth-sheet')).toBeTruthy();
  expect(screen.getByText(/Signing in with Apple/)).toBeTruthy();
});

// --- slice C: what the screen does while nobody has pressed anything yet ---

// The yellow hint ("Something's in there. Pull it ↓" / "Tap the capsule") sat on the headline.
// Ben: it is redundant with the headline and the CTA, so it is gone — the rattle and the idle
// nudge (rings, CTA glow) stay, the line does not.
const hintGone = () => {
  expect(screen.queryByTestId('capsule-hint')).toBeNull();
  expect(screen.queryByText(/Something's in there/)).toBeNull();
  expect(screen.queryByText('Tap the capsule')).toBeNull();
};

test('tapping the capsule rattles it and never lays a hint over the headline', async () => {
  await open();
  hintGone();
  const capsule = screen.getByLabelText('Gotchapon mark');
  await fireEvent.press(capsule);
  expect(sounds()).toEqual(['tick']);
  await fireEvent.press(capsule);
  await fireEvent.press(capsule);
  hintGone();
  expect(screen.getByText('$1. One real trading card.')).toBeTruthy();
  expect(sounds()).toEqual(['tick', 'tick', 'tick']);
});

test('left alone for six seconds it does not cover the headline', async () => {
  await open();
  await pass(IDLE_MS);
  hintGone();
  expect(screen.getByText('$1. One real trading card.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Gotchapon mark'));
  expect(sounds()).toEqual(['tick']); // the capsule still answers a tap; the line stays gone
  hintGone();
});

test('no hint arrives over the sheet, or during the beat', async () => {
  await open();
  await fireEvent.press(screen.getByText('Already collecting? Sign in'));
  await pass(IDLE_MS * 2);
  hintGone();
  await fireEvent.press(screen.getByLabelText('Close'));
  await fireEvent.press(screen.getByText('Pull your first card'));
  await pass(IDLE_MS * 2); // the beat is 780 ms of this; the sheet is up for the rest
  hintGone();
});

test('the capsule falls as far as the stage allows, and never off a short one', () => {
  expect(armGeometry(CAPSULE + 400)).toEqual({ drop: 170, mouthTop: 64 }); // 200 of room below: clamped only at the mouth
  expect(armGeometry(CAPSULE)).toEqual({ drop: 40, mouthTop: -40 }); // no room at all: the floor of both
  expect(armGeometry(CAPSULE + 1000)).toEqual({ drop: 212, mouthTop: 64 }); // a tall window does not throw it off the screen
  expect(armGeometry(0)).toEqual({ drop: 40, mouthTop: -40 });
});

// The lean's arithmetic, which had no test and was wrong: it divided by the WINDOW. `onPointerMove` only fires over the app,
// and on the desktop web the app is a CSS-scaled cabinet inside a much larger window, so the pointer could never reach the
// ends of the range and the hero barely moved (found in review).
test('the lean is measured against the screen, not the window it sits in', () => {
  // The cabinet at 1440×900: the 390 pt screen is about 303 px of glass, offset from the window's left edge.
  const box = { x: 568, y: 40, w: 303, h: 655 };
  expect(tiltIn(box.x, box.y, box)).toEqual({ x: -0.5, y: -0.5 });
  expect(tiltIn(box.x + box.w / 2, box.y + box.h / 2, box)).toEqual({ x: 0, y: 0 });
  expect(tiltIn(box.x + box.w, box.y + box.h, box)).toEqual({ x: 0.5, y: 0.5 });
  // The same pointer normalised against the window, which is what it used to do: a fifth of the range, at the far edge.
  expect(Math.abs((box.x + box.w) / 1440 - 0.5)).toBeLessThan(0.11);
  // A pointer on its way out of a corner is clamped, never past the ends.
  expect(tiltIn(box.x - 500, box.y + box.h + 500, box)).toEqual({ x: -0.5, y: 0.5 });
});
