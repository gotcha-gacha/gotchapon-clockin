// Recompute a MagicBlock pull from public data (#406, AC-1), trusting nothing the server says about where to look.
// Inputs: the user's receipt (the prepare response their app got BEFORE paying: pullId, draw.sequence, draw.poolHash) and the
// JSON from GET /pulls/:id/draw. With no database and no key it checks:
//   R. the view is the receipt's pull, sequence and pool hash. The program allows one request per sequence, and the user held
//      the sequence before any random byte existed, so the house cannot have drawn this pull under another sequence and
//      published the answer it preferred;
//   0. the draw program is the one this repo publishes for that cluster (never the program id the server names);
//   1. the published pool hashes to the receipt's pool hash (the pool carries the pull's count and free split);
//   2. the request transaction is that program's request_draw for the receipt's sequence, for sha256 of this pull id, its count
//      and its pool hash;
//   3. the 32 bytes were delivered by MagicBlock: an inner fulfill_draw on this draw account under the VRF program's own
//      top-level instruction (src/drawFulfil.ts, the Worker's own reading), and only one such delivery exists;
//   4. those bytes, through deriveSlots over the frozen pool, give exactly the cards the pull settled.
// Usage: node scripts/verify-draw.ts <draw.json> --receipt <receipts.json> --pull <pullId> [--cluster devnet] [--rpc URL]
//          [--program <id>]
//   --pull names the pull YOU are checking: the receipt file can hold many pulls, and the server's view must not choose which.
//          With --no-receipt it is still checked: a view of another pull fails, whichever mode names it.
//   --program overrides the published program id: you are then trusting the id you pass, not this file.
//   --no-receipt runs without one, and then check R is NOT made: the result does not rule out a house that chose between draws.
import { readFile } from 'node:fs/promises';
import { address, getBase58Encoder, getProgramDerivedAddress } from '@solana/kit';
import { bytesToHex, deriveSlots, hexToBytes, poolHash, pullIdHash, type FrozenPool } from '../src/drawDerive.ts';
import { deliveredRandomness, type FulfilTx } from '../src/drawFulfil.ts';
import { commitmentFromReceipt } from '../src/drawReceipt.ts';

/** The draw program per cluster, as this repo deploys it. Each environment has its own deployment (server/README.md). */
const DRAW_PROGRAMS: Record<string, string> = {
  devnet: 'GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut',
};
const DEFAULT_RPC: Record<string, string> = { devnet: 'https://api.devnet.solana.com' };
const REQUEST_DRAW = [22, 180, 8, 81, 47, 21, 86, 159];
/** How much of the draw account's history is read. Anyone can list the account in a transaction; past this the verifier says so. */
const HISTORY_LIMIT = 5_000;
/** How many transactions either scan (the request's, the deliveries') fetches. Past this the history cannot be read whole, and
 *  the check fails saying so: an honest pull whose account someone padded reads "too long", never "not delivered". */
const MAX_CANDIDATES = 200;
const TOO_LONG = 'cannot be verified: the draw account\'s history is too long to read whole';

