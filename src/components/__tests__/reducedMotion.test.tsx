// Reduced motion (F6.2). Reanimated's timing, spring and repeat animations already jump to their end when the system setting
// is on; the two hand-rolled frame loops are ours to stop: the foil sheen holds still, and the globe's capsules settle
// without being jostled by the idle nudge or a crank kick.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { Skia } from '@shopify/react-native-skia';
import { CapsuleGlobe, SETTLE_MS } from '@/components/machine/CapsuleGlobe';
import { Foil } from '@/components/reveal/Foil';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, useReducedMotion: jest.fn(() => false), useFrameCallback: jest.fn(actual.useFrameCallback) };
});

const reducedMotion = jest.mocked(Reanimated.useReducedMotion);
const frameLoop = jest.mocked(Reanimated.useFrameCallback);
type Frame = Parameters<Parameters<typeof Reanimated.useFrameCallback>[0]>[0];

test('the foil sheen runs on a tier card, and holds still under reduced motion', async () => {
  // A compiled shader (this node environment has no CanvasKit, so jest.setup compiles none): the sheen has something to run.
  const make = jest.spyOn(Skia.RuntimeEffect, 'Make').mockReturnValue({} as ReturnType<typeof Skia.RuntimeEffect.Make>);
  /** Whether a freshly mounted foil runs its sheen's frame loop. */
  const foilLoopOn = async (reduced: boolean) => {
    reducedMotion.mockReturnValue(reduced);
    frameLoop.mockClear();
    await render(<Foil width={188} height={268} intensity={0.9} />);
    return frameLoop.mock.calls.at(-1)![1];
  };
  try {
    expect(await foilLoopOn(false)).toBe(true);
    expect(await foilLoopOn(true)).toBe(false);
  } finally {
    make.mockRestore();
  }
});

test('the idle nudge and a crank kick jostle the capsules, and under reduced motion they only settle', async () => {
  // One frame of the globe's loop. Math.random is only drawn for a jostle's velocity, so its draws count the jostles.
  const oneFrame = async (reduced: boolean, kick: number) => {
    reducedMotion.mockReturnValue(reduced);
    frameLoop.mockClear();
    const globe = { kick: Reanimated.makeMutable(kick) };
    await render(<CapsuleGlobe globe={globe} idle />);
    const loop = frameLoop.mock.calls.at(-1)![0] as (f: Frame) => void;
    const random = jest.spyOn(Math, 'random');
    try {
      loop({ timestamp: 16, timeSincePreviousFrame: 16, timeSinceFirstFrame: 16 } as Frame);
      return { jostles: random.mock.calls.length, kickLeft: globe.kick.get() };
    } finally {
      random.mockRestore();
    }
  };
  expect((await oneFrame(false, 0)).jostles).toBeGreaterThan(0); // the idle nudge on the first frame
  expect((await oneFrame(false, 3)).jostles).toBeGreaterThan(0); // a release kick
  expect(await oneFrame(true, 0)).toEqual({ jostles: 0, kickLeft: 0 });
  expect(await oneFrame(true, 3)).toEqual({ jostles: 0, kickLeft: 0 }); // the kick is spent, not saved for later
});

test('a clock stuck at 0 nudges the pile once, not on every frame', async () => {
  reducedMotion.mockReturnValue(false);
  frameLoop.mockClear();
  const globe = { kick: Reanimated.makeMutable(0) };
  await render(<CapsuleGlobe globe={globe} idle />);
  const loop = frameLoop.mock.calls.at(-1)![0] as (f: Frame) => void;
  const random = jest.spyOn(Math, 'random');
  const stuck = { timestamp: 0, timeSincePreviousFrame: 0, timeSinceFirstFrame: 0 } as Frame;
  try {
    loop(stuck);
    const first = random.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    loop(stuck);
    expect(random.mock.calls.length).toBe(first);
  } finally {
    random.mockRestore();
  }
});

// W1.6 (#139). Measured in Chromium under prefers-reduced-motion: 28 s after a pull all 22 capsules were still trembling (the
// pile's push-apart never comes to rest once a capsule has left). Settle, then hold still: the loop is switched off.
test('under reduced motion the globe settles for SETTLE_MS and is then held still; a capsule leaving gives it one more settle', async () => {
  jest.useFakeTimers();
  try {
    const setActive = jest.fn();
    frameLoop.mockImplementation(() => ({ setActive, isActive: true, callbackId: 0 }) as unknown as ReturnType<typeof Reanimated.useFrameCallback>);
    const last = () => setActive.mock.calls.at(-1)![0];
    reducedMotion.mockReturnValue(true);
    const globe = { kick: Reanimated.makeMutable(0) };
    const view = await render(<CapsuleGlobe globe={globe} idle count={22} />);
    expect(last()).toBe(true); // falling into place
    await act(async () => { jest.advanceTimersByTime(SETTLE_MS - 50); });
    expect(last()).toBe(true);
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(last()).toBe(false); // still
    await view.rerender(<CapsuleGlobe globe={globe} idle count={21} />); // one was dispensed: the pile closes the gap
    expect(last()).toBe(true);
    await act(async () => { jest.advanceTimersByTime(SETTLE_MS + 50); });
    expect(last()).toBe(false);

    // `active` still rules, in both modes: a globe that is switched off (another page) is off, settling or not.
    setActive.mockClear();
    await view.unmount();
    const off = await render(<CapsuleGlobe globe={globe} idle count={22} active={false} />);
    expect(setActive.mock.calls.map((c) => c[0])).toEqual([false]);
    await off.unmount(); // or its settle timer re-renders it under the control's setting below

    reducedMotion.mockReturnValue(false); // the control: without the setting the loop never stops
    setActive.mockClear();
    await render(<CapsuleGlobe globe={globe} idle count={22} />);
    await act(async () => { jest.advanceTimersByTime(SETTLE_MS * 3); });
    expect(setActive.mock.calls.map((c) => c[0])).not.toContain(false);
  } finally { frameLoop.mockImplementation(jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated').useFrameCallback); jest.useRealTimers(); }
});
