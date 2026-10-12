// The shareable pull card (F2.11): what the capture contains — the card, its tier, where it is kept, and the mark.
import { expect, test } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { Outcome, Tier } from '@/api/contract';
import { SHARE_CAPTURE, SHARE_H, SHARE_W, ShareCard, shareLine } from '@/components/reveal/ShareCard';

const rare = (rarity: Tier): Outcome => ({
  cardId: 'pool-1',
  rarity,
  isDupe: false,
  card: { id: 'pool-1', name: 'Altaria', set: 'SV3', number: '100', imgSmall: '', imgLarge: '' },
});

test('a rare shows its tier, its name and where it is kept, over the Gotchapon mark', async () => {
  await render(<ShareCard outcome={rare('holo')} />);
  expect(screen.getByText('HOLO RARE')).toBeTruthy();
  expect(screen.getByText('Altaria')).toBeTruthy();
  expect(screen.getByText('Holo rare · kept in my rares')).toBeTruthy();
  expect(screen.getByLabelText('Gotchapon')).toBeTruthy();
  expect(screen.getByTestId('brand-mark-compact', { includeHiddenElements: true })).toBeTruthy();
});

// F2.11's fallback: the shader does not compile here (jest pins Skia's Make to null, as a device can too), so the sheen
// under it is what a capture would show.
test('a foil tier carries a static sheen under the foil; a common carries none', async () => {
  const { unmount } = await render(<ShareCard outcome={rare('holo')} />);
  expect(screen.getByTestId('share-sheen')).toBeTruthy();
  await unmount();
  await render(<ShareCard outcome={rare('common')} />);
  expect(screen.queryByTestId('share-sheen')).toBeNull();
});

test('the poster is 4:5 and the capture is that frame at 3×, 1080×1350', () => {
  expect(SHARE_W / SHARE_H).toBeCloseTo(4 / 5);
  expect(SHARE_CAPTURE).toEqual({ width: 1080, height: 1350 });
  // An integer scale: on a @3x phone the view's bitmap is already this size, and the resize is 1:1.
  expect(SHARE_CAPTURE.width / SHARE_W).toBe(3);
  expect(SHARE_CAPTURE.height / SHARE_H).toBe(3);
});

test('the poster view is that 4:5 frame', async () => {
  await render(<ShareCard outcome={rare('holo')} />);
  expect(StyleSheet.flatten(screen.getByTestId('share-poster').props.style)).toMatchObject({ width: SHARE_W, height: SHARE_H });
});

test('each shared tier names itself', () => {
  expect(shareLine(rare('holo'))).toBe('Holo rare · kept in my rares');
  expect(shareLine(rare('ultra'))).toBe('Ultra rare · kept in my rares');
  expect(shareLine(rare('graded'))).toBe('Graded slab · kept in my rares');
});
