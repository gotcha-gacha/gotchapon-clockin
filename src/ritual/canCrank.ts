// The session's side of "may this machine be turned?" (W1.2, #124): one answer for the hand on the crank and for the space
// bar. It used to live inside Machine.tsx's `enabled` alone, which is exactly how a keyboard would have ended up with rules
// of its own. The reducer's `canStart` knows only the phase and the takeover; the money is here.
//
// Not here, on purpose: WHICH phases a turn may happen in. That differs by who is asking: a hand stays on a crank through
// `preparing` and `armed` (it is mid-turn), while a key press in those phases must do nothing (a turn is already under way).
// Each caller puts its own phase rule on top of this.
import type { Phase } from './reducer';

export type CrankGates = {
  phase: Phase;
  /** The balance and free pulls cover the pull the machine is set to (×1 / ×5 / ×10, or a chase at N × $1.50). */
  affordable: boolean;
  /** Nothing in stock: depositing would not help, and the machine rests. */
  restocking: boolean;
  /** The album-complete takeover is up: no pull or burn starts behind it. */
  takeover: boolean;
  /** Pull is the page on screen. */
  active: boolean;
};

export function canCrank(g: CrankGates): boolean {
  if (g.takeover || !g.active) return false;
  if (g.phase === 'coined') return true; // a burned pull is loaded: free, whatever the balance or the stock says
  return !g.restocking && g.affordable;
}

/** A turn that has already started stays affordable. Prepare reserves its free pulls at once, and taking them off the
 *  counter must not spring the crank back before the hand finishes the turn. */
export function crankAffordable(phase: Phase, canAfford: boolean): boolean {
  return canAfford || phase === 'preparing' || phase === 'armed';
}
