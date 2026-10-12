import { beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { RollDome, RollTray } from '../PullRoll';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated') as typeof import('react-native-reanimated');
  return { __esModule: true, ...actual, useReducedMotion: jest.fn(() => false), withRepeat: (animation: unknown) => animation };
});

const reduced = jest.mocked(Reanimated.useReducedMotion);

beforeEach(() => { reduced.mockReturnValue(false); });

test('the tray is three reels until reduced motion, which pulses three dots and still locks stars', async () => {
  const spinning = await render(<RollTray reelStop={0} />);
  expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
  expect(screen.queryByTestId('roll-dot')).toBeNull();
  await spinning.unmount();

  reduced.mockReturnValue(true);
  await render(<RollTray reelStop={0} />);
  expect(screen.getAllByTestId('roll-dot')).toHaveLength(3);
  expect(screen.queryByTestId('roll-reel')).toBeNull();
});

test('a reduced-motion stop still locks gold stars', async () => {
  reduced.mockReturnValue(true);
  await render(<RollTray reelStop={2} />);
  expect(screen.getAllByTestId('roll-star')).toHaveLength(2);
  expect(screen.queryByTestId('roll-dot')).toBeNull();
});

test('churn mounts without the wait buttons until they are asked for', async () => {
  const view = await render(<RollDome flash={false} actions={false} />);
  expect(screen.getByTestId('roll-churn')).toBeTruthy();
  expect(screen.queryByLabelText('Keep waiting')).toBeNull();
  await view.rerender(<RollDome flash={false} actions onKeep={() => {}} onNotify={() => {}} />);
  expect(screen.getByLabelText('Keep waiting')).toBeTruthy();
  expect(screen.getByLabelText('Notify me')).toBeTruthy();
});
