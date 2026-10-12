// Pull states on the machine (F2.10): no balance, free pulls only, restocking; and when the crank listens for a shake.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DeviceMotion } from 'expo-sensors';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { Machine, type Multi } from '@/components/machine/Machine';

const base = { balanceUsd: 0, freePulls: 0, multi: 1 as Multi, onMulti: () => {}, targeted: false, tickerText: 'vault facts', onTicker: () => {}, onDeposit: () => {}, onRelease: () => {} };

test('a balance still loading is not zero pulls and not a top-up', async () => {
  await render(<Machine {...base} balanceKnown={false} />);
  expect(screen.getByTestId('pulls-count').props.children).toBe('…');
  expect(screen.getByLabelText('Pulls loading')).toBeTruthy();
  expect(screen.queryByText('OUT OF PULLS')).toBeNull();
  expect(screen.queryByText('TOP UP · $1 A TURN')).toBeNull();
  expect(screen.queryByText(/LEFT/)).toBeNull();
  expect(screen.queryByRole('button', { name: /TOP UP/ })).toBeNull();
});

test('no balance: out of pulls, and Deposit and the plate both go to the wallet', async () => {
  const onDeposit = jest.fn();
  await render(<Machine {...base} onDeposit={onDeposit} />);
  expect(screen.getByText('OUT OF PULLS')).toBeTruthy();
  expect(screen.getByText('TOP UP · $1 A TURN')).toBeTruthy();
  await fireEvent.press(screen.getByText('Deposit USDC · $1 a pull'));
  await fireEvent.press(screen.getByRole('button', { name: 'TOP UP · $1 A TURN' }));
  expect(onDeposit).toHaveBeenCalledTimes(2);
});

test('free pulls only: ×1 is free, ×5 stays closed, and a leftover ×5 says how to use the free pulls', async () => {
  const onMulti = jest.fn();
  const r = await render(<Machine {...base} freePulls={3} onMulti={onMulti} />);
  expect(screen.getByTestId('pulls-count').props.children).toBe(3);
  expect(screen.getByText('FREE TURN READY · CRANK IT')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'TOP UP · $1 A TURN' })).toBeNull();
  expect(screen.queryByText('free · 1 pull')).toBeNull();
  expect(screen.queryByText('OUT OF PULLS')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Pull ×5'));
  expect(onMulti).not.toHaveBeenCalled();
  await r.rerender(<Machine {...base} freePulls={3} multi={5} onMulti={onMulti} />);
  expect(screen.getByText('FREE TURN READY · CRANK IT')).toBeTruthy();
  expect(screen.getByText('NOT ENOUGH FOR ×5')).toBeTruthy();
  expect(screen.getByText('3 free pulls left — switch to ×1')).toBeTruthy();
  expect(screen.queryByText('OUT OF PULLS')).toBeNull();
});

test('restocking: the dome says so instead of asking for money, and offers the binder', async () => {
  const onBrowse = jest.fn();
  await render(<Machine {...base} restocking="Friday 8pm MYT" onBrowse={onBrowse} />);
  expect(screen.getByText('RESTOCKING')).toBeTruthy();
  expect(screen.queryByText('OUT OF PULLS')).toBeNull();
  expect(screen.getByText('Next restock Friday 8pm MYT. Your binder and balance are untouched.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Browse my binder'));
  expect(onBrowse).toHaveBeenCalledTimes(1);
});

test('a chase shows the same $1.50 count on the dial and the plate', async () => {
  const r = await render(<Machine {...base} balanceUsd={27} freePulls={4} targeted />);
  expect(screen.getByTestId('pulls-count').props.children).toBe(18);
  expect(screen.getByText('TURN THE CRANK · 18 LEFT')).toBeTruthy();
  expect(screen.queryByText('FREE TURN READY · CRANK IT')).toBeNull();
  await r.rerender(<Machine {...base} balanceUsd={25.5} freePulls={4} targeted />);
  expect(screen.getByTestId('pulls-count').props.children).toBe(17);
  expect(screen.getByText('TURN THE CRANK · 17 LEFT')).toBeTruthy();
});

const turn = (turns: number, perTurn = 60) => Array.from({ length: Math.round(turns * perTurn) + 1 }, (_, k) => {
  const a = (k / perTurn) * Math.PI * 2;
  return { x: 44 + 30 * Math.sin(a), y: 44 - 30 * Math.cos(a) };
});

