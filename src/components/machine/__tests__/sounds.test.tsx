// Machine sounds (F6.2): turning the crank ratchets with a tick whose pitch rises with travel, and the release pops once.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { playSfx } from '@/audio/sfx';
import { Machine, type Multi } from '@/components/machine/Machine';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));

// Pointer samples on a circle around the socket centre (44,44), clockwise from the top (as in Crank.test).
const turn = (turns: number, perTurn = 60) => Array.from({ length: Math.round(turns * perTurn) + 1 }, (_, k) => {
  const a = (k / perTurn) * Math.PI * 2;
  return { x: 44 + 30 * Math.sin(a), y: 44 - 30 * Math.cos(a) };
});

test('cranking ticks at a rising pitch as the handle travels, and the release pops once', async () => {
  const onRelease = jest.fn();
  await render(<Machine balanceUsd={5} freePulls={0} multi={1 as Multi} onMulti={() => {}} targeted={false} tickerText="" onTicker={() => {}} onDeposit={() => {}} onRelease={onRelease} />);
  const pts = turn(1.3);
  fireGestureHandler(getByGestureTestId('crank-pan'), [{ state: State.BEGAN, ...pts[0] }, { state: State.ACTIVE, ...pts[0] }, ...pts.slice(1), { state: State.END }]);
  await waitFor(() => expect(onRelease).toHaveBeenCalledTimes(1)); // runOnJS hands the crank's calls over after the gesture
  const played = jest.mocked(playSfx).mock.calls.map(([name]) => name);
  const ticks = played.filter((n) => n.startsWith('crank-'));
  expect(new Set(ticks).size).toBeGreaterThanOrEqual(6); // most of the eight notches
  expect(ticks).toEqual([...ticks].sort()); // never falls back down while turning forward
  expect(played.filter((n) => n === 'pop')).toHaveLength(1);
});
