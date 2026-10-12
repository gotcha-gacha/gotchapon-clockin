// The crank's shake listener on Android (shake.ts; Ben, 11 Oct 2026). The arithmetic is shake.test.ts's; this is the crank
// picking Android's numbers on an Android phone and the design's on an iPhone. The native jest project runs as iOS, so the
// platform is replaced per test, before the crank subscribes.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { Platform } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Crank } from '../Crank';

// The shake sensor, stood in for: the crank subscribes while it is enabled, and the test is the phone being moved.
const shake: { feed: ((g: { x: number; y: number; z: number }) => void) | null } = { feed: null };
jest.mock('@/sensors/motion', () => ({ primeMotion: jest.fn(), watchShake: (cb: (g: { x: number; y: number; z: number }) => void) => { shake.feed = cb; return { remove: () => { shake.feed = null; } }; } }));

const spies = { onStart: jest.fn(), onRelease: jest.fn(), onActive: jest.fn(), onAbandon: jest.fn() };
function Host() {
  const travel = useSharedValue(0);
  return <Crank enabled multi={1} armed travel={travel} {...spies} />;
}
let os: { restore: () => void } | null = null;
const on = (platform: 'ios' | 'android') => { os = jest.replaceProperty(Platform, 'OS', platform); };
beforeEach(() => { jest.useFakeTimers(); for (const s of Object.values(spies)) s.mockClear(); });
afterEach(() => { os?.restore(); os = null; jest.useRealTimers(); });

/** Samples of |a|, 33 ms apart, as the sensor sends them (each handed to the UI thread: a tick away). */
async function feed(mags: number[]) {
  for (const m of mags) await act(async () => { shake.feed!({ x: m, y: 0, z: 0 }); jest.advanceTimersByTime(33); });
}
const calls = () => [spies.onStart.mock.calls.length, spies.onRelease.mock.calls.length, spies.onAbandon.mock.calls.length];

test('control: on iOS, 13 m/s² kept up for two seconds (a walk, on a noisy sensor) turns the crank, as the design says', async () => {
  on('ios');
  await render(<Host />);
  await feed(Array(60).fill(13));
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

test('on Android the same two seconds start nothing: no prepared pull, no release', async () => {
  on('android');
  await render(<Host />);
  await feed(Array(60).fill(13));
  expect(calls()).toEqual([0, 0, 0]);
});

test('on Android heel strikes every half second never add up to a release, and the shake is abandoned 0.6 s after the last', async () => {
  on('android');
  await render(<Host />);
  const step = [25, 20, ...Array(13).fill(9.8)]; // two hard samples, then the phone at rest until the next step (≈ 0.5 s)
  for (let i = 0; i < 40; i++) await feed(step); // 20 s of walking
  expect(spies.onStart).toHaveBeenCalledTimes(1); // the first strike counted as shaking: a pull was prepared…
  expect(spies.onRelease).not.toHaveBeenCalled(); // …and never released
  await act(async () => { jest.advanceTimersByTime(700); });
  expect(spies.onAbandon).toHaveBeenCalledTimes(1); // …and given up once the steps stopped
});

test('on Android a hard shake that is kept up still releases', async () => {
  on('android');
  await render(<Host />);
  const g2at3hz = Array.from({ length: 60 }, (_, i) => Math.hypot(9.8, 2 * 9.8 * Math.sin(2 * Math.PI * 3 * i * 0.033)));
  await feed(g2at3hz); // two seconds at most: shake.test.ts has it turning in about 1.3
  expect(spies.onStart).toHaveBeenCalledTimes(1);
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});
