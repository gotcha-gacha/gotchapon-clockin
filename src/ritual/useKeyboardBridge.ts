// The keyboard drives the machine on the web only (useKeyboardBridge.web.ts; W1.2, #124). A phone has no space bar: nothing here.
import type { Phase } from './reducer';
import type { PageIndex } from '@/state/session';

export type KeyboardBridge = {
  /** Signed in and past onboarding: before that every key is the browser's. */
  enabled: boolean;
  phase: Phase;
  /** `canCrank()`: the same session gates the hand crank answers to. */
  canCrank: boolean;
  page: PageIndex;
  setPage: (p: PageIndex) => void;
  pagerLocked: boolean;
  oddsOpen: boolean;
  openOdds: () => void;
  /** The crank's own turn (Crank's handle): false when it refused. */
  autoCrank: () => boolean;
  openCapsule: () => void;
  openPile: () => void;
};

export function useKeyboardBridge(_bridge: KeyboardBridge): void {}

/** Escape closes a surface that is not a Modal (album detail): react-native-web handles Escape for Modals itself. Web only. */
export function useEscapeToClose(_open: boolean, _close: () => void): void {}
