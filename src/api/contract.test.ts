// Contract helpers the client builds state with. The holdings index is the one rule every screen reads.
import { expect, test } from '@jest/globals';
import { indexHoldings } from './contract';

test('lines for one card without rarity are merged, never overwritten', () => {
  const idx = indexHoldings([
    { cardId: 'sv3-76', qty: 1, itemIds: ['item-1'], serials: ['ULTRA-1000'] },
    { cardId: 'sv3-76', qty: 3, itemIds: ['item-2', 'item-3', 'item-4'] },
  ]);
  expect(Object.keys(idx)).toEqual(['sv3-76']);
  expect(idx['sv3-76']).toMatchObject({
    qty: 4, itemIds: ['item-1', 'item-2', 'item-3', 'item-4'], serials: ['ULTRA-1000'],
  });
  expect(idx['sv3-76'].rarity).toBeUndefined();
});

test('a common line and a rarity-less line of the same card merge into one line of unknown rarity', () => {
  const idx = indexHoldings([{ cardId: 'sv3-76', qty: 2, rarity: 'common' }, { cardId: 'sv3-76', qty: 1 }]);
  expect(idx['sv3-76']).toMatchObject({ qty: 3 });
  expect(idx['sv3-76'].rarity).toBeUndefined();
});

test('tiered lines stay separate, commons keep the bare id, and depleted lines are dropped', () => {
  const idx = indexHoldings([
    { cardId: 'X', qty: 1, rarity: 'ultra' },
    { cardId: 'X', qty: 1, rarity: 'graded' },
    { cardId: 'Y', qty: 0, rarity: 'holo' },
    { cardId: 'Z', qty: 2, rarity: 'common' },
  ]);
  expect(Object.keys(idx).sort()).toEqual(['X#graded', 'X#ultra', 'Z']);
});
