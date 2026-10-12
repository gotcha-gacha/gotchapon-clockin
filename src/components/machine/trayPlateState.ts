// Live status on the cream plate under the tray (#359). First match wins.
// `stopping` is the reel-lock between rolling and the drop: the mouth still
// holds the reels, so it stays on DISPENSING with them. `dropping` is the fall.
// The card is "up" once a ×1 capsule or its reveal is on stage.
// A ×5/×10 pile and its spread use the plural line (Ben, 1 Oct 2026, #389):
// the singular plate was up while the chute still read as one capsule.
import type { Phase } from '@/ritual/reducer';
import { pullsAvailable } from '@/api/contract';
import { PENDING_COUNT } from '@/format';
import { color } from '@/theme/tokens';

export const TRAY_DOT = {
  gold: color.yellow, // #FFD23F
  mint: color.mint, // #8FE3C5
  coral: color.danger, // #FF6B5B
} as const;

const DISPENSING: ReadonlySet<Phase> = new Set(['rolling', 'stopping', 'dropping']);
const CARD_UP: ReadonlySet<Phase> = new Set(['capsule', 'card']);
const PILE_UP: ReadonlySet<Phase> = new Set(['batchcaps', 'spread']);

export type TrayPlateState = {
  label: string;
  dot: string;
  /** Only this line opens Wallet. Every other line ignores a tap. */
  topUp: boolean;
};

/** Whole $1 pulls the balance covers. Free pulls are their own line, not added here. */
export function pullsLeft(balanceUsd: number): number {
  return Math.floor(balanceUsd);
}

export function trayPlateState(phase: Phase, balanceUsd: number, freePulls: number, balanceKnown = true, targeted = false): TrayPlateState {
  if (DISPENSING.has(phase)) return { label: 'DISPENSING\u2026', dot: TRAY_DOT.gold, topUp: false };
  if (PILE_UP.has(phase)) return { label: 'YOUR PILE IS UP', dot: TRAY_DOT.mint, topUp: false };
  if (CARD_UP.has(phase)) return { label: 'YOUR CARD IS UP', dot: TRAY_DOT.mint, topUp: false };
  // The session's balance starts at 0. Until /balance has landed that is not an empty wallet, and not "0 LEFT".
  if (!balanceKnown) return { label: PENDING_COUNT, dot: color.text3, topUp: false };
  // A chase is $1.50 and free pulls do not buy one, so the plate uses the same count as the dial.
  if (targeted) {
    const n = pullsAvailable(balanceUsd, freePulls, true);
    if (n <= 0) return { label: 'TOP UP \u00B7 $1.50 A TURN', dot: TRAY_DOT.coral, topUp: true };
    return { label: `TURN THE CRANK \u00B7 ${n} LEFT`, dot: TRAY_DOT.mint, topUp: false };
  }
  if (balanceUsd < 1 && freePulls <= 0) return { label: 'TOP UP \u00B7 $1 A TURN', dot: TRAY_DOT.coral, topUp: true };
  if (freePulls > 0) return { label: 'FREE TURN READY \u00B7 CRANK IT', dot: TRAY_DOT.mint, topUp: false };
  return { label: `TURN THE CRANK \u00B7 ${pullsLeft(balanceUsd)} LEFT`, dot: TRAY_DOT.mint, topUp: false };
}

/**
 * `pbFlicker` 2.4s: solid, then two short dips (93% → .6, 97% → .75).
 * Durations are the gaps between those stops, so they sum to the cycle.
 */
const FLICKER_STOPS = [
  [0.92, 1],
  [0.93, 0.6],
  [0.94, 1],
  [0.97, 0.75],
  [0.98, 1],
  [1, 1],
] as const;

export function plateFlickerSteps(cycleMs = 2400): { opacity: number; duration: number }[] {
  let prev = 0;
  return FLICKER_STOPS.map(([at, opacity]) => {
    const duration = Math.round((at - prev) * cycleMs);
    prev = at;
    return { opacity, duration };
  });
}
