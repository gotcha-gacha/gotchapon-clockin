// Confetti (F3.4): the design's 26 pieces, five colours in turn, within its ranges; a burst per trigger, none before.
import { expect, test } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { CONFETTI_COLORS, Confetti, confettiPieces } from '@/components/reveal/Confetti';

test('26 pieces across the width, colours in turn, inside the design ranges, the same burst for the same seed', () => {
  const pieces = confettiPieces(370, 3);
  expect(pieces).toHaveLength(26);
  pieces.forEach((p, i) => {
    expect(p.color).toBe(CONFETTI_COLORS[i % 5]);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left).toBeLessThan(370);
    expect(p.fall).toBeGreaterThanOrEqual(380);
    expect(p.fall).toBeLessThanOrEqual(560);
    expect(p.spin).toBeGreaterThanOrEqual(360);
    expect(p.spin).toBeLessThanOrEqual(780);
    expect(p.dur).toBeGreaterThanOrEqual(1300);
    expect(p.dur).toBeLessThanOrEqual(2100);
    expect(p.delay).toBeGreaterThanOrEqual(0);
    expect(p.delay).toBeLessThanOrEqual(250);
  });
  expect(confettiPieces(370, 3)).toEqual(pieces);
  expect(confettiPieces(370, 4)).not.toEqual(pieces);
});

test('nothing before the first trigger, then a burst of 26', async () => {
  const { rerender } = await render(<Confetti trigger={0} width={370} />);
  expect(screen.queryAllByTestId('confetti-piece')).toHaveLength(0);
  await rerender(<Confetti trigger={1} width={370} />);
  expect(screen.getAllByTestId('confetti-piece')).toHaveLength(26);
});
