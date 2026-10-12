// #273: a paid pull whose signature is pinned is released only when the chain PROVES its payment can never move money: an
// error on the confirmed chain, or a confirmed block height past the blockhash's last valid height with, from a node at least
// that far along, still no status. Never on an RPC's error text, never on `isBlockhashValid` (false only means "this node does
// not know the hash", which a lagging node says about a fresh one: PR #298's review), and no RPC text reaches a response.
// Shapes observed on Surfpool 1.5.0 (26 Sept): getSignatureStatuses {context:{slot}, value:[status|null]}; getEpochInfo
// {absoluteSlot, blockHeight}; insufficient funds at preflight is -32002 with data.err {"InstructionError":[0,{"Custom":1}]};
// an expired blockhash is -32002 "Blockhash not found" with data.err "BlockhashNotFound" and no signature status.
import { env } from 'cloudflare:workers';
import { generateKeyPairSigner, getBase64EncodedWireTransaction, getTransactionDecoder, partiallySignTransaction } from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitPull, expireAbandonedPulls, preparePull } from '../src/pulls';
import type { Env } from '../src/types';

const testEnv = env as unknown as Env;
const USER = 'pinned-user';

type Chain = {
  send: () => Response;
  status: (signature?: string) => unknown;
  /** The confirmed block height `getEpochInfo` reports; the pulls here are valid through LAST_VALID. */
  height: () => number;
  /** The slot the status-answering node has reached (a node behind the height reading answers with a lower one). */
  statusSlot: () => number;
  /** Replace a whole RPC answer, to send an off-shape one. */
  raw?: (method: string) => Response | undefined;
};
const LAST_VALID = 1_000;
const HEIGHT_SLOT = 50_000;
const rpcOk = (result: unknown) => Response.json({ jsonrpc: '2.0', id: 1, result });
const rpcError = (error: Record<string, unknown>) => Response.json({ jsonrpc: '2.0', id: 1, error });
const INSUFFICIENT = { code: -32002, message: 'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1: 4 log messages:\nProgram log: Error: insufficient funds', data: { err: { InstructionError: [0, { Custom: 1 }] }, logs: ['Program log: Error: insufficient funds'] } };
const BLOCKHASH_NOT_FOUND = { code: -32002, message: 'Transaction simulation failed: Blockhash not found', data: { err: 'BlockhashNotFound', logs: [] } };
const CONFIRMED = { confirmationStatus: 'confirmed', err: null };
const FAILED = { confirmationStatus: 'confirmed', err: { InstructionError: [0, { Custom: 1 }] } };
const PROCESSED_FAILED = { confirmationStatus: 'processed', err: { InstructionError: [0, { Custom: 1 }] } };
const PROCESSED = { confirmationStatus: 'processed', err: null };
const EXPIRED_HEIGHT = () => LAST_VALID + 1;

let chain: Chain;
const calls: string[] = [];

