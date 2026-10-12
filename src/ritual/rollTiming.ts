// Pull-wait timings from the design handoff (pull_wait_spec): the stop sequence, then the capsule
// drops. Copy thresholds are the hint under the machine. The host owns the clock; this file is pure.
// Soft launch ships dome orbit rings and the three tray reels together (#358).

/** The dome layer. `churn` is orbit rings. Tray reels mount in the mouth beside them. */
export const PULL_WAIT = 'churn' as const;

export const SLOW1_MS = 2600;
export const SLOW2_MS = 7000;
export const STUCK_MS = 30_000;
/**
 * Minimum time on `rolling` after crank release, before the stop handoff.
 * Measured before any floor: a fast pull left `rolling` when commit's holdings
 * read returned — the in-app mock sleeps 120ms for the commit and 120ms for
 * holdings, about 240ms — then the stop. ×1 adds no hold: the stop is the
 * handoff, and it is the short one. ×5 holds a fast answer for 800ms, the
 * middle of the old 1400. ×10 adds no hold (a fast server is not padded) and
 * keeps the full stop, so it does not finish ahead of ×1.
 * A chase uses the same floor as a $1 pull of that size.
 * Reduced motion uses the same floors; the stop scales by half.
 */
export const ROLL_FLOOR_X1_MS = 0;
export const ROLL_FLOOR_X5_MS = 800;
export const ROLL_FLOOR_X10_MS = 0;

/** `count` is the pull size. A chase follows the same floors. */
export function rollFloorMs(count: number): number {
  if (count < 5) return ROLL_FLOOR_X1_MS;
  if (count < 10) return ROLL_FLOOR_X5_MS;
  return ROLL_FLOOR_X10_MS;
}
/** Retry POST /pulls/commit after a lost answer. There is no GET /pull/:id. */
export const POLL_MS = 1200;
/** ×5 and ×10. Three locks, a shimmer, then the phase ends once the ring flash (450ms) has finished. */
export const LOCK_MS = [0, 160, 320] as const;
export const SHIMMER_MS = 340;
export const STOP_MS = 600;
export const RING_FLASH_MS = 450;
/**
 * ×1, including a ×1 chase. The same three locks, packed. The flash has to finish
 * before `stopMs` or the dome unmounts mid-fade. Reduced motion halves both.
 */
export const LOCK_MS_X1 = [0, 80, 160] as const;
export const SHIMMER_MS_X1 = 180;
export const RING_FLASH_MS_X1 = 260;
export const STOP_MS_X1 = 320;

export type StopPlan = {
  lockMs: readonly [number, number, number];
  shimmerMs: number;
  stopMs: number;
  flashMs: number;
};

/** Stop handoff for a pull. A chase follows the same plan as that size. */
export function stopPlan(count: number): StopPlan {
  if (count < 5) {
    return { lockMs: LOCK_MS_X1, shimmerMs: SHIMMER_MS_X1, stopMs: STOP_MS_X1, flashMs: RING_FLASH_MS_X1 };
  }
  return { lockMs: LOCK_MS, shimmerMs: SHIMMER_MS, stopMs: STOP_MS, flashMs: RING_FLASH_MS };
}

export const DROP_MS = 520;
/** Second confetti shower when a batch lands at least four new cards. */
export const CONFETTI_AGAIN_MS = 380;

export const REEL_COLORS = ['#7487B0', '#8FE3C5', '#5BB8FF', '#FFD700', '#FF6B9E'] as const;

export type RollChoice = 'keep' | 'notify' | null;

const SLOW2 = 'Taking longer than usual. Your pull is safe.';

/** Hint line for a pull that has been in `rolling` for `elapsedMs`. `stuck` (30s) overrides Keep waiting and Notify me. */
export function rollHint(count: number, elapsedMs: number, choice: RollChoice, stuck: boolean): { text: string; actions: boolean } {
  if (stuck) return { text: SLOW2, actions: true };
  if (choice === 'keep') return { text: 'Nearly there…', actions: false };
  if (choice === 'notify') return { text: "We'll ping you — it lands in your binder either way.", actions: false };
  if (elapsedMs >= SLOW2_MS) return { text: SLOW2, actions: true };
  if (elapsedMs >= SLOW1_MS) return { text: 'Still rolling — your pull is locked in.', actions: false };
  const n = count > 1 ? count : 1;
  return { text: n > 1 ? `Rolling ${n} cards…` : 'Rolling your card…', actions: false };
}