type View = {
  source: string; pullId: string; programId: string; sequence: number; pool: string; poolHash: string;
  requestSignature: string | null; fulfilSignature: string | null; randomness: string;
  outcomes: { index: number; tier: string; key: string }[];
};

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') && args[i - 1] !== '--no-receipt'));
const cluster = flag('--cluster') ?? 'devnet';
const programId = flag('--program') ?? DRAW_PROGRAMS[cluster];
const rpcUrl = flag('--rpc') ?? DEFAULT_RPC[cluster];
const receiptFile = flag('--receipt');
const pullFlag = flag('--pull');
const noReceipt = args.includes('--no-receipt');
// Only the known flags, each once, as `--flag value`, are read. Anything else starting with `-` (`--pull=P`, `--pul P`,
// `-pull P`, `--PULL P`, a value like `-x`), a trailing `--pull` or a repeat is refused rather than read as absent: an unread
// --pull would check whichever pull the server's view names.
const VALUE_FLAGS = ['--cluster', '--program', '--rpc', '--receipt', '--pull'];
const unknown = args.some((a) => a.startsWith('-') && a !== '--no-receipt' && !VALUE_FLAGS.includes(a));
const misspelt = unknown || VALUE_FLAGS.some((name) => {
  const at = args.indexOf(name);
  return at >= 0 && (args.indexOf(name, at + 1) >= 0 || args[at + 1] === undefined || args[at + 1].startsWith('--'));
});
if (misspelt || !file || !programId || !rpcUrl || (!receiptFile && !noReceipt) || (receiptFile && !pullFlag)) {
  console.error('usage: node scripts/verify-draw.ts <draw.json> (--receipt <receipts.json> --pull <pullId> | --no-receipt [--pull <pullId>])'
    + ' [--cluster devnet] [--rpc URL] [--program <id>]');
  process.exit(2);
}
const view = JSON.parse(await readFile(file, 'utf8')) as View;
if (view.source !== 'magicblock') { console.error(`this pull is drawn by ${view.source}, not MagicBlock`); process.exit(2); }

