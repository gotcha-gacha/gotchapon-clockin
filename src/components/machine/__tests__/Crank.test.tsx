// The crank's charge point: a full 360° of hand travel fires onRelease exactly once, at ×1 and at the
// heavier ×5 (the regression behind 4b055a4, where the gesture measured in the rotating knob's frame
// and ×5 never reached 360°).
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { makeMutable } from 'react-native-reanimated';
import { Crank } from '@/components/machine/Crank';

// Pointer samples on a circle around the socket centre (44,44), clockwise from the top.
const turn = (turns: number, perTurn = 60) => Array.from({ length: Math.round(turns * perTurn) + 1 }, (_, k) => {
  const a = (k / perTurn) * Math.PI * 2;
  return { x: 44 + 30 * Math.sin(a), y: 44 - 30 * Math.cos(a) };
});

async function crank(multi: 1 | 5 | 10, turns: number) {
  const onRelease = jest.fn();
  await render(<Crank enabled multi={multi} armed travel={makeMutable(0)} onRelease={onRelease} />);
  const pts = turn(turns);
  fireGestureHandler(getByGestureTestId('crank-pan'), [
    { state: State.BEGAN, ...pts[0] },
    { state: State.ACTIVE, ...pts[0] },
    ...pts.slice(1),
    { state: State.END },
  ]);
  return onRelease;
}

test('×1: 1.25 turns of hand travel (×0.8 gain) release once', async () => {
  expect((await crank(1, 1.3)).mock.calls).toHaveLength(1);
});

test('×5: the heavier crank still releases within 2.1 turns, and only once', async () => {
  expect((await crank(5, 2.1)).mock.calls).toHaveLength(1);
});

test('a short turn never releases', async () => {
  expect((await crank(5, 0.8)).mock.calls).toHaveLength(0);
});