test('a funded chase keeps ×5 and ×10, and a ×5 crank releases as ×5', async () => {
  const onMulti = jest.fn();
  const onRelease = jest.fn();
  const view = await render(<Machine {...base} balanceUsd={1} targeted onMulti={onMulti} onRelease={onRelease} />);
  await fireEvent.press(screen.getByLabelText('Pull ×5'));
  expect(onMulti).not.toHaveBeenCalled();
  expect(screen.getByText('NOT ENOUGH FOR $1.50')).toBeTruthy();
  await view.rerender(<Machine {...base} balanceUsd={3} targeted multi={5} onMulti={onMulti} onRelease={onRelease} />);
  expect(screen.getByText('NOT ENOUGH FOR $7.50')).toBeTruthy();

  await view.rerender(<Machine {...base} balanceUsd={20} freePulls={4} targeted multi={1} onMulti={onMulti} onRelease={onRelease} />);
  await fireEvent.press(screen.getByLabelText('Pull ×5'));
  await fireEvent.press(screen.getByLabelText('Pull ×10'));
  expect(onMulti.mock.calls).toEqual([[5], [10]]);

  await view.rerender(<Machine {...base} balanceUsd={20} freePulls={4} targeted multi={5} onMulti={onMulti} onRelease={onRelease} />);
  const pts = turn(2.1);
  fireGestureHandler(getByGestureTestId('crank-pan'), [{ state: State.BEGAN, ...pts[0] }, { state: State.ACTIVE, ...pts[0] }, ...pts.slice(1), { state: State.END }]);
  await waitFor(() => expect(onRelease).toHaveBeenCalledWith(5));
});

test('a turn already under way keeps the crank when the free-pull counter drops to zero', async () => {
  const motion = jest.mocked(DeviceMotion.addListener);
  motion.mockClear();
  await render(<Machine {...base} phase="armed" />);
  expect(screen.getByTestId('pulls-count').props.children).toBe(0);
  expect(screen.queryByText('$1 · 1 pull')).toBeNull();
  expect(screen.queryByText('OUT OF PULLS')).toBeNull();
  expect(motion).toHaveBeenCalled(); // dropping the last free pull off the counter did not switch the crank off
});

test('the crank listens for a shake only while the machine is on screen and nothing sits on top of it', async () => {
  const motion = jest.mocked(DeviceMotion.addListener);
  motion.mockClear();
  const funded = { ...base, balanceUsd: 5 };
  const r = await render(<Machine {...funded} />);
  expect(motion).toHaveBeenCalledTimes(1); // on screen with $5: a shake could pull
  const first = motion.mock.results[0]!.value as { remove: () => void };
  await r.rerender(<Machine {...funded} active={false} />);
  expect(first.remove).toHaveBeenCalled(); // another page is showing
  await r.rerender(<Machine {...funded} locked />);
  expect(motion).toHaveBeenCalledTimes(1); // back on screen, but a takeover sits on top
  await r.rerender(<Machine {...funded} />);
  expect(motion).toHaveBeenCalledTimes(2);
});

test('the marquee line is one static copy, and a roll mounts orbit rings and the tray reels', async () => {
  const view = await render(<Machine {...base} balanceUsd={5} tickerText="vault facts" />);
  expect(screen.getAllByText('vault facts')).toHaveLength(1);
  expect(screen.getByText('TURN THE CRANK · 5 LEFT')).toBeTruthy();
  expect(screen.queryByText('COLLECT HAPPINESS')).toBeNull();
  expect(screen.queryByTestId('roll-reel')).toBeNull();
  expect(screen.queryByTestId('roll-churn')).toBeNull();
  await view.rerender(<Machine {...base} balanceUsd={5} tickerText="vault facts" showRoll phase="rolling" />);
  expect(screen.getByTestId('roll-churn')).toBeTruthy();
  expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
  expect(screen.queryByTestId('roll-star')).toBeNull();
  expect(screen.queryByText(/\$1 ·/)).toBeNull();
  await view.rerender(<Machine {...base} balanceUsd={5} tickerText="vault facts" showRoll phase="stopping" reelStop={2} />);
  expect(screen.getByTestId('roll-churn')).toBeTruthy();
  expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
  expect(screen.getAllByTestId('roll-star')).toHaveLength(2);
  await view.rerender(<Machine {...base} balanceUsd={5} tickerText="vault facts" phase="dropping" />);
  expect(screen.getByText('DISPENSING…')).toBeTruthy();
  expect(screen.queryByTestId('roll-reel')).toBeNull();
  expect(screen.queryByTestId('roll-churn')).toBeNull();
});

// Android has no Menlo, so the readouts take `font.mono` there (11 Oct 2026). The face is read once, as the module loads, and
// this project runs as iOS (its `Platform.select` answers iOS whatever `OS` says), so what is pinned here is the side that must
// not move: an iPhone's readouts are still Menlo.
test('on iOS the ticker, the out-of-pulls line and the PULLS counter are still Menlo', async () => {
  await render(<Machine {...base} tickerText="vault facts" />);
  for (const el of [screen.getByText('vault facts'), screen.getByText('OUT OF PULLS'), screen.getByTestId('pulls-count')]) {
    expect(StyleSheet.flatten(el.props.style).fontFamily).toBe('Menlo');
  }
});
