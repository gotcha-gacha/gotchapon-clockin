// Whether the app itself is on screen, as Home decides it (W2.1, #128; PR #165's review). The sheet routes (`/odds`,
// `/card/:id`) sit over the app, so they may only show while the app does. They read Home's own decision here rather than
// re-deriving it: `useActiveTab()` starts a Web Lock watcher per call, so a second caller would make the tab compete with
// itself. `wait`: not yet (signed out, onboarding, still asking whether another tab is active): a sheet cold-loaded then comes
// back once it is `show`. `never`: another tab has the machine, or the country is closed: a sheet on screen steps back and
// stays gone. (A sheet address cold-loaded while this tab was still deciding was left for later then, and comes back if this
// tab becomes the active one: the collector asked for it, then chose this tab.)
import { useSyncExternalStore } from 'react';
import type { TabRole } from '@/state/activeTab.types';

export type AppGate = 'show' | 'wait' | 'never';

export function appGateOf(s: { authStage: string; tabRole: TabRole; blocked: boolean }): AppGate {
  if (s.authStage === 'idle' || s.authStage === 'busy') return 'wait';
  if (s.tabRole === 'other') return 'never';
  if (s.tabRole === 'deciding') return 'wait';
  if (s.blocked) return 'never';
  return s.authStage === 'done' ? 'show' : 'wait'; // onboarding is drawn over the app: a sheet waits for it to finish
}

let gate: AppGate = 'wait';
const listeners = new Set<() => void>();
/** The gate as it stands, outside React (tests, and anything that reads it once). */
export function currentAppGate(): AppGate { return gate; }
export function setAppGate(g: AppGate): void { if (g !== gate) { gate = g; listeners.forEach((l) => l()); } }
export function useAppGate(): AppGate {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => gate, () => 'wait');
}
