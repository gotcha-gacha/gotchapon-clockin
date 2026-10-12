// The keyboard's turn under reduced motion (W1.6, #139): the knob is not drawn going round, and nothing about the money path
// moves with it. The release still comes when the turn's 650 ms are up, once.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { createRef } from 'react';
import { act, render } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { AUTO_TURN_MS, Crank, type CrankHandle } from '../Crank';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, useReducedMotion: jest.fn(() => false) };
});
const reducedMotion = jest.mocked(Reanimated.useReducedMotion);
const spies = { onStart: jest.fn(), onRelease: jest.fn(), onTick: jest.fn() };
function Host({ handle }: { handle: React.Ref<CrankHandle> }) {
  const travel = Reanimated.useSharedValue(0);
  return <Crank ref={handle} enabled multi={1} armed travel={travel} {...spies} />;
}
beforeEach(() => { jest.useFakeTimers(); for (const s of Object.values(spies)) s.mockClear(); });
afterEach(() => { jest.useRealTimers(); });

/** One keyboard turn; answers how many ratchet ticks the knob had passed by 600 ms, and the releases before and after the end. */
async function turn(reduced: boolean) {
  reducedMotion.mockReturnValue(reduced);
  const handle = createRef<CrankHandle>();
  const view = await render(<Host handle={handle} />);
  await act(async () => { handle.current!.autoCrank(); });
  expect(spies.onStart).toHaveBeenCalledTimes(1); // the prepare goes out at t = 0 either way
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS - 50); });
  const seen = { ticksBeforeTheEnd: spies.onTick.mock.calls.length, releasedEarly: spies.onRelease.mock.calls.length };
  await act(async () => { jest.advanceTimersByTime(100); });
  const out = { ...seen, releases: spies.onRelease.mock.calls.length };
  await view.unmount();
  return out;
}

test('with motion the knob is seen going round (the control), and the release is at the end', async () => {
  const t = await turn(false);
  expect(t.ticksBeforeTheEnd).toBeGreaterThan(3);
  expect([t.releasedEarly, t.releases]).toEqual([0, 1]);
});

test('under reduced motion the knob is never drawn part-way, and the release is still at the end of the 650 ms, once', async () => {
  const t = await turn(true);
  expect(t.ticksBeforeTheEnd).toBe(0);
  expect([t.releasedEarly, t.releases]).toEqual([0, 1]);
});
