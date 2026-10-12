import { expect, test } from '@jest/globals';
import { pullSnow, snowCount } from './snow';

const card = (isDupe: boolean, rarity = 'common') => ({ isDupe, rarity });

test('a new card snows, and so does a rare that is new', () => {
  expect(pullSnow([card(false)])).toBe(true);
  expect(pullSnow([card(false, 'holo')])).toBe(true);
  expect(snowCount([card(false), card(false), card(true), card(false, 'reverse')])).toBe(3);
});

test('an all-duplicate pull does not snow, rare or not', () => {
  expect(pullSnow([card(true)])).toBe(false);
  expect(pullSnow([card(true), card(true), card(true, 'ultra')])).toBe(false);
  expect(snowCount([])).toBe(0);
});

test('four new-or-rare cards is the second shower; a duplicate rare in a mixed pull still counts', () => {
  expect(snowCount([card(false), card(false), card(false), card(true, 'holo')])).toBe(4);
  expect(snowCount([card(false), card(false), card(true)])).toBe(2);
});
