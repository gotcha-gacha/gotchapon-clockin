// Pulls whose cards have not come back yet (F2.10, review of PR #66): a crank pull, paid or covered by free pulls, and a burn.
// The session writes one the moment it is spent (a paid pull's transfer signed, a free pull's commit or a burn going out) and
// removes it once its cards come back or the server refuses it for good, so leaving a sealed capsule, a crash or a relaunch never
// loses the handle the client retries with. Nothing secret: a pull id, a transaction signature or a burn's idempotency key the
// server already holds, and whose pull it is.
import type { PullPrepareResponse } from '@/api/contract';
import { readStored, writeStored } from './storage';

/** A crank pull opens again by its pull id and signature (none for a free pull); a burn by the key it was sent with. */
export type PendingPull =
  | { kind: 'pull'; userId: string; prepared: PullPrepareResponse; txSignature?: string }
  | { kind: 'burn'; userId: string; idem: string };

/** What a kept pull is known by: a crank pull's id, or a burn's key. */
export const pendingId = (p: PendingPull): string => (p.kind === 'burn' ? p.idem : p.prepared.pullId);

const NAME = 'pending-pulls.json';
/** The stored shape carries a version, so a later change can migrate a sealed pull instead of dropping it. Version 0 is the bare
 *  array every build before W0.2b wrote; it still reads. */
const VERSION = 1;

function isPendingPull(v: unknown): v is PendingPull {
  const p = v as { kind?: unknown; userId?: unknown; idem?: unknown; txSignature?: unknown; prepared?: { pullId?: unknown } } | null;
  if (typeof p?.userId !== 'string') return false;
  if (p.kind === 'burn') return typeof p.idem === 'string';
  return p.kind === 'pull' && typeof p.prepared?.pullId === 'string' && (p.txSignature === undefined || typeof p.txSignature === 'string');
}

/** Builds before free pulls and burns were kept wrote paid pulls without `kind`, always with their signature. */
function fromEarlierBuild(v: unknown): unknown {
  const p = v as { kind?: unknown; txSignature?: unknown } | null;
  return p?.kind === undefined && typeof p?.txSignature === 'string' ? { ...p, kind: 'pull' } : v;
}

/** The kept pulls, or none when the store is missing or unreadable (the server still resolves every confirmed payment). */
export function readPendingPulls(): PendingPull[] {
  try {
    const text = readStored(NAME);
    if (text === null) return [];
    const stored: unknown = JSON.parse(text);
    const list = Array.isArray(stored) ? stored : (stored as { pulls?: unknown } | null)?.pulls;
    return Array.isArray(list) ? list.map(fromEarlierBuild).filter(isPendingPull) : [];
  } catch {
    return [];
  }
}

/** Replaces the stored list. True when it was stored: a full or blocked store (the web's private mode) answers false. */
export function writePendingPulls(list: PendingPull[]): boolean {
  return writeStored(NAME, JSON.stringify({ v: VERSION, pulls: list }));
}

// Keeping and dropping merge into whatever is stored NOW, by id, instead of replacing it with what this writer last saw: on the
// web every tab of the browser shares the store, and a tab that replaced the list with its own memory would erase a pull another
// tab had just sealed. On a phone there is one writer and the two are the same thing.
//
// `unsaved` is what this writer could not store (the write was refused): it stays in memory, rides along on every later write,
// and is the only thing memory ever adds to the stored list. Anything else memory holds that the store no longer does was
// dropped by another tab on purpose, and must not come back.
const unsaved = new Map<string, PendingPull>();

function commit(next: PendingPull[], stored: PendingPull[]): { list: PendingPull[]; saved: boolean } {
  const saved = writePendingPulls(next);
  if (saved) unsaved.clear();
  else { const held = new Set(stored.map(pendingId)); next.forEach((p) => { if (!held.has(pendingId(p))) unsaved.set(pendingId(p), p); }); }
  return { list: next, saved };
}
const current = (): { stored: PendingPull[]; all: PendingPull[] } => {
  const stored = readPendingPulls();
  const held = new Set(stored.map(pendingId));
  return { stored, all: [...stored, ...[...unsaved.values()].filter((p) => !held.has(pendingId(p)))] };
};

/** Keep a pull: the stored list plus this one (replacing an earlier record of the same pull). `saved` is false when the store
 *  refused the write; the pull is then held in memory only, and nothing may tell the user it will still be here after a reload. */
export function keepPending(p: PendingPull): { list: PendingPull[]; saved: boolean } {
  const { stored, all } = current();
  return commit([...all.filter((x) => pendingId(x) !== pendingId(p)), p], stored);
}

/** Drop a pull that has opened, or never can. */
export function dropPending(id: string): { list: PendingPull[]; saved: boolean } {
  unsaved.delete(id);
  const { stored, all } = current();
  if (!all.some((x) => pendingId(x) === id)) return { list: all, saved: unsaved.size === 0 };
  return commit(all.filter((x) => pendingId(x) !== id), stored);
}

/** What is kept right now: the store, plus what this writer could not store. For a tab that has just become the active one. */
export function currentPending(): { list: PendingPull[]; saved: boolean } {
  return { list: current().all, saved: unsaved.size === 0 };
}
