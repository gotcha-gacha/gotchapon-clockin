// Kept pulls on disk (state/pendingPulls): the file a build before free pulls and burns were kept wrote still reads back.
import { expect, jest, test } from '@jest/globals';
import { File } from 'expo-file-system';
import { currentPending, dropPending, keepPending, readPendingPulls, writePendingPulls, type PendingPull } from './pendingPulls';

test('a paid pull kept by an earlier build (no kind) reads back as a crank pull; an unreadable entry, or an old one with no signature, is dropped', () => {
  const prepared = { pullId: 'pull_1', costUsd: 1, useFreePulls: 0, expiresAt: '2026-09-11T00:00:00Z' };
  // What earlier builds could leave on disk: a paid pull without `kind`, an unreadable entry, an old one missing its signature.
  writePendingPulls([{ userId: 'u1', prepared, txSignature: 'mock:pull_1' }, { userId: 'u1' }, { userId: 'u1', prepared }, { kind: 'burn', userId: 'u1', idem: 'k1' }] as unknown as PendingPull[]);
  expect(readPendingPulls()).toEqual([{ kind: 'pull', userId: 'u1', prepared, txSignature: 'mock:pull_1' }, { kind: 'burn', userId: 'u1', idem: 'k1' }]);
  writePendingPulls([]);
  expect(readPendingPulls()).toEqual([]);
});

// W0.2b (#136): the same module on a phone. One writer, so keeping and dropping read as they always did; the new parts are the
// versioned shape and saying so when the disk refuses a write.
const paid = (id: string): PendingPull => ({ kind: 'pull', userId: 'u1', prepared: { pullId: id, costUsd: 1, useFreePulls: 0, expiresAt: '2026-09-18T00:00:00Z' }, txSignature: `sig:${id}` });

test('keeping replaces an earlier record of the same pull, dropping removes it, and the file carries a version', () => {
  writePendingPulls([]);
  expect(keepPending(paid('p1'))).toEqual({ list: [paid('p1')], saved: true });
  const again = { ...paid('p1'), txSignature: 'sig:second' } as PendingPull;
  expect(keepPending(again)).toEqual({ list: [again], saved: true });
  expect(keepPending({ kind: 'burn', userId: 'u1', idem: 'k1' }).list).toHaveLength(2);
  expect(JSON.parse(new File('file:///document', 'pending-pulls.json').textSync())).toEqual({ v: 1, pulls: [again, { kind: 'burn', userId: 'u1', idem: 'k1' }] });
  expect(dropPending('p1')).toEqual({ list: [{ kind: 'burn', userId: 'u1', idem: 'k1' }], saved: true });
  expect(dropPending('k1')).toEqual({ list: [], saved: true });
  expect(readPendingPulls()).toEqual([]);
});

test('a disk that refuses the write: the pull is held in memory, reported as not saved, and stored with the next write that lands', () => {
  writePendingPulls([]);
  const refuse = jest.spyOn(File.prototype, 'write').mockImplementation(() => { throw new Error('ENOSPC'); });
  expect(keepPending(paid('p1'))).toEqual({ list: [paid('p1')], saved: false });
  expect(readPendingPulls()).toEqual([]);
  expect(currentPending()).toEqual({ list: [paid('p1')], saved: false });
  refuse.mockRestore();
  expect(keepPending(paid('p2'))).toEqual({ list: [paid('p1'), paid('p2')], saved: true });
  expect(readPendingPulls()).toEqual([paid('p1'), paid('p2')]);
  writePendingPulls([]);
});
