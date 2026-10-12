// MagicBlock draw receipts (#406): what a pull was committed to before the user paid, kept on the device.
import { beforeEach, expect, test } from '@jest/globals';
import { File } from 'expo-file-system';
import { drawReceipt, drawReceiptsExport, keepDrawReceipt, readDrawReceipts, RECEIPT_LIMIT } from './drawReceipts';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const prepared = (id: string, sequence = 7, poolHash = hash(1)) =>
  ({ pullId: id, draw: { source: 'magicblock' as const, sequence, poolHash } });
const AT = new Date('2026-10-07T00:00:00.000Z');

beforeEach(() => { new File('file:///document', 'draw-receipts.json').write('[]'); });

test('a MagicBlock pull\'s commitment is kept and read back by pull id; any other prepare keeps nothing', () => {
  expect(keepDrawReceipt(prepared('p1'), AT)).toBe(true);
  expect(drawReceipt('p1')).toEqual({ pullId: 'p1', source: 'magicblock', sequence: 7, poolHash: hash(1), keptAt: AT.toISOString() });
  expect(keepDrawReceipt({ pullId: 'p2' })).toBe(false);
  expect(readDrawReceipts().map((r) => r.pullId)).toEqual(['p1']);
});

test('the first commitment for a pull wins: a later answer for the same pull never replaces what was promised first', () => {
  keepDrawReceipt(prepared('p1', 7, hash(1)), AT);
  keepDrawReceipt(prepared('p1', 8, hash(2)), AT);
  expect(drawReceipt('p1')).toMatchObject({ sequence: 7, poolHash: hash(1) });
  expect(readDrawReceipts().filter((r) => r.pullId === 'p1')).toHaveLength(1);
});

test('a malformed commitment is not kept, and a malformed stored entry is dropped on read', () => {
  expect(keepDrawReceipt({ pullId: 'p1', draw: { source: 'magicblock', sequence: 1.5, poolHash: hash(1) } })).toBe(false);
  // The verifier rejects a sequence below 1 (server/src/drawReceipt.ts): the app never keeps one that blocks a real receipt.
  for (const sequence of [0, -3]) {
    expect(keepDrawReceipt({ pullId: 'p1', draw: { source: 'magicblock', sequence, poolHash: hash(1) } })).toBe(false);
  }
  expect(keepDrawReceipt({ pullId: 'p1', draw: { source: 'magicblock', sequence: 1, poolHash: 'not-a-hash' } })).toBe(false);
  new File('file:///document', 'draw-receipts.json')
    .write(JSON.stringify([{ pullId: 'x' }, { pullId: 'p9', source: 'magicblock', sequence: 9, poolHash: hash(9), keptAt: 'now' }]));
  expect(readDrawReceipts().map((r) => r.pullId)).toEqual(['p9']);
});

test(`only the newest ${RECEIPT_LIMIT} receipts are kept`, () => {
  for (let i = 0; i <= RECEIPT_LIMIT; i++) keepDrawReceipt(prepared(`p${i}`, i), AT);
  const list = readDrawReceipts();
  expect(list).toHaveLength(RECEIPT_LIMIT);
  expect(list[0].pullId).toBe('p1');
  expect(list.at(-1)!.pullId).toBe(`p${RECEIPT_LIMIT}`);
});

test('the export is the stored file itself, the text the verifier reads, and nothing when no receipt is kept (#418)', () => {
  expect(drawReceiptsExport()).toBeNull();
  keepDrawReceipt(prepared('p1', 7, hash(1)), AT);
  keepDrawReceipt(prepared('p2', 9, hash(2)), AT);
  const out = drawReceiptsExport();
  expect(out).toEqual({ text: new File('file:///document', 'draw-receipts.json').textSync(), count: 2 });
  expect(JSON.parse(out!.text)).toEqual(readDrawReceipts());
});
