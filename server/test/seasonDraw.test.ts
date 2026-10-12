import { describe, expect, it } from 'vitest';
import {
  ONE_PRIZE_PER_BINDER, drawSeason, expandTicketBalances, ticketsEarnedForPull, type SeasonDrawPrize,
} from '../src/season';

const prizes: SeasonDrawPrize[] = [
  { slot: 'grand', cardId: 'grand' },
  { slot: 'mid', cardId: 'm1' },
  { slot: 'mid', cardId: 'm2' },
];

describe('season raffle draw', () => {
  it('counts one ticket per paid slot and none for a free slot', () => {
    expect(ticketsEarnedForPull({ count: 1, reserved_paid: 0, reserved_common: 0 })).toBe(1);
    expect(ticketsEarnedForPull({ count: 5, reserved_paid: 0, reserved_common: 0 })).toBe(5);
    expect(ticketsEarnedForPull({ count: 10, reserved_paid: 0, reserved_common: 0 })).toBe(10);
    // A targeted pull is one paid slot (reserved free stays 0).
    expect(ticketsEarnedForPull({ count: 1, reserved_paid: 0, reserved_common: 0 })).toBe(1);
    expect(ticketsEarnedForPull({ count: 5, reserved_paid: 2, reserved_common: 1 })).toBe(2);
    expect(ticketsEarnedForPull({ count: 1, reserved_paid: 0, reserved_common: 1 })).toBe(0);
    expect(ticketsEarnedForPull({ count: 10, reserved_paid: 0, reserved_common: 10 })).toBe(0);
  });

  it('gives one prize per binder, grand first, and stops when tickets are exhausted', () => {
    expect(ONE_PRIZE_PER_BINDER).toBe(true);
    const tickets = expandTicketBalances([{ binderId: 'A', tickets: 3 }, { binderId: 'B', tickets: 1 }]);
    const winners = drawSeason(prizes, tickets, () => 0);
    expect(winners.map((winner) => [winner.slot, winner.binderId])).toEqual([
      ['grand', 'A'],
      ['mid', 'B'],
    ]);
    expect(new Set(winners.map((winner) => winner.binderId)).size).toBe(winners.length);

    const solo = drawSeason(prizes, expandTicketBalances([{ binderId: 'A', tickets: 4 }]), () => 0);
    expect(solo).toEqual([{ slot: 'grand', cardId: 'grand', ticketNo: 1, binderId: 'A' }]);
  });
});
