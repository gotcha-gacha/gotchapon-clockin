// Result bar (F2.6 / F3.4): the result line wraps to a second line rather than cutting off a milestone at its end.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ResultBar } from '@/components/reveal/ResultBar';

test('a day-5 reveal puts the raffle chip under the subtitle', async () => {
  await render(<ResultBar chip="NEW" chipBg="#8FE3C5" chipInk="#0A2A1E" chipGlow="rgba(143,227,197,0.6)" title="New! Blitzle" sub="Slot 3 of 25" bonusChip="+2 raffle tickets · 5-day streak" canSettle onSettle={jest.fn()} />);
  expect(screen.getByText('+2 raffle tickets · 5-day streak')).toBeTruthy();
});

test('a long result keeps its milestone: the line may wrap to two lines', async () => {
  const sub = 'Slot 3 of 25 · Little Lanterns · 5/25!';
  await render(<ResultBar chip="NEW" chipBg="#8FE3C5" chipInk="#0A2A1E" chipGlow="rgba(143,227,197,0.6)" title="New! Blitzle" sub={sub} canSettle onSettle={jest.fn()} />);
  expect(screen.getByText(sub).props.numberOfLines).toBe(2);
});
