// Season One raffle (6a) and the paid streak (#375). The albums page polls on focus; a commit's
// ticket grant waits for the reveal so the header pill pops with the card, not during the roll.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { api } from '@/api';
import type { MeStreak, Season, SeasonStreak } from '@/api/contract';
import { parseSeason, parseStreak } from '@/season/parse';
import { nextMytMidnight } from '@/season/streak';

export type PullGrant = {
  ticketsEarned: number;
  streakBonus: 0 | 2;
  myTickets: number;
  streak: SeasonStreak;
};

type PendingGrant = PullGrant & { shown: boolean };

type SeasonHandle = {
  season: Season | null;
  streak: MeStreak | null;
  /** Tickets on the header pill. A revealed grant leads the last GET /season until the next refresh. */
  tickets: number;
  /** Bumps when a revealed pull added tickets, so the pill pops once. */
  popToken: number;
  /** Bumps when the header asks Albums to show the raffle at the top. */
  raffleFocus: number;
  refresh: () => Promise<void>;
  noteGrant: (grant: PullGrant) => void;
  revealGrant: () => void;
  focusRaffle: () => void;
};

const Ctx = createContext<SeasonHandle | null>(null);

export function SeasonProvider({ children }: { children: React.ReactNode }) {
  const [season, setSeason] = useState<Season | null>(null);
  const [streak, setStreak] = useState<MeStreak | null>(null);
  const [ticketOverride, setTicketOverride] = useState<number | null>(null);
  const [popToken, setPopToken] = useState(0);
  const [raffleFocus, setRaffleFocus] = useState(0);
  const pending = useRef<PendingGrant | null>(null);
  const gen = useRef(0);

  const refresh = useCallback(async () => {
    const at = gen.current;
    try {
      const [seasonBody, streakBody] = await Promise.all([api.season(), api.streak()]);
      if (gen.current !== at) return;
      setSeason(parseSeason(seasonBody));
      setStreak(parseStreak(streakBody));
      setTicketOverride(null);
    } catch {
      // A failed poll keeps the last good body. The module stays hidden until the first one parses.
    }
  }, []);

  const noteGrant = useCallback((grant: PullGrant) => {
    const prev = pending.current;
    if (prev?.shown && prev.myTickets === grant.myTickets && prev.ticketsEarned === grant.ticketsEarned && prev.streakBonus === grant.streakBonus) return;
    pending.current = { ...grant, shown: false };
  }, []);

  const revealGrant = useCallback(() => {
    const grant = pending.current;
    if (!grant || grant.shown) return;
    grant.shown = true;
    gen.current += 1;
    setSeason((prev) => (prev ? {
      ...prev,
      myTickets: grant.myTickets,
      streak: { count: grant.streak.count, countedToday: grant.streak.countedToday },
    } : prev));
    setStreak({
      count: grant.streak.count,
      countedToday: grant.streak.countedToday,
      bonusJustEarned: grant.streak.countedToday && grant.streak.count === 0,
      resetsAt: nextMytMidnight(),
    });
    setTicketOverride(grant.myTickets);
    if (grant.ticketsEarned > 0 || grant.streakBonus > 0) setPopToken((n) => n + 1);
  }, []);

  const focusRaffle = useCallback(() => setRaffleFocus((n) => n + 1), []);

  const tickets = ticketOverride ?? season?.myTickets ?? 0;
  const value = useMemo(() => ({
    season, streak, tickets, popToken, raffleFocus, refresh, noteGrant, revealGrant, focusRaffle,
  }), [season, streak, tickets, popToken, raffleFocus, refresh, noteGrant, revealGrant, focusRaffle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSeason(): SeasonHandle {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSeason outside SeasonProvider');
  return value;
}
