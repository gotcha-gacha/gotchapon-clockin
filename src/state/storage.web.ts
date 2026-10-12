// The web half of state/storage (W0.2b, #136): localStorage, one key per name. Weaker than a phone's disk in three ways the
// callers are written around. It can refuse: Safari's private mode and a full quota throw from setItem, so writeStored answers
// false and nothing may claim the text was kept. It can forget: Safari evicts script-written storage after 7 days without a
// visit, so a kept pull's last line of defence is the server (GET /pulls/pending, #144), never this. And it is shared: every
// tab of the browser reads and writes the same keys, so writers merge (pendingPulls) and only one tab runs the machine (activeTab).
const key = (name: string) => `gachapon:${name}`;
const store = (): Storage | undefined => {
  try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; } // the getter itself throws when storage is blocked
};

/** The stored text, or null when there is none (or no storage at all: a server render, a blocked store). */
export function readStored(name: string): string | null {
  return store()?.getItem(key(name)) ?? null;
}

/** True when the text was stored. Never throws. */
export function writeStored(name: string, text: string): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key(name), text);
    return true;
  } catch {
    return false;
  }
}
