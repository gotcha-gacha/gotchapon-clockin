import { expect, test } from '@jest/globals';
import { PAGE } from '@/state/session';
import { streakA11y, streakCopy, streakDots, streakPrimaryLabel, STREAK_RULES, ticketHot, ticketsA11y, tubeSpots } from './streakCopy';

const face = (count: number, countedToday: boolean, bonusJustEarned = false) => ({ count, countedToday, bonusJustEarned });

test('sheet copy follows the header brief', () => {
  expect(streakCopy(face(0, false))).toMatchObject({ title: 'Start a streak', aside: '5 days to +2 tickets', asideGold: false, status: 'Keep it with a $1 pull', showPrimary: true });
  expect(streakCopy(face(1, false))).toMatchObject({ title: 'Day 1 of 5', aside: '4 days to +2 tickets', status: 'Keep it with a $1 pull', showPrimary: true });
  expect(streakCopy(face(2, true))).toMatchObject({ title: 'Day 2 of 5', aside: '3 days to +2 tickets', status: 'Counted today · come back tomorrow', showPrimary: false });
  expect(streakCopy(face(3, false))).toMatchObject({ title: 'Day 3 of 5', aside: '2 days to +2 tickets', asideGold: false });
  expect(streakCopy(face(4, false))).toMatchObject({ title: 'Day 4 of 5', aside: '1 day to +2 tickets', asideGold: true, status: "+2 tickets with today's pull", showPrimary: true });
  expect(streakCopy(face(4, true))).toMatchObject({ title: 'Day 4 of 5', aside: '1 day to +2 tickets', asideGold: true, status: '+2 tickets tomorrow', showPrimary: false });
  expect(streakCopy(face(0, true, true))).toMatchObject({ title: 'Day 5 of 5', aside: '+2 tickets earned', asideGold: true, status: '+2 tickets earned · new cycle', showPrimary: false });
  expect(STREAK_RULES).toBe("One paid pull a day fills a capsule. The 5th day adds 2 raffle tickets, then the tube empties and starts again. Miss a day and it's back to day 0. Free pulls don't count.");
  expect(streakPrimaryLabel(PAGE.pull)).toBe('Turn the crank · $1');
  expect(streakPrimaryLabel(PAGE.albums)).toBe('Go pull · $1');
  expect(streakA11y(0)).toBe('Streak, day 0 of 5. Opens details.');
  expect(streakA11y(5)).toBe('Streak, day 5 of 5. Opens details.');
  expect(ticketsA11y(37)).toBe('37 raffle tickets. Opens raffle.');
});

test('the tube fills four capsules and lights the ticket on day 4 and the bonus day', () => {
  expect(tubeSpots(face(0, false))).toEqual(['today', 'future', 'future', 'future']);
  expect(tubeSpots(face(2, false))).toEqual(['filled', 'filled', 'today', 'future']);
  expect(tubeSpots(face(2, true))).toEqual(['filled', 'filled', 'future', 'future']);
  expect(tubeSpots(face(4, false))).toEqual(['filled', 'filled', 'filled', 'filled']);
  expect(tubeSpots(face(0, true, true))).toEqual(['future', 'future', 'future', 'future']);
  expect(ticketHot(face(3, false))).toBe(false);
  expect(ticketHot(face(4, true))).toBe(true);
  expect(ticketHot(face(0, true, true))).toBe(true);
  expect(streakDots(face(0, false))).toEqual(['next', 'future', 'future', 'future', 'future']);
  expect(streakDots(face(2, true))).toEqual(['done', 'done', 'future', 'future', 'future']);
  expect(streakDots(face(4, false))).toEqual(['done', 'done', 'done', 'done', 'next']);
  expect(streakDots(face(0, true, true))).toEqual(['done', 'done', 'done', 'done', 'done']);
});
