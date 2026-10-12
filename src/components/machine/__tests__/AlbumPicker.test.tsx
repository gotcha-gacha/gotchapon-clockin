// Targeted-pull album picker (F2.8): the globe is the album, held-of-total counts, switching the chase, a complete album
// closed, nothing switching mid-pull.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Holding } from '@/api/contract';
import { ALBUMS } from '@/api/mock/fixtures';
import { AlbumPicker, targetCapsules } from '@/components/machine/AlbumPicker';
import { GLOBE_CAP } from '@/components/machine/CapsuleGlobe';

const [A, B] = ALBUMS;
const holdFirst = (cards: typeof A.cards, n: number): Record<string, Holding> => Object.fromEntries(cards.slice(0, n).map((c) => [c.id, { cardId: c.id, qty: 1 }]));

test('the chase globe is the album, capped, whether or not cards are already held', () => {
  expect(targetCapsules(A)).toBe(Math.min(A.size, GLOBE_CAP));
  expect(targetCapsules({ ...A, size: 5 })).toBe(5);
});

test('each album shows how much is held; tapping another switches the chase', async () => {
  const onPick = jest.fn();
  await render(<AlbumPicker albums={ALBUMS} holdings={holdFirst(A.cards, 20)} selectedId={A.id} onPick={onPick} />);
  await fireEvent.press(screen.getByLabelText(`${A.title}, 20 of ${A.size}`)); // already the chase
  await fireEvent.press(screen.getByLabelText(`${B.title}, 0 of ${B.size}`));
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledWith(B.id);
});

test('a complete album cannot be chased, and nothing switches while a pull is under way', async () => {
  const onPick = jest.fn();
  const { rerender } = await render(<AlbumPicker albums={ALBUMS} holdings={{ ...holdFirst(A.cards, 1), ...holdFirst(B.cards, B.size) }} selectedId={A.id} onPick={onPick} />);
  await fireEvent.press(screen.getByLabelText(`${B.title}, complete`));
  await rerender(<AlbumPicker albums={ALBUMS} holdings={{}} selectedId={A.id} disabled onPick={onPick} />);
  await fireEvent.press(screen.getByLabelText(`${B.title}, 0 of ${B.size}`));
  expect(onPick).not.toHaveBeenCalled();
});
