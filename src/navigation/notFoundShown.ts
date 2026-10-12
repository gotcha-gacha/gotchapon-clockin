// Whether the not-found page is what the visitor is looking at (#169). The not-found page publishes it while it is mounted, and
// the QR of the page ("Get it on your phone", PhoneCard) reads it: a phone is then sent to the machine, not to the dead address.
// The QR used to decide that itself from the address bar, splitting before decoding while the router decodes before splitting,
// so `/binder/a%2Fb` drew the not-found page and its QR encoded the dead address (PR #168's review, reproduced on main 19 Sept).
// Reading the app's own decision cannot disagree with it. A count rather than a flag: it costs nothing, and it stays right if
// two not-found screens are ever up at once (none are today: PR #179's review found nothing that draws one beside another).
import { useSyncExternalStore } from 'react';

let shown = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Mark the not-found page as showing; the returned function unmarks it (an effect's cleanup). */
export function showNotFound(): () => void {
  shown++; emit();
  let done = false;
  return () => { if (done) return; done = true; shown--; emit(); };
}

export function useNotFoundShown(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => shown > 0, () => false);
}
