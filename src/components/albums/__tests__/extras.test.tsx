// Extras card (F2.9): what counts as an extra, the count and progress to the next burn, nothing without extras.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Holding } from '@/api/contract';
import { ALBUMS } from '@/api/mock/fixtures';
import { EXTRAS_UNAVAILABLE, ExtrasCard, extrasIn } from '@/components/albums/ExtrasCard';
import { BurnGather, burnCopies } from '@/components/albums/BurnGather';

const [a, b, c] = ALBUMS[0].cards;
const holdings: Record<string, Holding> = {
  [a.id]: { cardId: a.id, qty: 3, rarity: 'common' },
  [b.id]: { cardId: b.id, qty: 1, rarity: 'common' },
  [`${c.id}#holo`]: { cardId: c.id, qty: 2, rarity: 'holo' }, // a rare line of the same card id is not a spare common
};

test('extras are copies beyond the first of a common', () => {
  expect(extrasIn(ALBUMS[0].cards, holdings)).toEqual([{ id: a.id, name: a.name, imgSmall: a.imgSmall, count: 2 }]);
});

test('the card shows the count and how many to go, reads ready at five, and hides with no extras', async () => {
  const extras = extrasIn(ALBUMS[0].cards, holdings);
  const { rerender } = await render(<ExtrasCard count={2} extras={extras} />);
  expect(screen.getByText('Extras · 2')).toBeTruthy();
  expect(screen.getByText('Burn 5 for a free pull · 3 to go')).toBeTruthy();
  expect(screen.getByText('×2')).toBeTruthy();
  expect(screen.getByLabelText(a.name)).toBeTruthy();
  await rerender(<ExtrasCard count={7} extras={extras} />);
  expect(screen.getByText('Burn 5 for a free pull — ready')).toBeTruthy();
  await rerender(<ExtrasCard count={0} extras={[]} />);
  expect(screen.queryByTestId('extras-card')).toBeNull();
});

test('five extras during a pull are not offered as a burn', async () => {
  await render(<ExtrasCard count={12} extras={[]} onBurn={() => {}} canBurn={false} />);
  expect(screen.getByText('Extras · 12')).toBeTruthy();
  expect(screen.getByText(EXTRAS_UNAVAILABLE)).toBeTruthy();
  expect(screen.queryByText('Burn 5 for a free pull — ready')).toBeNull();
  expect(screen.getByLabelText('Burn 5 extras for a free pull').props.accessibilityState).toMatchObject({ disabled: true });
});

test('the button arms only with five extras and an idle machine', async () => {
  const onBurn = jest.fn();
  const { rerender } = await render(<ExtrasCard count={4} extras={[]} onBurn={onBurn} canBurn />);
  await fireEvent.press(screen.getByLabelText('Burn 5 extras for a free pull'));
  await rerender(<ExtrasCard count={5} extras={[]} onBurn={onBurn} canBurn={false} />);
  await fireEvent.press(screen.getByLabelText('Burn 5 extras for a free pull'));
  expect(onBurn).not.toHaveBeenCalled();
  await rerender(<ExtrasCard count={5} extras={[]} onBurn={onBurn} canBurn />);
  await fireEvent.press(screen.getByLabelText('Burn 5 extras for a free pull'));
  expect(onBurn).toHaveBeenCalledTimes(1);
});

test('the hand-off lifts five copies, filling in from a card with several extras', async () => {
  const two = [{ id: 'a', name: 'A', imgSmall: 'https://img/a.png', count: 2 }, { id: 'b', name: 'B', imgSmall: 'https://img/b.png', count: 6 }];
  expect(burnCopies(two).map((c) => c.ref.id)).toEqual(['a', 'a', 'b', 'b', 'b']);
  await render(<BurnGather step="ignite" extras={two} from={null} />);
  expect(await screen.findAllByTestId('burn-copy')).toHaveLength(5); // an unmeasured shelf: the copies lift from the fallback
});