beforeEach(async () => {
  vi.stubGlobal('isSecureContext', true);
  calls.length = 0;
  chain = { send: () => rpcOk('unused'), status: () => null, height: () => LAST_VALID - 10, statusSlot: () => HEIGHT_SLOT + 5 };
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push(method);
    // The request itself is part of the contract (PR #298's second review: a fake that answers by method alone let a
    // `processed` height and a status read without history through). A wrong request gets an RPC error, never an answer.
    if (method === 'getSignatureStatuses' && (params?.[1] as { searchTransactionHistory?: unknown })?.searchTransactionHistory !== true) {
      return rpcError({ code: -32602, message: 'status read without searchTransactionHistory' });
    }
    if (method === 'getEpochInfo' && (params?.[0] as { commitment?: unknown })?.commitment !== 'confirmed') {
      return rpcError({ code: -32602, message: 'height read at a commitment other than confirmed' });
    }
    const replaced = chain.raw?.(method);
    if (replaced) return replaced;
    if (method === 'getTokenAccountBalance') return rpcOk({ value: { amount: '10000000' } });
    if (method === 'getLatestBlockhash') return rpcOk({ value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: LAST_VALID } });
    if (method === 'getSignatureStatuses') return rpcOk({ context: { slot: chain.statusSlot() }, value: [chain.status((params?.[0] as string[])?.[0])] });
    if (method === 'getEpochInfo') return rpcOk({ absoluteSlot: HEIGHT_SLOT, blockHeight: chain.height() });
    if (method === 'sendTransaction') return chain.send();
    if (method === 'getTransaction') return rpcOk(null); // verification is not what these tests are about
    throw new Error(`unexpected RPC ${method}`);
  }));
  const db = testEnv.DB;
  await db.exec(`DELETE FROM season_streak_grants; DELETE FROM season_streaks;
    DELETE FROM season_ticket_grants; DELETE FROM season_ticket_balances;
    DELETE FROM pull_settlements; DELETE FROM payment_receipts; DELETE FROM pulls WHERE user_id = '${USER}';
    DELETE FROM users WHERE id = '${USER}';`);
  await db.exec(`DELETE FROM gacha_inventory WHERE gacha_id = 'pinned-g'; DELETE FROM gacha_inventory_versions WHERE gacha_id = 'pinned-g';
    DELETE FROM gachas WHERE id = 'pinned-g'; DELETE FROM stock_items WHERE inventory_key = 'common:PA:pinned-card';
    DELETE FROM odds_config_tiers WHERE odds_config_id IN ('pinned-paid','pinned-free'); DELETE FROM odds_configs WHERE id IN ('pinned-paid','pinned-free');
    DELETE FROM album_cards WHERE album_id = 'PA'; DELETE FROM cards WHERE id = 'pinned-card'; DELETE FROM albums WHERE id = 'PA';`);
  await db.batch([
    db.prepare("INSERT INTO albums (id, title, subtitle, cover_url, size, status, sort_order) VALUES ('PA', 'Pinned', 'Test', 'cover', 1, 'live', 90)"),
    db.prepare("INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large) VALUES ('pinned-card', 'Pinned', 'TEST', '1', 'Common', 's', 'l')"),
    db.prepare("INSERT INTO album_cards (album_id, card_id, slot) VALUES ('PA', 'pinned-card', 1)"),
    db.prepare(`INSERT INTO odds_configs (id, kind, version, total_weight, created_at) VALUES
      ('pinned-paid', 'paid', 1, 1000000, '2026-01-01T00:00:00.000Z'), ('pinned-free', 'free_common', 1, 1000000, '2026-01-01T00:00:00.000Z')`),
    db.prepare(`INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order) VALUES
      ('pinned-paid', 'common', 1000000, 'Album card', 50000, 0), ('pinned-free', 'common', 1000000, 'Album card', 50000, 0)`),
    db.prepare("INSERT INTO stock_items (inventory_key, card_id, album_id, tier, available) VALUES ('common:PA:pinned-card', 'pinned-card', 'PA', 'common', 50)"),
    db.prepare(`INSERT INTO gachas (id, album_id, name, status, supports_targeted, paid_odds_config_id, free_odds_config_id, price_base, targeted_price_base, created_at, updated_at) VALUES
      ('pinned-g', NULL, 'Pinned', 'active', 0, 'pinned-paid', 'pinned-free', 1000000, 1500000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`),
    db.prepare("INSERT INTO gacha_inventory_versions (gacha_id, inventory_version, created_at) VALUES ('pinned-g', 1, '2026-01-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO gacha_inventory (gacha_id, inventory_key) VALUES ('pinned-g', 'common:PA:pinned-card')"),
  ]);
});
// A test that times out never reaches withinConfirmationWait's `finally`: put the real clock back here, or its fakes leak on.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A prepared paid ×5 with one free pull reserved (free_paid 1 → 0), signed by the user, ready to commit. */
async function paidPull() {
  const feePayer = await generateKeyPairSigner(true);
  const user = await generateKeyPairSigner(true);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', feePayer.keyPair.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', feePayer.keyPair.publicKey));
  const secret = new Uint8Array(64); secret.set(pkcs8.slice(-32)); secret.set(pub, 32);
  const solanaEnv: Env = { ...testEnv, PAYMENTS_MODE: 'solana-rpc', ENABLED_ASSETS: 'USDC', SOLANA_RPC_URL: 'https://rpc.example',
    FEE_PAYER_ADDRESS: feePayer.address, FEE_PAYER_KEYPAIR: JSON.stringify([...secret]),
    USDC_MINT: '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547', TREASURY_USDC_TOKEN_ACCOUNT: 'FfGJNEx585tv26UsD1nh3fZooexRVFxK7Mfz8FofApVG' };
  await testEnv.DB.prepare(`INSERT INTO users (id, wallet, country, free_paid, free_common, created_at)
    VALUES (?, ?, 'MY', 1, 0, '2026-01-01T00:00:00.000Z')`).bind(USER, user.address).run();
  const prepared = await preparePull(testEnv.DB, solanaEnv, USER, { gachaId: 'pinned-g', count: 5, targeted: false, asset: 'USDC' }, crypto.randomUUID());
  const decoded = getTransactionDecoder().decode(Uint8Array.from(atob(prepared.transfer!.transactionBase64!), (c) => c.charCodeAt(0)));
  const signed = getBase64EncodedWireTransaction(await partiallySignTransaction([user.keyPair], decoded));
  expect(await freePaid()).toBe(0); // the control: the free pull is reserved
  return { solanaEnv, pullId: prepared.pullId, signed };
}
const freePaid = async () => (await testEnv.DB.prepare('SELECT free_paid FROM users WHERE id = ?').bind(USER).first<{ free_paid: number }>())!.free_paid;
const pullRow = (id: string) => testEnv.DB.prepare('SELECT status, tx_signature IS NOT NULL AS pinned FROM pulls WHERE id = ?').bind(id).first<{ status: string; pinned: number }>();
const commitWith = (p: Awaited<ReturnType<typeof paidPull>>, signed: string | undefined) =>
  commitPull(testEnv.DB, p.solanaEnv, USER, p.pullId, undefined, signed).catch((e: unknown) => e as { code: string; status: number; message: string });
