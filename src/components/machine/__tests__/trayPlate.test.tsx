// Live tray plate (#359): five lines, first match wins, top-up opens Wallet, the box never changes size.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { processColor, StyleSheet, type ViewStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Phase } from '@/ritual/reducer';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { Machine, type Multi } from '@/components/machine/Machine';
import { TrayPlate } from '@/components/machine/TrayPlate';
import { pullsAvailable } from '@/api/contract';
import { plateFlickerSteps, pullsLeft, trayPlateState } from '@/components/machine/trayPlateState';

const PHASES: Phase[] = ['idle', 'preparing', 'armed', 'rolling', 'stopping', 'dropping', 'committing', 'capsule', 'card', 'batchcaps', 'spread', 'sealed', 'coined', 'burning'];
const DISPENSING: Phase[] = ['rolling', 'stopping', 'dropping'];
const CARD_UP: Phase[] = ['capsule', 'card'];
const PILE_UP: Phase[] = ['batchcaps', 'spread'];

const box = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as ViewStyle;

test('the five lines follow the table, and an earlier line wins', () => {
  for (const phase of DISPENSING) {
    expect(trayPlateState(phase, 0, 4)).toEqual({ label: 'DISPENSING…', dot: color.yellow, topUp: false });
  }
  for (const phase of CARD_UP) {
    expect(trayPlateState(phase, 0, 0)).toEqual({ label: 'YOUR CARD IS UP', dot: color.mint, topUp: false });
    expect(trayPlateState(phase, 8, 2).label).toBe('YOUR CARD IS UP');
  }
  for (const phase of PILE_UP) {
    expect(trayPlateState(phase, 0, 0)).toEqual({ label: 'YOUR PILE IS UP', dot: color.mint, topUp: false });
    expect(trayPlateState(phase, 8, 2).label).toBe('YOUR PILE IS UP');
  }
  for (const phase of PHASES) {
    if (DISPENSING.includes(phase) || CARD_UP.includes(phase) || PILE_UP.includes(phase)) continue;
    expect(trayPlateState(phase, 0, 0)).toEqual({ label: 'TOP UP · $1 A TURN', dot: color.danger, topUp: true });
    expect(trayPlateState(phase, 0.99, 0).topUp).toBe(true);
    expect(trayPlateState(phase, 0, 1)).toEqual({ label: 'FREE TURN READY · CRANK IT', dot: color.mint, topUp: false });
    expect(trayPlateState(phase, 12, 3).label).toBe('FREE TURN READY · CRANK IT');
    expect(trayPlateState(phase, 1, 0)).toEqual({ label: 'TURN THE CRANK · 1 LEFT', dot: color.mint, topUp: false });
    expect(trayPlateState(phase, 4.9, 0).label).toBe('TURN THE CRANK · 4 LEFT');
  }
  expect(pullsLeft(4.9)).toBe(4);
  expect(pullsLeft(0)).toBe(0);
  // A 0 that has not been read is not the top-up line and not "0 LEFT". Dispensing still wins.
  expect(trayPlateState('idle', 0, 0, false)).toEqual({ label: '…', dot: color.text3, topUp: false });
  expect(trayPlateState('rolling', 0, 0, false).label).toBe('DISPENSING…');
  expect(trayPlateState('card', 0, 0, false).label).toBe('YOUR CARD IS UP');
});

test('a chase plate counts $1.50 pulls, the same number as the dial, and ignores free pulls', () => {
  expect(pullsAvailable(27, 4, true)).toBe(18);
  expect(pullsAvailable(25.5, 0, true)).toBe(17);
  expect(pullsAvailable(27, 4, false)).toBe(31);
  expect(trayPlateState('idle', 27, 4, true, true)).toEqual({ label: 'TURN THE CRANK · 18 LEFT', dot: color.mint, topUp: false });
  expect(trayPlateState('idle', 25.5, 0, true, true).label).toBe('TURN THE CRANK · 17 LEFT');
  expect(trayPlateState('idle', 1, 2, true, true)).toEqual({ label: 'TOP UP · $1.50 A TURN', dot: color.danger, topUp: true });
  expect(trayPlateState('rolling', 27, 0, true, true).label).toBe('DISPENSING…');
  expect(trayPlateState('idle', 27, 4).label).toBe('FREE TURN READY · CRANK IT');
});

test('the flicker is pbFlicker over 2.4s: solid, then the two short dips', () => {
  const steps = plateFlickerSteps();
  expect(steps).toEqual([
    { opacity: 1, duration: 2208 },
    { opacity: 0.6, duration: 24 },
    { opacity: 1, duration: 24 },
    { opacity: 0.75, duration: 72 },
    { opacity: 1, duration: 24 },
    { opacity: 1, duration: 48 },
  ]);
  expect(steps.reduce((sum, step) => sum + step.duration, 0)).toBe(2400);
});

