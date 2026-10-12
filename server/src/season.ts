// Season One raffle 6a (docs/season_raffle_6a.md). Soft-launch stub: tickets accrue on
// paid pulls; the five slabs are not stock and are not bought here.
// Multi-win is closed (Ben, 30 Sept 2026): one prize per binder. Not a flag.
// Paid streak (#376, #375): keep advancePaidStreak / visibleStreak / meStreakFrom in lockstep with src/season/streak.ts.
import { dayKey } from './db';

export const SEASON_ID = 'season-one';
export const SEASON_TITLE = 'Season One raffle';
/** End of 30 Nov 2026 in Malaysia (UTC+8), set by Ben on 10 Oct; the soft launch's draw date until the real season is scheduled. */
export const SEASON_DRAW_AT = '2026-11-30T16:00:00.000Z';

/** One prize per binder. Flipping this does not enable a second algorithm — the draw refuses. */
export const ONE_PRIZE_PER_BINDER = true;

export type SeasonPrize = {
  slot: 'grand' | 'mid';
  cardId: string;
  name: string;
  set: string;
  number: string;
  grade: 'PSA 10';
  cert: string;
  /** Soft-launch official face. Same images.pokemontcg.io hires path as album cards. Vault slab photos replace it. */
  photo: string;
};

/** Keep in lockstep with src/season/catalog.ts. Underwrite dollars live in docs/season_raffle_6a.md and are not served. */
export const SEASON_PRIZES: readonly SeasonPrize[] = [
  { slot: 'grand', cardId: 'sv8-238', name: 'Pikachu ex SIR', set: 'Surging Sparks', number: '238', grade: 'PSA 10', cert: '10000238', photo: 'https://images.pokemontcg.io/sv8/238_hires.png' },
  { slot: 'mid', cardId: 'sv3-223', name: 'Charizard ex SIR', set: 'Obsidian Flames', number: '223', grade: 'PSA 10', cert: '10000223', photo: 'https://images.pokemontcg.io/sv3/223_hires.png' },
  { slot: 'mid', cardId: 'swsh7-218', name: 'Rayquaza VMAX (alt art)', set: 'Evolving Skies', number: '218', grade: 'PSA 10', cert: '10000218', photo: 'https://images.pokemontcg.io/swsh7/218_hires.png' },
  { slot: 'mid', cardId: 'sv8-239', name: 'Latias ex SIR', set: 'Surging Sparks', number: '239', grade: 'PSA 10', cert: '10000239', photo: 'https://images.pokemontcg.io/sv8/239_hires.png' },
  { slot: 'mid', cardId: 'swsh11-180', name: 'Aerodactyl V (alt art)', set: 'Lost Origin', number: '180', grade: 'PSA 10', cert: '10000180', photo: 'https://images.pokemontcg.io/swsh11/180_hires.png' },
];

/**
 * Tickets a committed pull earns. One per paid slot: ×5 paid = 5, ×10 paid = 10.
 * A chase spends no free slots, so a $1.50 ×1 earns 1 and a ×5 earns 5. Free slots (a burn credit)
 * are `reserved_paid` + `reserved_common` and earn 0. Partner claims are not pulls.
 * The streak bonus is not part of this count.
 */
export function ticketsEarnedForPull(pull: { count: number; reserved_paid: number; reserved_common: number }): number {
  const paidSlots = pull.count - pull.reserved_paid - pull.reserved_common;
  return paidSlots > 0 ? paidSlots : 0;
}

/** Days in one cycle. Hitting this grants the bonus and stores 0. */
export const STREAK_DAYS = 5;
/** Raffle tickets granted once, on the pull that reaches STREAK_DAYS. Not per pull, and not ×N. */
export const STREAK_BONUS_TICKETS = 2;

export type StreakState = { count: number; lastDay: string | null };
export type StreakView = { count: number; countedToday: boolean };
/** GET /me/streak. Keep in lockstep with src/season/streak.ts (meStreak / nextMytMidnight / bonusJustEarned). */
export type MeStreak = StreakView & { bonusJustEarned: boolean; resetsAt: string };

/** Next Malaysia (UTC+8) midnight, as UTC. */
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

/** True only on the Malaysia day a paid pull reached 5 (stored count 0, last day today). */
export function bonusJustEarned(state: StreakState | null, today: string, yesterday: string): boolean {
  const view = visibleStreak(state, today, yesterday);
  return view.countedToday && view.count === 0 && state?.lastDay === today;
}