const commit = (p: Awaited<ReturnType<typeof paidPull>>) => commitWith(p, p.signed);
/** The client's retry of a kept pull after a reload: it has the pull id, not the signed bytes. */
const commitWithoutBytes = (p: Awaited<ReturnType<typeof paidPull>>) => commitWith(p, undefined);
/** A payment that never confirms spends the broadcast's whole 24 s confirmation wait: run it on a fake clock. */
async function withinConfirmationWait<T>(pending: Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  try {
    for (let i = 0; i < 60 && !(await Promise.race([pending.then(() => true), Promise.resolve(false)])); i++) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}
const pastExpiry = (id: string) => testEnv.DB.prepare("UPDATE pulls SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(id).run();

describe('a pinned pull the chain says can never pay is released', () => {
  it('a transaction that landed and failed: TX_MISMATCH, and the free pull comes back at once', async () => {
    const p = await paidPull();
    chain.send = () => rpcOk('ignored');
    chain.status = () => FAILED;
    const error = await commit(p);
    expect(error).toMatchObject({ code: 'TX_MISMATCH' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'expired' });
    expect(await freePaid()).toBe(1);
  });

  it('a blockhash that really expired, with no status: EXPIRED, released', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(BLOCKHASH_NOT_FOUND);
    chain.height = EXPIRED_HEIGHT;
    expect(await commit(p)).toMatchObject({ code: 'EXPIRED' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'expired' });
    expect(await freePaid()).toBe(1);
  });
});

describe('a pinned pull that can still pay is never released, and never answered EXPIRED', () => {
  it('"Blockhash not found" from a lagging node while the blockhash is still valid: retryable, then the landed payment is not EXPIRED', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(BLOCKHASH_NOT_FOUND);
    chain.height = () => LAST_VALID - 10;
    const first = await commit(p);
    expect(first).toMatchObject({ code: 'TX_NOT_FOUND', status: 503 });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
    // The earlier broadcast lands after all. The retry reads that, instead of an earlier guess having expired the pull.
    chain.status = () => CONFIRMED;
    const retry = await commit(p);
    expect(retry).not.toMatchObject({ code: 'EXPIRED' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(calls).toContain('getTransaction'); // it went on to verify the payment
  });

  it('a payment that lands in its blockhash\'s last valid block is seen landed, not expired (the status is read again after the blockhash)', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(BLOCKHASH_NOT_FOUND);
    chain.height = EXPIRED_HEIGHT;
    let asked = 0;
    // No status before sending, none before the blockhash check; there is one by the time it is read again (the 3rd read).
    chain.status = () => (++asked >= 3 ? CONFIRMED : null);
    const error = await commit(p);
    expect(error).not.toMatchObject({ code: 'EXPIRED' });
    expect(asked).toBeGreaterThanOrEqual(3); // the control: the landing was only visible on the re-read
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
  });

  it('insufficient funds at preflight: INSUFFICIENT_FUNDS, no RPC text, still pinned, free pull still reserved', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    const error = await commit(p) as { code: string; message: string };
    expect(error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', status: 409 });
    expect(error.message).not.toMatch(/simulation|program|log|0x1/i);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
  });

  it('any other RPC error: a fixed, retryable message, never the node\'s text', async () => {
    const p = await paidPull();
    chain.send = () => rpcError({ code: -32005, message: 'Node is behind by 42 slots; internal: secret-host-7' });
    const error = await commit(p) as { code: string; message: string };
    expect(error).toMatchObject({ code: 'TX_NOT_FOUND', status: 503, message: 'The payment could not be sent yet; retry safely' });
    expect(error.message).not.toMatch(/Node is behind|secret-host/);
    expect(await freePaid()).toBe(0);
  });
});

describe('the sweep and the commit without bytes read the chain for a pinned pull past its expiry', () => {
  it('the sweep keeps a pinned pull while its blockhash is valid, and releases it once expired with no status', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await pastExpiry(p.pullId);
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
    chain.height = EXPIRED_HEIGHT;
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'expired' });
    expect(await freePaid()).toBe(1);
  });

  it('the sweep gives up on a hung RPC within its budget, and releases nothing on the abandoned reads', async () => {
    const first = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(first);
    await pastExpiry(first.pullId);
    // Every read hangs until the RPC's own 8 s abort, the shape a stuck node gives: without a budget, one read alone is 8 s.
    const hung = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', hung);
    const started = Date.now();
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), first.solanaEnv, 300);
    const took = Date.now() - started;
    expect(took).toBeLessThan(2_000);
    expect(hung).toHaveBeenCalled(); // the sweep did reach the chain, and stopped waiting on it
    expect(await pullRow(first.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
  });

  // #306: five pinned pulls the sweep can never settle (their payments confirmed, nobody committed them: #268) used to fill its
  // LIMIT 5 window for good, so a sixth, provably expired one was never released. The sweep now asks the least recently
  // checked first.
  it('pulls the sweep cannot settle do not hold its window: a sixth, expired one is released on the next sweep', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await pastExpiry(p.pullId);
    for (let i = 0; i < 5; i++) {
      await testEnv.DB.prepare(`INSERT INTO pulls (id, user_id, idem, sequence, gacha_id, inventory_version, album_id, odds_config_id,
          free_odds_config_id, client_seed, seed_source, count, targeted, asset, cost_base, reserved_paid, reserved_common, status,
          expires_at, payment_transaction_base64, payment_last_valid_block_height, tx_signature, created_at)
        SELECT ?, user_id, ?, (SELECT MAX(sequence) + 1 FROM pulls), gacha_id, inventory_version, album_id, odds_config_id,
          free_odds_config_id, client_seed, seed_source, count, targeted, asset, cost_base, 0, 0, 'prepared',
          '2019-01-01T00:00:00.000Z', payment_transaction_base64, payment_last_valid_block_height, ?, created_at
        FROM pulls WHERE id = ?`).bind(`orphan-pull-${i}`, `orphan-idem-${i}`, `orphan-sig-${i}`, p.pullId).run();
    }
    // The orphans expire first, so an expiry-ordered window of five holds only them. Each one's payment landed; the pull's did not.
    chain.status = (signature) => (signature?.startsWith('orphan-sig-') ? CONFIRMED : null);
    chain.height = EXPIRED_HEIGHT;
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'expired' });
    expect(await freePaid()).toBe(1);
    for (let i = 0; i < 5; i++) expect(await pullRow(`orphan-pull-${i}`)).toMatchObject({ status: 'prepared' }); // never released
  });

  // PR #311's review: deployed ahead of its ALTER, the sweep's SELECT names a column that does not exist. It runs in front of
  // every signed-in request, so it must turn itself off, not fail the request.
  it('a sweep that cannot read its pulls returns without releasing anything', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await pastExpiry(p.pullId);
    chain.height = EXPIRED_HEIGHT;
    const real = testEnv.DB.prepare.bind(testEnv.DB);
    const spy = vi.spyOn(testEnv.DB, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('ORDER BY payment_checked_at')) throw new Error('D1_ERROR: no such column: payment_checked_at');
      return real(sql);
    });
    try {
      await expect(expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv)).resolves.toBeUndefined();
    } finally { spy.mockRestore(); }
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
  });

  it('the sweep never releases a pinned pull whose payment landed, and does not ask the chain without env', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await pastExpiry(p.pullId);
    chain.status = () => CONFIRMED;
    chain.height = EXPIRED_HEIGHT;
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    chain.status = () => null;
    calls.length = 0;
    await expireAbandonedPulls(testEnv.DB, USER);
    expect(calls).toEqual([]);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
  });

  it('a commit without bytes on a pinned pull: expired → EXPIRED released; landed → verified, not EXPIRED; failed → released', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await pastExpiry(p.pullId);
    chain.status = () => CONFIRMED;
    calls.length = 0;
    expect(await commitWithoutBytes(p)).not.toMatchObject({ code: 'EXPIRED' });
    expect(calls).toContain('getTransaction');
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    chain.status = () => null;
    chain.height = () => LAST_VALID - 10;
    expect(await commitWithoutBytes(p)).toMatchObject({ code: 'TX_NOT_FOUND' });
    expect(await freePaid()).toBe(0);
    chain.height = EXPIRED_HEIGHT;
    expect(await commitWithoutBytes(p)).toMatchObject({ code: 'EXPIRED' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'expired' });
    expect(await freePaid()).toBe(1);
  });

  it('a commit without bytes on a pinned pull that failed on chain: TX_MISMATCH, released', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    chain.status = () => FAILED;
    expect(await commitWithoutBytes(p)).toMatchObject({ code: 'TX_MISMATCH' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'expired' });
    expect(await freePaid()).toBe(1);
  });
});

