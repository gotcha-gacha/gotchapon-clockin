// Season One raffle stub (docs/season_raffle_6a.md). Keep the prize rows in lockstep with server/src/season.ts.
import type { SeasonPrize } from '@/api/contract';

export const SEASON_ID = 'season-one';
export const SEASON_TITLE = 'Season One raffle';
/** End of 30 Nov 2026 in Malaysia (UTC+8), set by Ben on 10 Oct. Keep equal to server/src/season.ts. */
export const SEASON_DRAW_AT = '2026-11-30T16:00:00.000Z';
/**
 * Official faces for the soft-launch stub. Same host and `_hires.png` path as album `imgLarge`
 * (`https://images.pokemontcg.io/{set}/{number}_hires.png`). Vault PSA photos replace these later.
 * Prize dollars stay in docs/season_raffle_6a.md and are not on this row.
 */
export const SEASON_PRIZES: readonly SeasonPrize[] = [
  { slot: 'grand', cardId: 'sv8-238', name: 'Pikachu ex SIR', set: 'Surging Sparks', number: '238', grade: 'PSA 10', cert: '10000238', photo: 'https://images.pokemontcg.io/sv8/238_hires.png' },
  { slot: 'mid', cardId: 'sv3-223', name: 'Charizard ex SIR', set: 'Obsidian Flames', number: '223', grade: 'PSA 10', cert: '10000223', photo: 'https://images.pokemontcg.io/sv3/223_hires.png' },
  { slot: 'mid', cardId: 'swsh7-218', name: 'Rayquaza VMAX (alt art)', set: 'Evolving Skies', number: '218', grade: 'PSA 10', cert: '10000218', photo: 'https://images.pokemontcg.io/swsh7/218_hires.png' },
  { slot: 'mid', cardId: 'sv8-239', name: 'Latias ex SIR', set: 'Surging Sparks', number: '239', grade: 'PSA 10', cert: '10000239', photo: 'https://images.pokemontcg.io/sv8/239_hires.png' },
  { slot: 'mid', cardId: 'swsh11-180', name: 'Aerodactyl V (alt art)', set: 'Lost Origin', number: '180', grade: 'PSA 10', cert: '10000180', photo: 'https://images.pokemontcg.io/swsh11/180_hires.png' },
];

/** Paid slots earn one ticket each. A chase spends no free slots, so every chase slot is paid. Free slots earn none. */
export function ticketsEarnedForPull(count: number, reservedFree: number): number {
  const paidSlots = count - reservedFree;
  return paidSlots > 0 ? paidSlots : 0;
}
