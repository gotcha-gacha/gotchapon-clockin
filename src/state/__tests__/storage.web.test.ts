/**
 * The storage seam on the web (W0.2b, #136), against jsdom's real localStorage. Two tabs of one browser are two instances of the
 * pendingPulls module (`jest.isolateModules`: each has its own memory) over that one shared store, which is exactly what two
 * tabs are. The modules under test are the production ones: under this project `./storage` resolves to storage.web.ts.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import type * as PendingPulls from '../pendingPulls';
import { readStored, writeStored } from '../storage';
import { DEFAULT_SETTINGS, readSettings, updateSettings } from '../settings';

type Pending = typeof PendingPulls;
const tab = (): Pending => { let m!: Pending; jest.isolateModules(() => { m = jest.requireActual<Pending>('../pendingPulls'); }); return m; };
const paid = (id: string): PendingPulls.PendingPull => ({ kind: 'pull', userId: 'u1', prepared: { pullId: id, costUsd: 1, useFreePulls: 0, expiresAt: '2026-09-18T00:00:00Z' }, txSignature: `sig:${id}` });
const ids = (list: PendingPulls.PendingPull[]) => list.map((p) => (p.kind === 'burn' ? p.idem : p.prepared.pullId)).sort();

beforeEach(() => { localStorage.clear(); });
afterEach(() => { jest.restoreAllMocks(); });

test('under the web project the seam is localStorage: one key per name, text in and out, null when there is none', () => {
  expect(readStored('x.json')).toBeNull();
  expect(writeStored('x.json', '{"a":1}')).toBe(true);
  expect(localStorage.getItem('gachapon:x.json')).toBe('{"a":1}');
  expect(readStored('x.json')).toBe('{"a":1}');
});

test('settings survive a reload through it, and a change keeps the rest', () => {
  expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  updateSettings({ muted: true });
  expect(readSettings()).toEqual({ ...DEFAULT_SETTINGS, muted: true });
});

test('a sealed pull survives a reload, in a versioned shape; the bare array earlier builds wrote still reads', () => {
  const a = tab();
  expect(a.keepPending(paid('p1'))).toEqual({ list: [paid('p1')], saved: true });
  expect(JSON.parse(localStorage.getItem('gachapon:pending-pulls.json')!)).toEqual({ v: 1, pulls: [paid('p1')] });
  expect(tab().readPendingPulls()).toEqual([paid('p1')]); // a fresh module: the page was reloaded
  localStorage.setItem('gachapon:pending-pulls.json', JSON.stringify([paid('old')]));
  expect(tab().readPendingPulls()).toEqual([paid('old')]);
});

test('two tabs: a pull sealed in tab A is still kept after tab B writes, and a pull B dropped does not come back when A writes', () => {
  const a = tab(), b = tab(); // both opened on an empty store; neither re-reads unless it writes
  a.keepPending(paid('a1'));
  expect(ids(b.keepPending(paid('b1')).list)).toEqual(['a1', 'b1']); // replacing the list with B's memory would have erased a1
  expect(ids(tab().readPendingPulls())).toEqual(['a1', 'b1']);
  b.dropPending('a1'); // B opened it (or the server refused it for good)
  expect(ids(a.keepPending(paid('a2')).list)).toEqual(['a2', 'b1']); // A once held a1 in memory: it must not resurrect it
  expect(ids(a.dropPending('never-kept').list)).toEqual(['a2', 'b1']);
});

test('a store that refuses the write (private mode, a full quota): the app runs, the pull is held in memory, and nothing says it was saved', () => {
  const a = tab();
  const refuse = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('QuotaExceededError'); });
  const r = a.keepPending(paid('p1'));
  expect(r).toEqual({ list: [paid('p1')], saved: false });
  expect(a.currentPending()).toEqual({ list: [paid('p1')], saved: false });
  expect(tab().readPendingPulls()).toEqual([]); // a reload would not find it: this is what "not saved" means
  expect(tab().currentPending()).toEqual({ list: [], saved: true }); // and another tab knows nothing of it: each `tab()` really is its own memory
  refuse.mockRestore();
  expect(a.keepPending(paid('p2'))).toEqual({ list: [paid('p1'), paid('p2')], saved: true }); // the store is back: what was held rides along
  expect(ids(tab().readPendingPulls())).toEqual(['p1', 'p2']);
  expect(a.currentPending().saved).toBe(true);
});

test('a store that cannot be read at all (blocked storage throws from the getter) reads as nothing and writes as not saved', () => {
  const blocked = jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('SecurityError'); });
  expect(readStored('x.json')).toBeNull();
  expect(writeStored('x.json', '1')).toBe(false);
  expect(tab().keepPending(paid('p1')).saved).toBe(false);
  blocked.mockRestore();
});

test('dropping the only unsaved pull leaves nothing unsaved', () => {
  const a = tab();
  const refuse = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('QuotaExceededError'); });
  a.keepPending(paid('p1'));
  expect(a.dropPending('p1')).toEqual({ list: [], saved: true });
  refuse.mockRestore();
});