export function meStreakFrom(state: StreakState | null, today: string, yesterday: string, now = Date.now()): MeStreak {
  return { ...visibleStreak(state, today, yesterday), bonusJustEarned: bonusJustEarned(state, today, yesterday), resetsAt: nextMytMidnight(now) };
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

export async function readStreak(db: D1Database, userId: string): Promise<StreakState | null> {
  const row = await db.prepare('SELECT count, last_day FROM season_streaks WHERE user_id = ? AND season_id = ?')
    .bind(userId, SEASON_ID).first<{ count: number; last_day: string }>();
  return row ? { count: row.count, lastDay: row.last_day } : null;
}

/** GET /me/streak. The day boundary is Malaysia (UTC+8), decided here. */
export async function meStreak(db: D1Database, userId: string, now = new Date()): Promise<MeStreak> {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  return meStreakFrom(await readStreak(db, userId), today, yesterday, now.getTime());
}

/** Streak write for the commit batch. The grant id is one per binder per day, so a hit-5 cannot insert twice. */
export function seasonStreakStatements(
  db: D1Database,
  userId: string,
  pullId: string,
  next: { state: { count: number; lastDay: string }; bonus: number },
  at: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO season_streaks (user_id, season_id, count, last_day) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, season_id) DO UPDATE SET count = excluded.count, last_day = excluded.last_day
      WHERE season_streaks.last_day IS NULL OR season_streaks.last_day <> excluded.last_day`)
      .bind(userId, SEASON_ID, next.state.count, next.state.lastDay),
  ];
  if (next.bonus <= 0) return statements;
  const id = `streak:${SEASON_ID}:${userId}:${next.state.lastDay}`;
  statements.push(
    db.prepare(`INSERT INTO season_streak_grants (id, user_id, season_id, day, tickets, pull_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, userId, SEASON_ID, next.state.lastDay, next.bonus, pullId, at),
    db.prepare(`INSERT INTO season_ticket_balances (user_id, season_id, tickets) VALUES (?, ?, ?)
      ON CONFLICT(user_id, season_id) DO UPDATE SET tickets = tickets + excluded.tickets`)
      .bind(userId, SEASON_ID, next.bonus),
  );
  return statements;
}

export type SeasonTicket = { ticketNo: number; binderId: string };
export type SeasonDrawPrize = { slot: 'grand' | 'mid'; cardId: string };
export type SeasonDrawWinner = { slot: 'grand' | 'mid'; cardId: string; ticketNo: number; binderId: string };

/** Expand stored balances into numbered tickets. Caller order is the numbering order. */
export function expandTicketBalances(balances: readonly { binderId: string; tickets: number }[]): SeasonTicket[] {
  const tickets: SeasonTicket[] = [];
  let n = 1;
  for (const row of balances) {
    for (let i = 0; i < row.tickets; i++) tickets.push({ ticketNo: n++, binderId: row.binderId });
  }
  return tickets;
}

/**
 * Grand prize first, then each following prize. One prize per binder: a drawn ticket
 * whose binder already won is skipped and consumed, and the draw continues until a
 * different binder wins or no tickets remain. `randomIndex(length)` is an integer in
 * [0, length). The results screen calls this later; the stub does not run a draw.
 */
export function drawSeason(
  prizes: readonly SeasonDrawPrize[],
  tickets: readonly SeasonTicket[],
  randomIndex: (length: number) => number,
): SeasonDrawWinner[] {
  if (!ONE_PRIZE_PER_BINDER) throw new Error('Season draw is one prize per binder');
  const pool = tickets.slice();
  const won = new Set<string>();
  const winners: SeasonDrawWinner[] = [];
  for (const prize of prizes) {
    while (pool.length > 0) {
      const index = randomIndex(pool.length);
      if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new Error('draw index');
      const [drawn] = pool.splice(index, 1);
      if (won.has(drawn.binderId)) continue;
      won.add(drawn.binderId);
      winners.push({ slot: prize.slot, cardId: prize.cardId, ticketNo: drawn.ticketNo, binderId: drawn.binderId });
      break;
    }
  }
  return winners;
}

export async function seasonTicketCount(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT tickets FROM season_ticket_balances WHERE user_id = ? AND season_id = ?')
    .bind(userId, SEASON_ID).first<{ tickets: number }>();
  return row?.tickets ?? 0;
}

/** Grant rows for the commit batch. A zero earn writes nothing; the pull id keeps a replay from adding twice. */
export function seasonTicketStatements(db: D1Database, userId: string, pullId: string, earned: number, at: string): D1PreparedStatement[] {
  if (earned <= 0) return [];
  return [
    db.prepare(`INSERT INTO season_ticket_grants (pull_id, user_id, season_id, tickets, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(pullId, userId, SEASON_ID, earned, at),
    db.prepare(`INSERT INTO season_ticket_balances (user_id, season_id, tickets) VALUES (?, ?, ?)
      ON CONFLICT(user_id, season_id) DO UPDATE SET tickets = tickets + excluded.tickets`)
      .bind(userId, SEASON_ID, earned),
  ];
}

export async function seasonView(db: D1Database, userId: string) {
  const today = dayKey();
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  return {
    id: SEASON_ID,
    title: SEASON_TITLE,
    drawAt: SEASON_DRAW_AT,
    prizes: SEASON_PRIZES,
    myTickets: await seasonTicketCount(db, userId),
    streak: visibleStreak(await readStreak(db, userId), today, yesterday),
  };
}