let failed = 0;
const check = (name: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl!, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json() as { result: T; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const getTx = (signature: string) => rpc<FulfilTx | null>('getTransaction',
  [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
const keysOf = (tx: FulfilTx) => [...tx.transaction.message.accountKeys,
  ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
const base58 = getBase58Encoder();
const fromBase58 = (value: string) => Uint8Array.from(base58.encode(value));
const startsWith = (data: Uint8Array, prefix: number[]) => prefix.every((byte, i) => data[i] === byte);

// R: what the user held before paying decides which sequence and pool this pull is checked under.
let sequence = view.sequence;
let committedPoolHash = view.poolHash;
if (receiptFile) {
  // The app's stored receipt file, one entry of it, or the raw prepare response (src/drawReceipt.ts).
  // The pull is the one the user names (--pull), never the one the server's view names: a receipt file holds many pulls.
  const committed = commitmentFromReceipt(JSON.parse(await readFile(receiptFile, 'utf8')), pullFlag!);
  check(`the view is pull ${pullFlag}, with the sequence and pool your receipt committed to before you paid`,
    !!committed && view.pullId === pullFlag && committed.sequence === view.sequence && committed.poolHash === view.poolHash,
    !committed ? `the receipt holds no MagicBlock commitment for ${pullFlag}`
      : view.pullId !== pullFlag ? `the view is of ${view.pullId}` : `receipt sequence ${committed.sequence}`);
  if (committed) { sequence = committed.sequence; committedPoolHash = committed.poolHash; }
} else {
  console.log('SKIP the receipt check (--no-receipt): this does not rule out a house that drew the pull under several sequences');
  // No receipt, but a named pull is still the one checked: the view must not swap in another pull the house prefers.
  if (pullFlag !== undefined) check(`the view is pull ${pullFlag}`, view.pullId === pullFlag, `the view is of ${view.pullId}`);
}

// 0
check(`draw program is ${cluster}'s published one`, view.programId === programId, programId);

// 1
const pool = JSON.parse(view.pool) as FrozenPool;
check('pool hash', await poolHash(view.pool) === committedPoolHash, `slots ${JSON.stringify(pool.slots)}`);

// The draw account is the published program's address for the committed sequence, derived here.
const seqBytes = new Uint8Array(8);
new DataView(seqBytes.buffer).setBigUint64(0, BigInt(sequence), true);
const [drawAccount] = await getProgramDerivedAddress({ programAddress: address(programId),
  seeds: [new TextEncoder().encode('draw'), seqBytes] });

// The draw account's whole history (paged), newest first.
const signatures: { signature: string; err: unknown }[] = [];
for (let before: string | undefined; signatures.length < HISTORY_LIMIT;) {
  const page = await rpc<{ signature: string; err: unknown }[]>('getSignaturesForAddress',
    [drawAccount, { limit: 1_000, commitment: 'confirmed', ...(before ? { before } : {}) }]);
  signatures.push(...page);
  if (page.length < 1_000) break;
  before = page.at(-1)!.signature;
}
if (signatures.length >= HISTORY_LIMIT) console.log(`(read the newest ${HISTORY_LIMIT} transactions on the draw account only)`);

// 2: the request created the account, so it is the oldest successful request_draw in that history.
const requestIxOf = (tx: FulfilTx) => tx.meta.err ? undefined : tx.transaction.message.instructions
  .find((ix) => keysOf(tx)[ix.programIdIndex] === programId && startsWith(fromBase58(ix.data), REQUEST_DRAW));
let requestSignature = view.requestSignature;
let request = requestSignature ? await getTx(requestSignature) : null;
let requestScanCut = false;
if (!request || !requestIxOf(request)) {
  request = null;
  // Oldest first, and bounded: the account's address is public before the request creates it, so padding can sit under it too.
  const older = [...signatures].reverse().filter((s) => !s.err);
  for (const { signature } of older.slice(0, MAX_CANDIDATES)) {
    const tx = await getTx(signature);
    if (tx && requestIxOf(tx)) { request = tx; requestSignature = signature; break; }
  }
  requestScanCut = !request && (older.length > MAX_CANDIDATES || signatures.length >= HISTORY_LIMIT);
  if (request) console.log(`(request found on chain: ${requestSignature})`);
}
const requestIx = request ? requestIxOf(request) : undefined;
if (!requestIx) {
  check('request transaction is request_draw on the draw program', false,
    requestScanCut ? TOO_LONG : requestSignature ?? 'none found');
} else {
  const data = fromBase58(requestIx.data);
  const requested = Number(new DataView(data.buffer, data.byteOffset).getBigUint64(8, true));
  const ownPullId = bytesToHex(await pullIdHash(view.pullId));
  check('request names the committed sequence, this pull, its count and its pool',
    requested === sequence && bytesToHex(data.slice(16, 48)) === ownPullId
      && data[48] === pool.slots.count && bytesToHex(data.slice(49, 81)) === committedPoolHash,
    `sequence ${requested}, count ${data[48]}`);
}

// 3: every delivery to this draw account, the archived fulfilment signature included (public RPCs prune history). Anyone can
// pad the account's history with successful transactions; past MAX_CANDIDATES the check cannot say "once", so it fails, and
// says the history is too long rather than that nothing was delivered.
const candidates = new Set(signatures.filter((s) => !s.err && s.signature !== requestSignature).map((s) => s.signature));
if (view.fulfilSignature) candidates.add(view.fulfilSignature);
const truncated = candidates.size > MAX_CANDIDATES || signatures.length >= HISTORY_LIMIT;
if (truncated) console.log(`(the draw account's history is too long to read whole: ${candidates.size} candidates)`);
const deliveries: { randomness: string; signature: string }[] = [];
for (const signature of [...candidates].slice(0, MAX_CANDIDATES)) {
  const tx = await getTx(signature);
  const bytes = tx ? deliveredRandomness(tx, programId, drawAccount) : null;
  if (bytes) deliveries.push({ randomness: bytesToHex(bytes), signature });
}
check('MagicBlock delivered the published 32 bytes into fulfill_draw, once',
  !truncated && deliveries.length === 1 && deliveries[0].randomness === view.randomness,
  truncated ? `${TOO_LONG} (${candidates.size} candidates)`
    : deliveries.length ? deliveries.map((d) => `fulfilment ${d.signature}`).join(', ') : 'no fulfilment found');

// 4
const derived = await deriveSlots(pool, hexToBytes(view.randomness));
const same = derived.length === view.outcomes.length
  && derived.every((slot, i) => slot.tier === view.outcomes[i].tier && slot.key === view.outcomes[i].key);
check('the settled cards are exactly what the bytes and the pool derive', same,
  derived.map((slot) => slot.key.split(':').at(-1)).join(' '));

console.log(failed ? `\n${failed} check(s) failed`
  : receiptFile ? `\nverified pull ${pullFlag}` : `\nverified pull ${pullFlag ?? view.pullId}, WITHOUT a receipt`);
process.exit(failed ? 1 : 0);
