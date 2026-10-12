// #418, after PR #410's post-merge review: the real verify-draw.ts against a fake JSON-RPC chain, so the checks past the
// receipt (the request scan, the delivery scan and their caps) run on every change. The chain is in this process; the verifier
// is a child process that asks it over HTTP, exactly as it asks a real RPC.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { address, getBase58Decoder, getProgramDerivedAddress } from '@solana/kit';
import { bytesToHex, canonicalPool, deriveSlots, hexToBytes, poolHash, pullIdHash, type FrozenPool } from '../../src/drawDerive.ts';
import { FULFILL_DRAW, VRF_PROGRAM } from '../../src/drawFulfil.ts';

const dir = mkdtempSync(join(tmpdir(), 'verify-draw-chain-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const verifier = fileURLToPath(new URL('../verify-draw.ts', import.meta.url));
const PROGRAM = 'GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut';
const REQUEST_DRAW = [22, 180, 8, 81, 47, 21, 86, 159];
/** verify-draw.ts's MAX_CANDIDATES: how many transactions either scan may fetch. */
const MAX = 200;
const TOO_LONG = /history is too long to read whole/;
const encode = (bytes: number[] | Uint8Array) => getBase58Decoder().decode(Uint8Array.from(bytes));
const pool: FrozenPool = { v: 1, slots: { count: 1, reservedPaid: 0, reservedCommon: 0 }, paid: [{ tier: 'common', weight: 1 }],
  free: [{ tier: 'common', weight: 1 }], cards: { common: [{ key: 'common:A:a', weight: 1 }, { key: 'common:A:b', weight: 1 }] } };
const canonical = canonicalPool(pool);
const randomness = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

type Shape = {
  /** Unrelated successful transactions listing the draw account, newer than the delivery. */
  padsNewer?: number;
  /** The same, older than the request: the account's address is public before the request creates it. */
  padsOlder?: number;
  /** FAILED transactions listing the account, newer than the delivery: the delivery scan skips them, the history read does not. */
  failedNewer?: number;
  /** A second delivery of other bytes, oldest after the request (so it is the last candidate the delivery scan reaches). */
  secondDelivery?: boolean;
};

/** One fake chain holding pulls P (sequence 500) and Q (sequence 300) shaped alike, a receipt file for both, and the view. */
async function run(shape: Shape, viewOf: 'P' | 'Q', viewPatch: Record<string, unknown>, args: string[]) {
  const hash = await poolHash(canonical);
  const transactions = new Map<string, unknown>();
  const history = new Map<string, { signature: string; err: unknown }[]>();
  const calls = { getTransaction: 0 };
  const deliveryTo = (account: string, bytes: Uint8Array) => ({
    transaction: { message: { accountKeys: [VRF_PROGRAM, PROGRAM, account], instructions: [{ programIdIndex: 0, accounts: [], data: '' }] } },
    meta: { err: null, innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 1, accounts: [2], data: encode([...FULFILL_DRAW, ...bytes]) }] }] },
  });
  const pull = async (pullId: string, sequence: number) => {
    const seq = new Uint8Array(8);
    new DataView(seq.buffer).setBigUint64(0, BigInt(sequence), true);
    const [account] = await getProgramDerivedAddress({ programAddress: address(PROGRAM), seeds: [new TextEncoder().encode('draw'), seq] });
    const pad = (name: string) => { transactions.set(name, { transaction: { message: { accountKeys: [account], instructions: [] } }, meta: { err: null } }); return name; };
    const oldestFirst: string[] = [];
    for (let i = 0; i < (shape.padsOlder ?? 0); i++) oldestFirst.push(pad(`old_${pullId}_${i}`));
    const req = `req_${pullId}`;
    transactions.set(req, { transaction: { message: { accountKeys: [PROGRAM], instructions: [{ programIdIndex: 0, accounts: [],
      data: encode([...REQUEST_DRAW, ...seq, ...await pullIdHash(pullId), 1, ...hexToBytes(hash)]) }] } }, meta: { err: null } });
    oldestFirst.push(req);
    if (shape.secondDelivery) {
      transactions.set(`ful2_${pullId}`, deliveryTo(account, Uint8Array.from({ length: 32 }, () => 9)));
      oldestFirst.push(`ful2_${pullId}`);
    }
    const ful = `ful_${pullId}`;
    transactions.set(ful, deliveryTo(account, randomness));
    oldestFirst.push(ful);
    for (let i = 0; i < (shape.padsNewer ?? 0); i++) oldestFirst.push(pad(`new_${pullId}_${i}`));
    const failed = new Set<string>();
    for (let i = 0; i < (shape.failedNewer ?? 0); i++) failed.add(oldestFirst[oldestFirst.push(`err_${pullId}_${i}`) - 1]);
    history.set(account, oldestFirst.reverse().map((signature) => ({ signature, err: failed.has(signature) ? { InstructionError: [0, 'Custom'] } : null })));
    return { pullId, sequence, req, ful };
  };
  const pulls = { P: await pull('pull_P', 500), Q: await pull('pull_Q', 300) };

  const server = createServer((rq, rs) => {
    let body = '';
    rq.on('data', (chunk) => { body += chunk; });
    rq.on('end', () => {
      const { method, params } = JSON.parse(body) as { method: string; params: [string, { limit: number; before?: string }] };
      let result: unknown = null;
      if (method === 'getTransaction') { calls.getTransaction++; result = transactions.get(params[0]) ?? null; }
      if (method === 'getSignaturesForAddress') {
        const all = history.get(params[0]) ?? [];
        const from = params[1].before ? all.findIndex((s) => s.signature === params[1].before) + 1 : 0;
        result = all.slice(from, from + params[1].limit);
      }
      rs.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const shown = pulls[viewOf];
    const viewFile = join(dir, `view-${Math.random()}.json`);
    writeFileSync(viewFile, JSON.stringify({ source: 'magicblock', pullId: shown.pullId, programId: PROGRAM, sequence: shown.sequence,
      pool: canonical, poolHash: hash, requestSignature: shown.req, fulfilSignature: shown.ful, randomness: bytesToHex(randomness),
      outcomes: await deriveSlots(pool, randomness), ...viewPatch }));
    const receipts = join(dir, `receipts-${Math.random()}.json`);
    writeFileSync(receipts, JSON.stringify([
      { pullId: 'pull_P', source: 'magicblock', sequence: 500, poolHash: hash, keptAt: '2026-10-07T00:00:00.000Z' },
      { pullId: 'pull_Q', source: 'magicblock', sequence: 300, poolHash: hash, keptAt: '2026-10-07T00:00:00.000Z' },
    ]));
    const port = (server.address() as { port: number }).port;
    // The RPC URL carries a query, as a keyed provider's does: a value holding `=` must parse as a value, not a misspelt flag.
    const argv = args.map((a) => (a === '<receipts>' ? receipts : a));
    const { status, out } = await new Promise<{ status: number; out: string }>((resolve) => {
      execFile(process.execPath, [verifier, viewFile, '--rpc', `http://127.0.0.1:${port}/?api-key=k`, ...argv], { encoding: 'utf8' },
        (error, stdout, stderr) => resolve({ status: error ? Number(error.code) : 0, out: `${stdout}${error ? stderr : ''}` }));
    });
    const line = (prefix: RegExp) => out.split('\n').find((l) => prefix.test(l)) ?? '';
    return { status, out, calls, request: line(/request/), delivery: line(/MagicBlock delivered/) };
  } finally {
    server.close();
  }
}

const withReceipt = ['--receipt', '<receipts>', '--pull', 'pull_P'];

test('an honest pull verifies end to end on the fake chain, with a receipt and without one', async () => {
  const signed = await run({}, 'P', {}, withReceipt);
  assert.equal(signed.status, 0, signed.out);
  assert.match(signed.out, /verified pull pull_P\n/);
  const unsigned = await run({}, 'P', {}, ['--no-receipt', '--pull', 'pull_P']);
  assert.equal(unsigned.status, 0, unsigned.out);
  assert.match(unsigned.out, /verified pull pull_P, WITHOUT a receipt/);
});

test('--pull is checked without a receipt too: another pull\'s honest view fails', async () => {
  const swapped = await run({}, 'Q', {}, ['--no-receipt', '--pull', 'pull_P']);
  assert.equal(swapped.status, 1, swapped.out);
  assert.match(swapped.out, /FAIL the view is pull pull_P — the view is of pull_Q/);
  assert.doesNotMatch(swapped.out, /verified/);
  // Naming no pull still checks the view's own, and says it had no receipt.
  const unnamed = await run({}, 'Q', {}, ['--no-receipt']);
  assert.equal(unnamed.status, 0, unnamed.out);
  assert.match(unnamed.out, /verified pull pull_Q, WITHOUT a receipt/);
});

test('the delivery scan reads exactly its cap, and one candidate more fails as too long, not as undelivered', async () => {
  const full = await run({ padsNewer: MAX - 1 }, 'P', {}, withReceipt); // MAX - 1 pads + the delivery = MAX candidates
  assert.equal(full.status, 0, full.out);
  assert.match(full.delivery, /^PASS /);
  for (const fulfilSignature of [undefined, null]) { // the archived signature in the view, or none archived
    const over = await run({ padsNewer: MAX }, 'P', fulfilSignature === null ? { fulfilSignature } : {}, withReceipt);
    assert.equal(over.status, 1, over.out);
    assert.match(over.delivery, /^FAIL /);
    assert.match(over.delivery, TOO_LONG);
    assert.doesNotMatch(over.delivery, /no fulfilment found/);
  }
});

test('a second delivery past the cap is not read as "delivered once"', async () => {
  // MAX - 1 newer pads + the delivery = MAX candidates read; the second delivery, the oldest, is candidate MAX + 1 and is not
  // read. The scan sees one delivery, so only the cap's own failure stands between this and a pass.
  const padded = await run({ padsNewer: MAX - 1, secondDelivery: true }, 'P', {}, withReceipt);
  assert.equal(padded.status, 1, padded.out);
  assert.match(padded.delivery, /^FAIL /);
  assert.match(padded.delivery, TOO_LONG);
  // Under the cap, the same second delivery is seen and fails the check on its own.
  const seen = await run({ secondDelivery: true }, 'P', {}, withReceipt);
  assert.equal(seen.status, 1, seen.out);
  assert.match(seen.delivery, /fulfilment ful_pull_P, fulfilment ful2_pull_P|fulfilment ful2_pull_P, fulfilment ful_pull_P/);
});

test('the request scan is bounded: a wrong request signature over a padded history fails as too long, within the cap', async () => {
  const found = await run({ padsOlder: 3 }, 'P', { requestSignature: null }, withReceipt);
  assert.equal(found.status, 0, found.out);
  assert.match(found.out, /request found on chain: req_pull_P/);
  const padded = await run({ padsOlder: MAX + 50 }, 'P', { requestSignature: null }, withReceipt);
  assert.equal(padded.status, 1, padded.out);
  assert.match(padded.request, /^FAIL /);
  assert.match(padded.request, TOO_LONG);
  // Each scan stops at its cap: MAX for the request, MAX for the deliveries.
  assert.ok(padded.calls.getTransaction <= 2 * MAX, `getTransaction ran ${padded.calls.getTransaction} times`);
});

test('a misspelt --pull is refused as usage, never read as no --pull', async () => {
  for (const spelling of [['--pull=pull_P'], ['--pull'], ['--pull', '--cluster', 'devnet'], ['--pull', 'pull_P', '--pull', 'pull_Q'],
    ['--pul', 'pull_P'], ['-pull', 'pull_P'], ['--PULL', 'pull_P'], ['--pullId', 'pull_P'], ['--cluster=devnet', '--pull', 'pull_P']]) {
    for (const mode of [['--no-receipt'], ['--receipt', '<receipts>']]) {
      const result = await run({}, 'Q', {}, [...mode, ...spelling]);
      assert.equal(result.status, 2, `${[...mode, ...spelling].join(' ')}:\n${result.out}`);
      assert.doesNotMatch(result.out, /verified/);
    }
  }
  // An empty name is a name: it is not pull_Q, so the check fails (exit 1), in the mode with no receipt to refuse it first.
  const empty = await run({}, 'Q', {}, ['--no-receipt', '--pull', '']);
  assert.equal(empty.status, 1, empty.out);
  assert.match(empty.out, /FAIL the view is pull {2}— the view is of pull_Q/);
});

test('a history padded past the read window with FAILED transactions is too long, even with one delivery in view', async () => {
  // A window of failed transactions holds no candidate, so the candidate count alone cannot see the cut: the second delivery
  // behind it is never read, and only the history-length half of the guard fails the check.
  const hidden = await run({ failedNewer: 5_000, secondDelivery: true }, 'P', {}, withReceipt);
  assert.equal(hidden.status, 1, hidden.out);
  assert.match(hidden.delivery, /^FAIL /);
  assert.match(hidden.delivery, TOO_LONG);
  // Inside the window (paged 1,000 at a time with `before`), the same failed padding is skipped and an honest pull verifies.
  const paged = await run({ failedNewer: 4_000 }, 'P', {}, withReceipt);
  assert.equal(paged.status, 0, paged.out);
  // Past the window with no request signature in the view: the request scan reports the cut too.
  const unfound = await run({ failedNewer: 5_000 }, 'P', { requestSignature: null }, withReceipt);
  assert.match(unfound.request, /^FAIL /);
  assert.match(unfound.request, TOO_LONG);
});
