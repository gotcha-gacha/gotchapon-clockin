import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Phase } from './reducer';
import { useRollWait } from './useRollWait';

function Harness({ phase, count }: { phase: Phase; count: number }) {
  const w = useRollWait(phase, count);
  return (
    <>
      <Text testID="hint">{w.text}</Text>
      {w.actions ? (
        <>
          <Pressable onPress={w.keep} accessibilityRole="button"><Text>Keep waiting</Text></Pressable>
          <Pressable onPress={w.notify} accessibilityRole="button"><Text>Notify me</Text></Pressable>
        </>
      ) : null}
    </>
  );
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

const advance = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };

test('copy escalates, Keep waiting and Notify me change the line, and 30s brings the buttons back', async () => {
  await render(<Harness phase="rolling" count={5} />);
  expect(screen.getByTestId('hint')).toHaveTextContent('Rolling 5 cards…');
  expect(screen.queryByText('Keep waiting')).toBeNull();
  await advance(2600);
  expect(screen.getByTestId('hint')).toHaveTextContent('Still rolling — your pull is locked in.');
  await advance(4400);
  expect(screen.getByTestId('hint')).toHaveTextContent('Taking longer than usual. Your pull is safe.');
  await fireEvent.press(screen.getByText('Keep waiting'));
  expect(screen.getByTestId('hint')).toHaveTextContent('Nearly there…');
  expect(screen.queryByText('Keep waiting')).toBeNull();
  await advance(30_000);
  expect(screen.getByTestId('hint')).toHaveTextContent('Taking longer than usual. Your pull is safe.');
  expect(screen.getByText('Keep waiting')).toBeTruthy();
  expect(screen.getByText('Notify me')).toBeTruthy();
});

test('Notify me changes the line and keeps polling copy until the pull is stuck', async () => {
  await render(<Harness phase="rolling" count={1} />);
  await advance(7000);
  await fireEvent.press(screen.getByText('Notify me'));
  expect(screen.getByTestId('hint')).toHaveTextContent("We'll ping you — it lands in your binder either way.");
  expect(screen.queryByText('Notify me')).toBeNull();
});

test('stopping keeps the line and hides the buttons', async () => {
  const view = await render(<Harness phase="rolling" count={1} />);
  await advance(7000);
  expect(screen.getByText('Keep waiting')).toBeTruthy();
  await view.rerender(<Harness phase="stopping" count={1} />);
  expect(screen.getByTestId('hint')).toHaveTextContent('Taking longer than usual. Your pull is safe.');
  expect(screen.queryByText('Keep waiting')).toBeNull();
});
