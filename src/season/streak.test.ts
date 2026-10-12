import { expect, test } from '@jest/globals';
import { advancePaidStreak, bonusJustEarned, displayStreakDay, nextMytMidnight, visibleStreak, type StreakState } from './streak';

const today = '2026-09-30';
const yesterday = '2026-09-29';

test('advances by one on a new day and stays put once today has counted', () => {
  const first = advancePaidStreak(null, today, yesterday);
  expect(first).toEqual({ state: { count: 1, lastDay: today }, bonus: 0 });
  expect(visibleStreak(first!.state, today, yesterday)).toEqual({ count: 1, countedToday: true });
  expect(advancePaidStreak(first!.state, today, yesterday)).toBeNull();
});

test('keeps a streak that counted yesterday and resets when a day was missed', () => {
  const held: StreakState = { count: 3, lastDay: yesterday };
  expect(visibleStreak(held, today, yesterday)).toEqual({ count: 3, countedToday: false });
  expect(advancePaidStreak(held, today, yesterday)).toEqual({ state: { count: 4, lastDay: today }, bonus: 0 });
  const missed: StreakState = { count: 4, lastDay: '2026-09-20' };
  expect(visibleStreak(missed, today, yesterday)).toEqual({ count: 0, countedToday: false });
  expect(advancePaidStreak(missed, today, yesterday)).toEqual({ state: { count: 1, lastDay: today }, bonus: 0 });
});

test('the bonus day is counted-today at 0, and the pill shows 5 until midnight', () => {
  const hit: StreakState = { count: 0, lastDay: today };
  expect(bonusJustEarned(hit, today, yesterday)).toBe(true);
  expect(displayStreakDay({ count: 0, bonusJustEarned: true })).toBe(5);
  expect(bonusJustEarned({ count: 0, lastDay: yesterday }, today, yesterday)).toBe(false);
  expect(bonusJustEarned({ count: 4, lastDay: today }, today, yesterday)).toBe(false);
  expect(displayStreakDay({ count: 4, bonusJustEarned: false })).toBe(4);
  expect(nextMytMidnight(Date.parse('2026-10-01T07:00:00.000Z'))).toBe('2026-10-01T16:00:00.000Z');
});

test('grants two tickets once at 5 and stores 0', () => {
  const atFour: StreakState = { count: 4, lastDay: yesterday };
  const hit = advancePaidStreak(atFour, today, yesterday);
  expect(hit).toEqual({ state: { count: 0, lastDay: today }, bonus: 2 });
  expect(visibleStreak(hit!.state, today, yesterday)).toEqual({ count: 0, countedToday: true });
  expect(advancePaidStreak(hit!.state, today, yesterday)).toBeNull();
});
