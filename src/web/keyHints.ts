// Whether a key has been used yet (W1.2): the shell's hint row ("space crank · ← → pages · esc close") stands out
// until the first key press and recedes after it. A tiny store, because the bridge lives in the app and the row in the shell.
import { useSyncExternalStore } from 'react';

let used = false;
const listeners = new Set<() => void>();
export function noteKeyUsed(): void { if (used) return; used = true; listeners.forEach((l) => l()); }
export function useKeyUsed(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => used, () => false);
}
/** Tests only: a fresh page. */
export function resetKeyHintsForTests(): void { used = false; }
