// Copy for the streak sheet and the day-5 chip. The strings are the header brief's; do not reword them.
import { PAGE, type PageIndex } from '@/state/session';

export const STREAK_RULES = "One paid pull a day fills a capsule. The 5th day adds 2 raffle tickets, then the tube empties and starts again. Miss a day and it's back to day 0. Free pulls don't count.";
export const STREAK_BONUS_CHIP = '+2 raffle tickets · 5-day streak';

export type StreakFace = { count: number; countedToday: boolean; bonusJustEarned: boolean };

export type StreakCopy = {
  title: string;
  aside: string;
  asideGold: boolean;
  status: string;
  showPrimary: boolean;
};

export function streakCopy(streak: StreakFace): StreakCopy {
  if (streak.bonusJustEarned) {
    return {
      title: 'Day 5 of 5',
      aside: '+2 tickets earned',
      asideGold: true,
      status: '+2 tickets earned · new cycle',
      showPrimary: false,
    };
  }
  const n = streak.count;
  let title = 'Start a streak';
  let aside = '5 days to +2 tickets';
  if (n >= 1 && n <= 3) {
    title = `Day ${n} of 5`;
    aside = `${5 - n} days to +2 tickets`;
  } else if (n === 4) {
    title = 'Day 4 of 5';
    aside = '1 day to +2 tickets';
  }
  let status = "Keep it with a $1 pull";
  if (!streak.countedToday) status = n === 4 ? "+2 tickets with today's pull" : "Keep it with a $1 pull";
  else if (n === 4) status = '+2 tickets tomorrow';
  else status = 'Counted today · come back tomorrow';
  return { title, aside, asideGold: n === 4, status, showPrimary: !streak.countedToday };
}

export function streakPrimaryLabel(page: PageIndex): string {
  return page === PAGE.pull ? 'Turn the crank · $1' : 'Go pull · $1';
}

export type TubeSpot = 'filled' | 'today' | 'future';

/** Four capsule spots. Day 5 is the ticket, not a fifth capsule, and a bonus day has emptied the tube. */
export function tubeSpots(streak: StreakFace): TubeSpot[] {
  if (streak.bonusJustEarned) return ['future', 'future', 'future', 'future'];
  return [0, 1, 2, 3].map((i): TubeSpot => {
    if (i < streak.count) return 'filled';
    if (!streak.countedToday && i === streak.count) return 'today';
    return 'future';
  });
}

export function ticketHot(streak: StreakFace): boolean {
  return streak.bonusJustEarned || streak.count === 4;
}

export type StreakDot = 'done' | 'next' | 'future';

export function streakDots(streak: StreakFace): StreakDot[] {
  const filled = streak.bonusJustEarned ? 5 : streak.count;
  const next = !streak.countedToday && !streak.bonusJustEarned ? streak.count : -1;
  return [0, 1, 2, 3, 4].map((i): StreakDot => (i < filled ? 'done' : i === next ? 'next' : 'future'));
}

export function streakA11y(day: number): string {
  return `Streak, day ${day} of 5. Opens details.`;
}

export function ticketsA11y(count: number): string {
  return `${count} raffle tickets. Opens raffle.`;
}
