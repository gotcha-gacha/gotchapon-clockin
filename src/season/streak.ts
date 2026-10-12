// Paid streak (#376, #375). Keep in lockstep with server/src/season.ts (advancePaidStreak / visibleStreak / meStreakFrom).
// One calendar day is Malaysia (UTC+8), the same dayKey the server uses. The bonus is the locked
// grant: +2 raffle tickets once at 5, then the counter stores 0. It is not a per-pull multiplier.
import type { MeStreak } from '@/api/contract';

export const STREAK_DAYS = 5;
export const STREAK_BONUS_TICKETS = 2;

export type StreakState = { count: number; lastDay: string | null };
export type StreakView = { count: number; countedToday: boolean };
export type { MeStreak };

/** Next Malaysia (UTC+8) midnight, as UTC. The server is the one that decides whether a day counted. */
export function nextMytMidnight(now = Date.now()): string {
  const shifted = new Date(now + 8 * 3_600_000);
  const nextUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return new Date(nextUtc - 8 * 3_600_000).toISOString();
}

/** What a read shows. A last day that is neither today nor yesterday is already 0. */
export function visibleStreak(state: StreakState | null, today: string, yesterday: string): StreakView {
  if (!state?.lastDay) return { count: 0, countedToday: false };
  if (state.lastDay === today) return { count: state.count, countedToday: true };
  if (state.lastDay === yesterday) return { count: state.count, countedToday: false };
  return { count: 0, countedToday: false };
}

/**
 * True only on the Malaysia day a paid pull reached 5. That pull stores count 0 with lastDay today,
 * which is the only way a read is counted-today at 0. The header shows it as 5/5 until midnight.
 */
export function bonusJustEarned(state: StreakState | null, today: string, yesterday: string): boolean {
  const view = visibleStreak(state, today, yesterday);
  return view.countedToday && view.count === 0 && state?.lastDay === today;
}

export function meStreak(state: StreakState | null, today: string, yesterday: string, now = Date.now()): MeStreak {
  return { ...visibleStreak(state, today, yesterday), bonusJustEarned: bonusJustEarned(state, today, yesterday), resetsAt: nextMytMidnight(now) };
}

/** The pill's N. 5 on the bonus day, otherwise the stored count. */
export function displayStreakDay(streak: { count: number; bonusJustEarned: boolean }): number {
  return streak.bonusJustEarned ? STREAK_DAYS : streak.count;
}

/**
 * Next stored streak after a pull with at least one paid slot. Null when today already counted.
 * A miss (last day is not yesterday) starts again at 1. Reaching 5 stores 0 and grants the bonus.
 */
export function advancePaidStreak(state: StreakState | null, today: string, yesterday: string): { state: { count: number; lastDay: string }; bonus: number } | null {
  if (state?.lastDay === today) return null;
  const alive = state?.lastDay === yesterday ? state.count : 0;
  const next = alive + 1;
  if (next >= STREAK_DAYS) return { state: { count: 0, lastDay: today }, bonus: STREAK_BONUS_TICKETS };
  return { state: { count: next, lastDay: today }, bonus: 0 };
}
