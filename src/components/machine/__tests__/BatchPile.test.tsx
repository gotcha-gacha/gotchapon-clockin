// Batch capsule drops (F6.2): a ×5/×10 pile lands as one settle, each capsule a thud in a pitch variant so
// neighbouring thuds don't cut each other off. #389: they land together. A stagger read as one capsule, then the
// rest of the pile. #317: the same drop does not play again when the outcomes arrive.
import { beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Outcome } from '@/api/contract';
import { playSfx } from '@/audio/sfx';
import { tierColor } from '@/theme/tokens';
import { BatchPile } from '@/components/machine/BatchPile';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));
// The hint pulse is `withRepeat(…, -1)`. Fake timers would spin that forever; these tests only read the landing.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, withRepeat: (animation: unknown) => animation };
});

const outcome = (i: number): Outcome => ({
  cardId: `c${i}`, rarity: i === 2 ? 'holo' : 'common', isDupe: false,
  card: { id: `c${i}`, name: `Card ${i}`, set: 'SV', number: String(i), imgSmall: `https://img/c${i}.png`, imgLarge: `https://img/c${i}_hi.png` },
});

const thuds = () => jest.mocked(playSfx).mock.calls.map(([name]) => name).filter((name) => String(name).startsWith('thud-'));
const topColor = (i: number) => {
  const style = screen.getAllByTestId('pile-cap-top')[i]!.props.style as { backgroundColor?: string }[];
  return Object.assign({}, ...style).backgroundColor;
};

beforeEach(() => { jest.mocked(playSfx).mockClear(); });

test('each capsule of a ×5 pile lands with its own thud, together', async () => {
  jest.useFakeTimers();
  try {
    await render(<BatchPile outcomes={[0, 1, 2, 3, 4].map(outcome)} onOpen={() => {}} />);
    expect(playSfx).not.toHaveBeenCalled(); // still falling
    await act(async () => { await jest.advanceTimersByTimeAsync(559); });
    expect(thuds()).toHaveLength(0);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(thuds()).toEqual(['thud-0', 'thud-1', 'thud-2', 'thud-0', 'thud-1']);
  } finally {
    jest.useRealTimers();
  }
});

test('a wait of N drops N capsules once, then the same capsules become the tap pile', async () => {
  const onOpen = jest.fn();
  // Index 0's palette colour is not holo, so the recolour is visible. (Index 2's palette slot is the holo blue.)
  const outcomes = [0, 1, 2, 3, 4].map((i) => ({ ...outcome(i), rarity: i === 0 ? 'holo' as const : 'common' as const }));
  const view = await render(<BatchPile count={5} onOpen={onOpen} />);
  expect(screen.getAllByTestId('pile-capsule')).toHaveLength(5);
  expect(screen.getByText('Opening 5…')).toBeTruthy();
  expect(screen.queryByText('Tap the pile to open all 5')).toBeNull();
  expect(topColor(0)).not.toBe(tierColor.holo); // rarity is not known yet
  await fireEvent.press(screen.getByTestId('batch-pile'));
  expect(onOpen).not.toHaveBeenCalled();
  await waitFor(() => expect(thuds()).toEqual(['thud-0', 'thud-1', 'thud-2', 'thud-0', 'thud-1']));

  await view.rerender(<BatchPile count={5} outcomes={outcomes} onOpen={onOpen} />);
  expect(screen.getAllByTestId('pile-capsule')).toHaveLength(5);
  expect(screen.getByText('Tap the pile to open all 5')).toBeTruthy();
  expect(screen.queryByText('Opening 5…')).toBeNull();
  expect(topColor(0)).toBe(tierColor.holo); // the holo takes its colour; the drop does not start over
  await fireEvent.press(screen.getByLabelText('Open all 5 capsules'));
  expect(onOpen).toHaveBeenCalledTimes(1);
  // Longer than one landing (560 ms): a remount would have thudded again.
  await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
  expect(thuds()).toEqual(['thud-0', 'thud-1', 'thud-2', 'thud-0', 'thud-1']);
});

test('a ×10 pile is ten capsules from the first paint, and they land in one beat', async () => {
  jest.useFakeTimers();
  try {
    await render(<BatchPile count={10} onOpen={() => {}} />);
    expect(screen.getAllByTestId('pile-capsule')).toHaveLength(10);
    expect(screen.getByText('Opening 10…')).toBeTruthy();
    await act(async () => { await jest.advanceTimersByTimeAsync(560); });
    expect(thuds()).toEqual(['thud-0', 'thud-1', 'thud-2', 'thud-0', 'thud-1', 'thud-2', 'thud-0', 'thud-1', 'thud-2', 'thud-0']);
  } finally {
    jest.useRealTimers();
  }
});

test('a sealed pile keeps its capsules and says nothing under them', async () => {
  const onOpen = jest.fn();
  await render(<BatchPile count={5} label="none" onOpen={onOpen} />);
  expect(screen.getAllByTestId('pile-capsule')).toHaveLength(5);
  expect(screen.queryByText(/Opening/)).toBeNull();
  expect(screen.queryByText(/Tap the pile/)).toBeNull();
  await fireEvent.press(screen.getByTestId('batch-pile'));
  expect(onOpen).not.toHaveBeenCalled();
});
