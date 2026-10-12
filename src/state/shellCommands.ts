// What the web's arcade shell may ask of the app (W1.5, #127). The shell is drawn around the whole app, outside its providers,
// so its footer cannot call `session.openOdds()`; and the app should not know there is a shell. So the app OFFERS a command
// while it can honour it (Home, signed in and past onboarding: that is when the odds sleeve can be drawn), and the shell runs
// it if it is on offer, and shows the control disabled if it is not. On a phone nothing ever runs one. Not in src/web/: the
// app imports it.
import { useEffect, useSyncExternalStore } from 'react';

export type ShellCommand = 'odds';
const offered = new Map<ShellCommand, () => void>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Offer a command for as long as the returned function has not been called. */
export function provideShellCommand(name: ShellCommand, run: () => void): () => void {
  offered.set(name, run); changed();
  return () => { if (offered.get(name) === run) { offered.delete(name); changed(); } };
}
/** True when something ran. */
export function runShellCommand(name: ShellCommand): boolean {
  const run = offered.get(name);
  if (!run) return false;
  run();
  return true;
}
export function useShellCommandOffered(name: ShellCommand): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => offered.has(name), () => false);
}
/** Offers `run` as `name` while mounted. */
export function ProvideShellCommand({ name, run }: { name: ShellCommand; run: () => void }) {
  useEffect(() => provideShellCommand(name, run), [name, run]);
  return null;
}