test('each line paints its dot, and only TOP UP is a button', async () => {
  const onTopUp = jest.fn();
  const view = await render(<TrayPlate phase="idle" balanceUsd={0} freePulls={0} onTopUp={onTopUp} />);
  expect(screen.getByText('TOP UP · $1 A TURN')).toBeTruthy();
  expect(box('tray-plate-dot').backgroundColor).toBe(color.danger);
  expect(box('tray-plate-dot')).toMatchObject({ width: 7, height: 7, borderRadius: 3.5, shadowRadius: 8, shadowOpacity: 1 });
  expect(box('tray-plate-dot').boxShadow).toBe('0 0 8px #FF6B5B');
  await fireEvent.press(screen.getByRole('button', { name: 'TOP UP · $1 A TURN' }));
  expect(onTopUp).toHaveBeenCalledTimes(1);

  await view.rerender(<TrayPlate phase="rolling" balanceUsd={0} freePulls={2} onTopUp={onTopUp} />);
  expect(screen.getByText('DISPENSING…')).toBeTruthy();
  expect(box('tray-plate-dot').backgroundColor).toBe(color.yellow);
  expect(screen.queryByRole('button')).toBeNull();
  await fireEvent.press(screen.getByText('DISPENSING…'));
  expect(onTopUp).toHaveBeenCalledTimes(1);

  await view.rerender(<TrayPlate phase="card" balanceUsd={0} freePulls={0} onTopUp={onTopUp} />);
  expect(screen.getByText('YOUR CARD IS UP')).toBeTruthy();
  expect(box('tray-plate-dot').backgroundColor).toBe(color.mint);
  expect(screen.queryByRole('button')).toBeNull();

  await view.rerender(<TrayPlate phase="batchcaps" balanceUsd={8} freePulls={2} onTopUp={onTopUp} />);
  expect(screen.getByText('YOUR PILE IS UP')).toBeTruthy();
  expect(screen.queryByText('YOUR CARD IS UP')).toBeNull();
  expect(box('tray-plate-dot').backgroundColor).toBe(color.mint);
  expect(screen.queryByRole('button')).toBeNull();

  await view.rerender(<TrayPlate phase="idle" balanceUsd={0.4} freePulls={2} onTopUp={onTopUp} />);
  expect(screen.getByText('FREE TURN READY · CRANK IT')).toBeTruthy();
  expect(box('tray-plate-dot').backgroundColor).toBe(color.mint);

  await view.rerender(<TrayPlate phase="idle" balanceUsd={7.8} freePulls={0} onTopUp={onTopUp} />);
  expect(screen.getByText('TURN THE CRANK · 7 LEFT')).toBeTruthy();
  expect(box('tray-plate-dot').backgroundColor).toBe(color.mint);
  expect(screen.queryByRole('button')).toBeNull();
});

test('the plate box, type, and row stay put when the line changes', async () => {
  const onTopUp = jest.fn();
  const view = await render(<TrayPlate phase="idle" balanceUsd={3} freePulls={0} onTopUp={onTopUp} />);
  const plate = () => box('tray-plate');
  const label = () => box('tray-plate-label');
  const row = () => box('tray-plate-row');
  const first = { plate: plate(), label: label(), row: row() };
  expect(first.plate).toMatchObject({
    position: 'absolute', left: 24, right: 24, bottom: 8, height: 36,
    borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
  });
  expect(first.label).toMatchObject({ fontFamily: font.black, fontSize: 10, lineHeight: 12, letterSpacing: 1.6, color: '#2A2F45' });
  expect(first.row).toMatchObject({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 });
  // The test renderer stores the gradient colours already processed (0xAARRGGBB).
  expect(screen.getByTestId('tray-plate-fill').props.colors).toEqual([processColor(color.cream), processColor(color.creamDeep)]);

  for (const next of [
    { phase: 'rolling' as const, balanceUsd: 0, freePulls: 5 },
    { phase: 'spread' as const, balanceUsd: 0, freePulls: 0 },
    { phase: 'idle' as const, balanceUsd: 0, freePulls: 0 },
    { phase: 'dropping' as const, balanceUsd: 9, freePulls: 1 },
    { phase: 'idle' as const, balanceUsd: 2.2, freePulls: 0 },
  ]) {
    await view.rerender(<TrayPlate {...next} onTopUp={onTopUp} />);
    expect(plate()).toMatchObject({ position: 'absolute', left: 24, right: 24, bottom: 8, height: 36 });
    expect(label()).toMatchObject({ fontSize: 10, lineHeight: 12, letterSpacing: 1.6 });
    expect(row()).toMatchObject({ gap: 8, flexDirection: 'row' });
    expect(box('tray-plate-dot')).toMatchObject({ width: 7, height: 7 });
  }
  expect(screen.getAllByTestId('tray-plate')).toHaveLength(1);
});

const machine = { balanceUsd: 0, freePulls: 0, multi: 1 as Multi, onMulti: () => {}, targeted: false, tickerText: 'vault facts', onTicker: () => {}, onDeposit: () => {}, onRelease: () => {} };

test('DISPENSING sits under the tray while the reels occupy the mouth', async () => {
  const view = await render(<Machine {...machine} balanceUsd={5} />);
  expect(screen.getByText('TURN THE CRANK · 5 LEFT')).toBeTruthy();
  expect(screen.queryByText('COLLECT HAPPINESS')).toBeNull();
  expect(screen.queryByTestId('roll-reel')).toBeNull();
  await view.rerender(<Machine {...machine} balanceUsd={0} freePulls={2} showRoll phase="rolling" />);
  expect(screen.getByText('DISPENSING…')).toBeTruthy();
  expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
  expect(screen.queryByText('FREE TURN READY · CRANK IT')).toBeNull();
  await view.rerender(<Machine {...machine} balanceUsd={0} freePulls={0} showRoll phase="stopping" reelStop={2} />);
  expect(screen.getByText('DISPENSING…')).toBeTruthy();
  expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
});
