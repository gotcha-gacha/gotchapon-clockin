// #406, PR #410 round 3: the receipt the APP stores is the receipt the VERIFIER reads. The file here is built by the app's own
// receipt functions (src/state/drawReceiptList.ts) and handed to the real verify-draw.ts, so a change to either side's shape
// fails here, not on a user's honest pull. The verifier's receipt check runs before any RPC call, so it is read with no chain.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serializeReceipts, withReceipt } from '../../../src/state/drawReceiptList.ts';
import { commitmentFromReceipt } from '../../src/drawReceipt.ts';

const dir = mkdtempSync(join(tmpdir(), 'verify-draw-receipt-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const verifier = fileURLToPath(new URL('../verify-draw.ts', import.meta.url));
const hash = (n: number) => n.toString(16).padStart(64, '0');
const AT = new Date('2026-10-07T00:00:00.000Z');

/** The app's stored file after preparing these pulls, exactly as the device writes it. */
function appReceiptFile(...pulls: { pullId: string; sequence: number; poolHash: string }[]): string {
  let list = withReceipt([], { pullId: 'pull_other', draw: { source: 'magicblock', sequence: 1, poolHash: hash(1) } }, AT)!;
  for (const p of pulls) list = withReceipt(list, { pullId: p.pullId, draw: { source: 'magicblock', sequence: p.sequence, poolHash: p.poolHash } }, AT)!;
  const file = join(dir, `receipts-${Math.random()}.json`);
  writeFileSync(file, serializeReceipts(list));
  return file;
}

/** The verifier's receipt line for this view and receipt file (no chain: the RPC is a closed port, reached only after it). */
function receiptLine(view: { pullId: string; sequence: number; poolHash: string }, receiptFile: string, pull = view.pullId): string {
  const viewFile = join(dir, `view-${Math.random()}.json`);
  writeFileSync(viewFile, JSON.stringify({ source: 'magicblock', programId: 'GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut',
    pool: '{}', requestSignature: null, fulfilSignature: null, randomness: hash(7), outcomes: [], ...view }));
  let out = '';
  try {
    out = execFileSync(process.execPath, [verifier, viewFile, '--receipt', receiptFile, '--pull', pull, '--rpc', 'http://127.0.0.1:9'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    out = String((error as { stdout?: string }).stdout ?? '');
  }
  const line = out.split('\n').find((l) => l.includes('your receipt committed to'));
  assert.ok(line, `the verifier printed no receipt line:\n${out}`);
  return line;
}

test('the app\'s stored receipt file verifies an honest view of its pull', () => {
  const file = appReceiptFile({ pullId: 'pull_honest', sequence: 213924, poolHash: hash(42) });
  assert.match(receiptLine({ pullId: 'pull_honest', sequence: 213924, poolHash: hash(42) }, file), /^PASS /);
});

test('the same file fails a view of that pull under another sequence or pool, and a pull it holds no receipt for', () => {
  const file = appReceiptFile({ pullId: 'pull_honest', sequence: 213924, poolHash: hash(42) });
  assert.match(receiptLine({ pullId: 'pull_honest', sequence: 230932, poolHash: hash(42) }, file), /^FAIL /);
  assert.match(receiptLine({ pullId: 'pull_honest', sequence: 213924, poolHash: hash(43) }, file), /^FAIL /);
  assert.match(receiptLine({ pullId: 'pull_unknown', sequence: 213924, poolHash: hash(42) }, file), /^FAIL /);
});

test('the pull checked is the one the user names, never the one the server\'s view names (round 4)', () => {
  // The user holds receipts for P and Q and checks P; a house answering with Q's honest view must fail.
  const file = appReceiptFile({ pullId: 'pull_P', sequence: 500, poolHash: hash(5) }, { pullId: 'pull_Q', sequence: 300, poolHash: hash(3) });
  const swapped = receiptLine({ pullId: 'pull_Q', sequence: 300, poolHash: hash(3) }, file, 'pull_P');
  assert.match(swapped, /^FAIL /);
  assert.match(swapped, /the view is of pull_Q/);
  assert.match(receiptLine({ pullId: 'pull_P', sequence: 500, poolHash: hash(5) }, file, 'pull_P'), /^PASS /);
  // A view that copies P's sequence and pool under another pull's id still is not P.
  assert.match(receiptLine({ pullId: 'pull_Q', sequence: 500, poolHash: hash(5) }, file, 'pull_P'), /^FAIL /);
});

test('a receipt without --pull is refused as usage, not checked against the view\'s pull', () => {
  const file = appReceiptFile({ pullId: 'pull_P', sequence: 500, poolHash: hash(5) });
  const viewFile = join(dir, 'view-nopull.json');
  writeFileSync(viewFile, JSON.stringify({ source: 'magicblock', pullId: 'pull_P', sequence: 500, poolHash: hash(5) }));
  assert.throws(() => execFileSync(process.execPath, [verifier, viewFile, '--receipt', file, '--rpc', 'http://127.0.0.1:9'],
    { stdio: 'pipe' }), (error: { status?: number }) => error.status === 2);
});

test('every receipt shape a user may hold reads the same commitment', () => {
  const entry = { pullId: 'p', source: 'magicblock', sequence: 9, poolHash: hash(9), keptAt: AT.toISOString() };
  const want = { pullId: 'p', sequence: 9, poolHash: hash(9) };
  assert.deepEqual(commitmentFromReceipt([entry], 'p'), want); // the app's file
  assert.deepEqual(commitmentFromReceipt(entry, 'p'), want); // one entry of it
  assert.deepEqual(commitmentFromReceipt({ pullId: 'p', costUsd: 1, draw: { source: 'magicblock', sequence: 9, poolHash: hash(9) } }, 'p'), want); // the prepare response
  assert.equal(commitmentFromReceipt([entry], 'q'), null);
  assert.equal(commitmentFromReceipt({ pullId: 'p', costUsd: 1 }, 'p'), null); // a prepare on the server proof
  for (const bad of [{ ...entry, sequence: 0 }, { ...entry, sequence: 1.5 }, { ...entry, poolHash: 'x' }, { ...entry, source: 'ecvrf' }]) {
    assert.equal(commitmentFromReceipt([bad], 'p'), null);
  }
  // A list holding two commitments for one pull (a hand-edited file): the first, as the app keeps the first.
  assert.equal(commitmentFromReceipt([entry, { ...entry, sequence: 10 }], 'p')?.sequence, 9);
});