describe("PR #298's review: nothing a node that is behind can say releases a pull", () => {
  it('the review\'s P1: the send fails (502), the node knows no newer block, the payment then lands — not EXPIRED, not released, then verified', async () => {
    const p = await paidPull();
    chain.send = () => new Response('bad gateway', { status: 502 });
    chain.height = () => LAST_VALID - 200; // behind: has not seen the blockhash's lifetime pass
    const first = await commit(p);
    expect(first).toMatchObject({ code: 'TX_NOT_FOUND' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
    chain.status = () => CONFIRMED; // it landed after all
    calls.length = 0;
    expect(await commitWithoutBytes(p)).not.toMatchObject({ code: 'EXPIRED' });
    expect(calls).toContain('getTransaction');
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
  });

  it('a height AT the lifetime is not past it: a transaction can still land in the next block (agave accepts a blockhash 151 blocks on)', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(BLOCKHASH_NOT_FOUND);
    chain.height = () => LAST_VALID;
    expect(await commit(p)).not.toMatchObject({ code: 'EXPIRED' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
    chain.height = EXPIRED_HEIGHT; // one block on: now it is past, and with no status from a node that far along, proof
    expect(await commitWithoutBytes(p)).toMatchObject({ code: 'EXPIRED' });
  });

  it('a height past the lifetime, but the status read answered by a node behind that height: unknown, not released', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(BLOCKHASH_NOT_FOUND);
    chain.height = EXPIRED_HEIGHT;
    chain.statusSlot = () => HEIGHT_SLOT - 1;
    expect(await commit(p)).not.toMatchObject({ code: 'EXPIRED' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
    chain.statusSlot = () => HEIGHT_SLOT; // a node as far along as the height reading: now it is proof
    expect(await commitWithoutBytes(p)).toMatchObject({ code: 'EXPIRED' });
    expect(await freePaid()).toBe(1);
  });

  it('a processed status found on the re-read after the lifetime passed is pending, not expired', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(BLOCKHASH_NOT_FOUND);
    chain.height = EXPIRED_HEIGHT;
    let asked = 0;
    chain.status = () => (++asked >= 3 ? PROCESSED : null);
    const error = await withinConfirmationWait(commit(p));
    expect(error).not.toMatchObject({ code: 'EXPIRED' });
    expect(asked).toBeGreaterThanOrEqual(3);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
  });

  it('an error that is only processed (a fork that may be dropped) releases nothing', async () => {
    const p = await paidPull();
    chain.send = () => rpcOk('ignored');
    chain.status = () => PROCESSED_FAILED;
    expect(await withinConfirmationWait(commit(p))).not.toMatchObject({ code: 'TX_MISMATCH' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
  });

  it('an off-shape answer is an error, never "no status" or "past the lifetime": nothing released', async () => {
    for (const raw of [
      (m: string) => (m === 'getSignatureStatuses' ? rpcOk({ value: null }) : undefined),
      (m: string) => (m === 'getSignatureStatuses' ? rpcOk({ value: [null] }) : undefined), // no context slot
      (m: string) => (m === 'getEpochInfo' ? rpcOk({ absoluteSlot: HEIGHT_SLOT }) : undefined),
      (m: string) => (m === 'getEpochInfo' ? rpcOk({ absoluteSlot: HEIGHT_SLOT, blockHeight: String(LAST_VALID + 5) }) : undefined),
      (m: string) => (m === 'getEpochInfo' ? rpcOk({ blockHeight: LAST_VALID + 5 }) : undefined), // a height with no slot to hold the status read to
    ]) {
      await testEnv.DB.prepare('DELETE FROM pull_settlements').run();
      await testEnv.DB.prepare('DELETE FROM season_streak_grants WHERE user_id = ?').bind(USER).run();
      await testEnv.DB.prepare('DELETE FROM season_streaks WHERE user_id = ?').bind(USER).run();
      await testEnv.DB.prepare('DELETE FROM season_ticket_grants WHERE user_id = ?').bind(USER).run();
      await testEnv.DB.prepare('DELETE FROM season_ticket_balances WHERE user_id = ?').bind(USER).run();
      await testEnv.DB.prepare('DELETE FROM pulls WHERE user_id = ?').bind(USER).run();
      await testEnv.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER).run();
      const p = await paidPull();
      chain.send = () => rpcError(BLOCKHASH_NOT_FOUND);
      chain.height = EXPIRED_HEIGHT;
      chain.raw = raw;
      await commit(p);
      await pastExpiry(p.pullId);
      await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
      chain.raw = undefined;
      expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared' });
      expect(await freePaid()).toBe(0);
    }
  });

  it('a pull with no stored lifetime (a row from before the column) never expires on chain evidence', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await testEnv.DB.prepare('UPDATE pulls SET payment_last_valid_block_height = NULL WHERE id = ?').bind(p.pullId).run();
    await pastExpiry(p.pullId);
    chain.height = EXPIRED_HEIGHT;
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
    expect(await commitWithoutBytes(p)).toMatchObject({ code: 'TX_NOT_FOUND' });
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
  });
});

describe('the sweep', () => {
  it('releases a pinned pull whose payment failed on the confirmed chain', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await pastExpiry(p.pullId);
    chain.status = () => FAILED;
    await expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv);
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'expired' });
    expect(await freePaid()).toBe(1);
  });

  it('an RPC that is down never fails the sweep (the user\'s request goes on) and releases nothing', async () => {
    const p = await paidPull();
    chain.send = () => rpcError(INSUFFICIENT);
    await commit(p);
    await pastExpiry(p.pullId);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    await expect(expireAbandonedPulls(testEnv.DB, USER, new Date(), p.solanaEnv)).resolves.toBeUndefined();
    expect(await pullRow(p.pullId)).toMatchObject({ status: 'prepared', pinned: 1 });
    expect(await freePaid()).toBe(0);
  });
});
