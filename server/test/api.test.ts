import { env } from 'cloudflare:workers';
import { Proof, PublicKey } from '@blueshift-gg/solana-ecvrf';
import {
  blockhash, compileTransaction, createTransactionMessage, generateKeyPairSigner, getBase64EncodedWireTransaction,
  getSignatureFromTransaction, getTransactionDecoder, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { burnExtras, uniformIndex } from '../src/actions';
import { claimFaucet, FAUCET_STUCK, faucetGrantWallet, faucetInfo, linkedBy, signedLifetime, solanaFaucetChain, type FaucetChain } from '../src/faucet';
import { ApiError } from '../src/http';
import { ALREADY_CLAIMED, GIFT_UNAVAILABLE } from '../src/jupiterGift';
import { INFINITE_AVAILABLE_REPORT } from '../src/stock';
import { dayKey } from '../src/db';
import { commitPull, expireFailedPaymentAuthorization, preparePull } from '../src/pulls';
import { buildDeposit, submitDeposit, type DepositChain } from '../src/deposits';
import { PaymentOutcome } from '../src/payments';
import type { Env } from '../src/types';

const testEnv = env as unknown as Env;
const adminKey = 'local-development-admin-key-000000000000';
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
async function request(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`http://example.test${path}`, init), testEnv);
}

async function requestFromCountry(path: string, country: string, init?: RequestInit, requestEnv: Env = testEnv) {
  const edgeRequest = new Request(`http://example.test${path}`, init);
  Object.defineProperty(edgeRequest, 'cf', { value: { country } });
  return worker.fetch(edgeRequest, requestEnv);
}

async function post(path: string, value: Record<string, unknown>, idem: string = crypto.randomUUID()) {
  return request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idem }, body: JSON.stringify({ ...value, idem }) });
}

// #402: an album's Claim is one house-funded Jupiter gift, and no holo. These tests never reach tcgapi.jup.ag: `fetch` is
// stubbed with a fake tcgapi that answers the four calls the live client makes and throws on anything else, so the route,
// the live client's parsing and the real house signature all run. The house key is generated per test.
type FakeTcg = {
  generated: number; submitted: string[]; failGenerate: boolean; calls: string[];
  /** 'reject': tcgapi refuses the submit. 'lost': the gift lands, then the answer is lost (502). */
  failSubmit?: 'reject' | 'lost';
  /** Set to hold the next generate open: `entered` resolves once tcgapi has it, `release` lets it answer. */
  hold?: { entered: () => void; until: Promise<void> };
  /** Per-generate gates, taken in arrival order before `hold`: each holds one generate open until it answers or fails. */
  gates: { entered: () => void; until: Promise<'answer' | 'fail'> }[];
  /** The pack count generate answers with: anything but 1 is a gift the claim did not ask for. */
  generateCount?: number;
};
async function giftWorld() {
  const house = await generateKeyPairSigner(true);
  const receiver = (await generateKeyPairSigner()).address;
  const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', house.keyPair.privateKey));
  const secret = new Uint8Array(64);
  secret.set(privatePkcs8.slice(-32));
  secret.set(new Uint8Array(await crypto.subtle.exportKey('raw', house.keyPair.publicKey)), 32);
  const unsigned = getBase64EncodedWireTransaction(compileTransaction(pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(house.address, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n,
    }, message),
  )));
  await testEnv.DB.prepare("UPDATE users SET wallet = ? WHERE id = 'demo-user'").bind(receiver).run();
  const tcg: FakeTcg = { generated: 0, submitted: [], failGenerate: false, calls: [], gates: [] };
  const landed = () => [...new Set(tcg.submitted)].map((txSignature) => ({
    giftId: 'gift-1', memo: 'memo-1', packType: 'degen_100', count: 1, counterparty: receiver, txSignature,
  }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    tcg.calls.push(url.pathname);
    if (url.origin !== 'https://tcgapi.jup.ag') throw new Error(`unexpected fetch ${url.origin}`);
    await new Promise((resolve) => setTimeout(resolve, 5)); // let a racing claim interleave
    if (url.pathname === '/v1/gifts/generate' && init?.method === 'POST') {
      if (tcg.failGenerate) return new Response('down', { status: 500 });
      expect(JSON.parse(String(init.body))).toEqual({ sender: house.address, receiver, packType: 'degen_100', count: 1 });
      tcg.generated += 1;
      const gate = tcg.gates.shift();
      if (gate) {
        gate.entered();
        if (await gate.until === 'fail') return new Response('down', { status: 500 });
      } else if (tcg.hold) { tcg.hold.entered(); await tcg.hold.until; }
      return Response.json({ giftId: 'gift-1', totalCost: '1000000', count: tcg.generateCount ?? 1, packType: 'degen_100',
        transaction: { memo: 'memo-1', transaction: unsigned } });
    }
    if (url.pathname === '/v1/packs/submit' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { signedTransaction: string; memo: string };
      expect(body.memo).toBe('memo-1');
      const signed = getTransactionDecoder().decode(Uint8Array.from(atob(body.signedTransaction), (c) => c.charCodeAt(0)));
      const signature = getSignatureFromTransaction(signed);
      if (tcg.failSubmit === 'reject') return new Response('rejected', { status: 500 });
      tcg.submitted.push(signature);
      if (tcg.failSubmit === 'lost') return new Response('bad gateway', { status: 502 });
      return Response.json({ signature, confirmationStatus: 'confirmed' });
    }
    if (url.pathname === '/v1/gifts') return Response.json({ sent: landed() });
    if (url.pathname === '/v1/packs/purchased') return Response.json({ breakdown: { degen_100: { gifted: landed().length } } });
    throw new Error(`unexpected tcgapi call ${url.pathname}`);
  }));
  const env: Env = { ...testEnv, JUPITER_GIFT_ENABLED: 'true', HOUSE_SENDER_ADDRESS: house.address,
    HOUSE_SENDER_SECRET: JSON.stringify([...secret]) };
  const claim = async (idem: string, claimEnv: Env = env) => {
    const response = await worker.fetch(new Request('http://example.test/completion-claims', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idem },
      body: JSON.stringify({ albumId: 'A', idem }),
    }), claimEnv);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const expectedGift = () => ({ outcomes: [], gift: {
    status: 'confirmed', packType: 'degen_100', count: 1, giftId: 'gift-1', signature: tcg.submitted[0], receiver,
    openUrl: 'https://jup.ag/gacha',
  } });
  const ledger = async () => ({
    completionItems: (await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM user_inventory WHERE source_kind = 'completion'`)
      .first<{ n: number }>())!.n,
    rewards: (await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM completion_rewards').first<{ n: number }>())!.n,
    claimedAt: (await testEnv.DB.prepare("SELECT claimed_at FROM album_completions WHERE user_id = 'demo-user' AND album_id = 'A'")
      .first<{ claimed_at: string | null }>())?.claimed_at ?? null,
    gift: await testEnv.DB.prepare("SELECT status, gift_id, tx_signature FROM jupiter_gift_claims WHERE user_id = 'demo-user' AND album_id = 'A'")
      .first<{ status: string; gift_id: string | null; tx_signature: string | null }>(),
  });
  const holdGenerate = () => {
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    tcg.hold = { entered, until: new Promise<void>((resolve) => { release = resolve; }) };
    return { reached, release };
  };
  /** Holds the next generate to arrive (one only), until `answer()` or `fail()`. */
  const gateGenerate = () => {
    let entered!: () => void;
    let settle!: (outcome: 'answer' | 'fail') => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    tcg.gates.push({ entered, until: new Promise((resolve) => { settle = resolve; }) });
    return { reached, answer: () => settle('answer'), fail: () => settle('fail') };
  };
  return { env, tcg, claim, expectedGift, ledger, holdGenerate, gateGenerate };
}
const seedCompletedAlbum = () => testEnv.DB.prepare(
  "INSERT INTO album_completions (user_id, album_id, completed_at) VALUES ('demo-user', 'A', '2026-01-01T00:00:00.000Z')").run();

beforeEach(async () => {
  vi.stubGlobal('isSecureContext', true);
  const db = testEnv.DB;
  await db.exec(`
    DELETE FROM season_streak_grants; DELETE FROM season_streaks;
    DELETE FROM season_ticket_grants; DELETE FROM season_ticket_balances;
    DELETE FROM completion_rewards; DELETE FROM jupiter_gift_claims; DELETE FROM album_completions; DELETE FROM idempotency; DELETE FROM deposits;
    DELETE FROM pull_outcomes; DELETE FROM payment_obligations; DELETE FROM payment_receipts; DELETE FROM pull_settlements; DELETE FROM pulls;
    DELETE FROM inventory_consumptions; DELETE FROM user_inventory; DELETE FROM gacha_inventory; DELETE FROM gacha_inventory_versions; DELETE FROM gachas; DELETE FROM stock_items;
    DELETE FROM odds_config_tiers; DELETE FROM odds_configs; DELETE FROM album_cards; DELETE FROM cards;
    DELETE FROM albums; DELETE FROM faucet_grants; DELETE FROM balances; DELETE FROM users;
    UPDATE gacha_state SET next_pull_sequence = 1 WHERE singleton = 1;
  `);
  await db.batch([
    db.prepare("INSERT INTO users (id, wallet, country, free_paid, created_at) VALUES ('demo-user', 'wallet', 'MY', 1, '2026-01-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO balances (user_id, asset, amount) VALUES ('demo-user', 'USDC', 5000000), ('demo-user', 'USDT', 0)"),
    db.prepare("INSERT INTO albums (id, title, subtitle, cover_url, size, status, sort_order) VALUES ('A', 'Test Album', 'Test', 'cover', 1, 'live', 0)"),
    db.prepare("INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large) VALUES ('card-1', 'Card One', 'TEST', '1', 'Common', 'small', 'large')"),
    db.prepare("INSERT INTO album_cards (album_id, card_id, slot) VALUES ('A', 'card-1', 1)"),
    db.prepare(`INSERT INTO odds_configs (id, kind, version, total_weight, created_at) VALUES
      ('paid-v1', 'paid', 1, 1000000, '2026-01-01T00:00:00.000Z'),
      ('free-v1', 'free_common', 1, 1000000, '2026-01-01T00:00:00.000Z')`),
    db.prepare(`INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order) VALUES
      ('paid-v1', 'common', 1000000, 'Album card', 50000, 0),
      ('free-v1', 'common', 1000000, 'Album card', 50000, 0)`),
    db.prepare("INSERT INTO stock_items (inventory_key, card_id, album_id, tier, available) VALUES ('common:A:card-1', 'card-1', 'A', 'common', 5)"),
    db.prepare(`INSERT INTO gachas
      (id, album_id, name, status, supports_targeted, paid_odds_config_id,
        free_odds_config_id, price_base, targeted_price_base, created_at, updated_at) VALUES
      ('all-cards', NULL, 'All Cards', 'active', 0, 'paid-v1', 'free-v1', 1000000, 1500000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('album:A', 'A', 'Test Album', 'active', 1, 'paid-v1', 'free-v1', 1000000, 1500000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`),
    db.prepare(`INSERT INTO gacha_inventory_versions (gacha_id, inventory_version, created_at) VALUES
      ('all-cards', 1, '2026-01-01T00:00:00.000Z'), ('album:A', 1, '2026-01-01T00:00:00.000Z')`),
    db.prepare(`INSERT INTO gacha_inventory (gacha_id, inventory_key) VALUES
      ('all-cards', 'common:A:card-1'), ('album:A', 'common:A:card-1')`),
  ]);
});

// A test that times out never reaches its own `finally`: put the real clock back here, or its faked Date leaks on.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('gachapon Worker', () => {
  // #276: one grant per account, to whichever wallet it first asks for. Since #256 each linked wallet drew its own grant,
  // and each new wallet cost the fee payer a token account's rent; a scripted client could drain it.
  const faucetEnvFor = (): Env => ({ ...testEnv, ENVIRONMENT: 'preview', PAYMENTS_MODE: 'solana-rpc',
    FAUCET_ENABLED: 'true', FAUCET_GRANT_BASE: '20000000' });
  const recordingChain = () => {
    const sent: string[] = [];
    const prepared: string[] = [];
    const chain: FaucetChain = {
      async prepare(_env, grant) { prepared.push(grant.wallet); return { signature: `sig:${grant.wallet}`, transactionBase64: `tx:${grant.wallet}`, lastValidBlockHeight: 1_000 }; },
      async broadcast(_env, transfer) { sent.push(transfer.signature); return 'sent' as const; },
    };
    return { chain, sent, prepared };
  };
  const grants = async () => (await testEnv.DB.prepare('SELECT wallet, status FROM faucet_grants WHERE user_id = ?')
    .bind('demo-user').all<{ wallet: string; status: string }>()).results;

  it('one faucet grant per account: a second wallet gets "already claimed", and nothing is sent to it', async () => {
    const { chain, sent, prepared } = recordingChain();
    const first = await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain });
    expect(first).toMatchObject({ alreadyClaimed: false, signature: 'sig:wallet' });
    const second = await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet: 'connected-wallet', chain });
    expect(second).toMatchObject({ alreadyClaimed: true, signature: 'sig:wallet' });
    for (const wallet of ['another-1', 'another-2']) {
      await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet: wallet, chain });
    }
    expect(prepared).toEqual(['wallet']);
    expect(sent).toEqual(['sig:wallet']);
    expect(await grants()).toEqual([{ wallet: 'wallet', status: 'sent' }]);
  });

  it('the first wallet asked for is the account\'s grant, whichever it is (a connected wallet first, then the embedded one)', async () => {
    const { chain, sent } = recordingChain();
    await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet: 'connected-wallet', chain });
    expect(await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain })).toMatchObject({ alreadyClaimed: true });
    expect(sent).toEqual(['sig:connected-wallet']);
  });

  it('two claims at once, for two wallets, reserve one grant between them and send one transfer', async () => {
    const { chain, sent } = recordingChain();
    const results = await Promise.allSettled([
      claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain }),
      claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet: 'connected-wallet', chain }),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await grants()).length).toBe(1);
    // Each may sign its own transfer (#304: a reserved grant goes to the wallet asked for), but one is written and only that
    // one is sent, and the row names the wallet it pays.
    expect(new Set(sent).size).toBe(1);
    const [row] = await grants();
    expect(sent[0]).toBe(`sig:${row.wallet}`);
  });

  it('a signed grant is finished to its own wallet only while that wallet is still the account\'s (#304)', async () => {
    const { chain, sent } = recordingChain();
    const failing: FaucetChain = { prepare: chain.prepare, async broadcast() { throw new Error('rpc down'); } };
    await expect(claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet: 'connected-wallet', chain: failing })).rejects.toThrow();
    expect(await grants()).toEqual([{ wallet: 'connected-wallet', status: 'prepared' }]);
    // Unlinked since: nothing is sent, and the answer is the hand-fix one, not "try again".
    await expect(claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain, isLinked: async () => false }))
      .rejects.toMatchObject({ status: 409, message: FAUCET_STUCK });
    await expect(claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain })) // no answer at all counts as not linked
      .rejects.toMatchObject({ status: 409 });
    expect(sent).toEqual([]);
    // Still linked: sent there, whichever wallet the request names.
    const asked: string[] = [];
    await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain, isLinked: async (wallet) => { asked.push(wallet); return true; } });
    expect(asked).toEqual(['connected-wallet']);
    expect(sent).toEqual(['sig:connected-wallet']);
    expect(await grants()).toEqual([{ wallet: 'connected-wallet', status: 'sent' }]);
  });

  it('a database that already holds two grants for one account (the old per-wallet key) gives it no third, and reports claimed', async () => {
    const now = '2026-09-20T00:00:00.000Z';
    await testEnv.DB.exec("DROP INDEX IF EXISTS idx_faucet_grants_one_per_user");
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, signature, transaction_base64, created_at, sent_at)
        VALUES ('old-1', 'demo-user', 'wallet', ?, 20000000, 'sent', 'sig-old-1', 'tx', ?, ?)`).bind(testEnv.USDC_MINT, now, now),
      testEnv.DB.prepare(`INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, signature, transaction_base64, created_at, sent_at)
        VALUES ('old-2', 'demo-user', 'connected-wallet', ?, 20000000, 'sent', 'sig-old-2', 'tx', ?, ?)`).bind(testEnv.USDC_MINT, now, now),
    ]);
    const { chain, prepared } = recordingChain();
    expect(await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet: 'third-wallet', chain })).toMatchObject({ alreadyClaimed: true });
    expect(prepared).toEqual([]);
    expect((await grants()).length).toBe(2);
    expect(await faucetGrantWallet(testEnv.DB, 'demo-user')).not.toBeNull();
  });

  const oldGrant = (id: string, wallet: string, status: 'reserved' | 'prepared' | 'sent', at: string, mint = testEnv.USDC_MINT) =>
    testEnv.DB.prepare(`INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, signature, transaction_base64, created_at, sent_at)
      VALUES (?, 'demo-user', ?, ?, 20000000, ?, ?, ?, ?, ?)`).bind(id, wallet, mint, status,
      status === 'reserved' ? null : `sig-${id}`, status === 'reserved' ? null : 'tx', at, status === 'sent' ? at : null);

  it('an older reserved grant beside a newer prepared one: the prepared one is re-broadcast, the reserved one never prepared (PR #302 review 2)', async () => {
    await testEnv.DB.exec('DROP INDEX IF EXISTS idx_faucet_grants_one_per_user');
    await testEnv.DB.batch([
      oldGrant('old-1', 'wallet', 'reserved', '2026-09-20T00:00:00.000Z'),
      oldGrant('old-2', 'connected-wallet', 'prepared', '2026-09-21T00:00:00.000Z'),
    ]);
    const { chain, prepared, sent } = recordingChain();
    expect(await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain, isLinked: async () => true }))
      .toMatchObject({ signature: 'sig-old-2', wallet: 'connected-wallet', alreadyClaimed: true });
    expect([prepared, sent]).toEqual([[], ['sig-old-2']]);
  });

  it('a sent grant beside a prepared one: the prepared one is not re-broadcast, whichever is older', async () => {
    await testEnv.DB.exec('DROP INDEX IF EXISTS idx_faucet_grants_one_per_user');
    for (const [first, second] of [['prepared', 'sent'], ['sent', 'prepared']] as const) {
      await testEnv.DB.prepare('DELETE FROM faucet_grants').run();
      await testEnv.DB.batch([
        oldGrant('old-1', 'wallet', first, '2026-09-20T00:00:00.000Z'),
        oldGrant('old-2', 'connected-wallet', second, '2026-09-21T00:00:00.000Z'),
      ]);
      const sentId = first === 'sent' ? 'old-1' : 'old-2';
      const { chain, prepared, sent } = recordingChain();
      expect(await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain }))
        .toMatchObject({ alreadyClaimed: true, signature: `sig-${sentId}` });
      expect([prepared, sent]).toEqual([[], []]);
    }
  });

  it('of two reserved grants, the oldest is the account\'s', async () => {
    await testEnv.DB.exec('DROP INDEX IF EXISTS idx_faucet_grants_one_per_user');
    await testEnv.DB.batch([
      oldGrant('old-2', 'connected-wallet', 'reserved', '2026-09-21T00:00:00.000Z'),
      oldGrant('old-1', 'wallet', 'reserved', '2026-09-20T00:00:00.000Z'),
    ]);
    const { chain, prepared } = recordingChain();
    await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain });
    expect(prepared).toEqual(['wallet']);
  });

  it('an older unfinished grant beside a newer sent one (the old per-wallet key) is not sent a second time (PR #302 review)', async () => {
    await testEnv.DB.exec('DROP INDEX IF EXISTS idx_faucet_grants_one_per_user');
    // Both orders: the sent grant wins whether it is the older or the newer, so the choice is by status, not by age.
    for (const [first, second] of [['reserved', 'sent'], ['sent', 'reserved']] as const) {
      await testEnv.DB.prepare('DELETE FROM faucet_grants').run();
      await testEnv.DB.batch([
        oldGrant('old-1', 'wallet', first, '2026-09-20T00:00:00.000Z'),
        oldGrant('old-2', 'connected-wallet', second, '2026-09-21T00:00:00.000Z'),
      ]);
      const sentId = first === 'sent' ? 'old-1' : 'old-2';
      const sentWallet = first === 'sent' ? 'wallet' : 'connected-wallet';
      const { chain, prepared, sent } = recordingChain();
      for (const targetWallet of [undefined, 'third-wallet', 'wallet', 'connected-wallet']) {
        expect(await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet, chain }))
          .toMatchObject({ alreadyClaimed: true, signature: `sig-${sentId}`, wallet: sentWallet });
      }
      expect([prepared, sent]).toEqual([[], []]);
      expect(await faucetGrantWallet(testEnv.DB, 'demo-user')).not.toBeNull();
    }
  });

  it('a reserved grant whose prepare failed goes to the wallet the next request names, checked by its caller (#304)', async () => {
    const { chain, sent, prepared } = recordingChain();
    const failing: FaucetChain = { async prepare() { throw new Error('faucet empty'); }, broadcast: chain.broadcast };
    await expect(claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet: 'connected-wallet', chain: failing })).rejects.toThrow();
    expect(await grants()).toEqual([{ wallet: 'connected-wallet', status: 'reserved' }]);
    expect(await faucetGrantWallet(testEnv.DB, 'demo-user')).toBeNull(); // an unfinished grant is not a claimed account
    // Nothing was signed, so the grant is not bound to connected-wallet, which may have been unlinked since.
    expect(await claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain }))
      .toMatchObject({ alreadyClaimed: false, wallet: 'wallet' });
    expect([prepared, sent]).toEqual([['wallet'], ['sig:wallet']]);
    expect(await grants()).toEqual([{ wallet: 'wallet', status: 'sent' }]);
    expect(await faucetGrantWallet(testEnv.DB, 'demo-user')).toBe('wallet');
  });

  it('of claims racing for different wallets, only the one whose wallet got the grant is told it was funded', async () => {
    const { chain } = recordingChain();
    const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((targetWallet) =>
      claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { targetWallet, chain })));
    expect(results.filter((result) => !result.alreadyClaimed)).toHaveLength(1);
    const funded = results.find((result) => !result.alreadyClaimed)!;
    expect(results.every((result) => result.wallet === funded.wallet)).toBe(true);
  });

  it('an unfinished grant for another mint or amount is refused, not sent', async () => {
    await testEnv.DB.batch([oldGrant('stale', 'wallet', 'reserved', '2026-09-20T00:00:00.000Z', 'OtherMint1111111111111111111111111111111111')]);
    const { chain, prepared } = recordingChain();
    await expect(claimFaucet(testEnv.DB, faucetEnvFor(), 'demo-user', { chain })).rejects.toMatchObject({ status: 409 });
    expect(prepared).toEqual([]);
  });

  it('persists one connected-wallet deposit signature and resumes broadcast without signing again', async () => {
    const sourceWallet = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
    let prepares = 0;
    let accepts = 0;
    let broadcasts = 0;
    const chain: DepositChain = {
      async build(_env, input) {
        prepares += 1;
        expect(input).toMatchObject({ sourceWallet, destinationWallet: 'wallet', amount: 2_500_000 });
        return { transactionBase64: 'unsigned-deposit', lastValidBlockHeight: 1_000 };
      },
      async accept(prepared, signed, wallet) {
        accepts += 1;
        expect({ prepared, signed, wallet }).toEqual({ prepared: 'unsigned-deposit', signed: 'user-signed', wallet: sourceWallet });
        return { signature: 'deposit-signature', transactionBase64: 'fully-signed' };
      },
      async broadcast() {
        broadcasts += 1;
        if (broadcasts === 1) throw new Error('lost RPC response');
        return 'deposit-signature';
      },
    };
    const prepared = await buildDeposit(testEnv.DB, testEnv, 'demo-user', {
      sourceWallet, amount: 2_500_000,
    }, 'deposit-one', chain);
    expect(prepared).toMatchObject({ status: 'prepared', amount: 2_500_000, destination: 'wallet' });
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', prepared.depositId, 'user-signed', chain))
      .rejects.toThrow('lost RPC response');
    expect(await testEnv.DB.prepare('SELECT status, tx_signature FROM deposits WHERE id = ?')
      .bind(prepared.depositId).first()).toMatchObject({ status: 'signed', tx_signature: 'deposit-signature' });
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', prepared.depositId, undefined, chain))
      .resolves.toMatchObject({ signature: 'deposit-signature', amount: 2_500_000 });
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', prepared.depositId, undefined, chain))
      .resolves.toMatchObject({ signature: 'deposit-signature' });
    expect({ prepares, accepts, broadcasts }).toEqual({ prepares: 1, accepts: 1, broadcasts: 2 });
  });

  // #266: a signed deposit whose broadcast can never land used to answer the same dead bytes forever.
  // The same key, same amount, next build is a fresh transfer that can be signed and committed.
  it.each([
    ['expired', new PaymentOutcome('EXPIRED', 'The signed payment authorization expired', true)],
    ['failed on chain', new PaymentOutcome('TX_MISMATCH', 'The payment did not go through. Nothing was charged.', true)],
  ])('rebuilds a signed deposit whose broadcast %s, under the same idempotency key and amount', async (kind, failure) => {
    const sourceWallet = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
    let builds = 0;
    const heights: Array<number | null> = [];
    const chain: DepositChain = {
      async build() {
        builds += 1;
        return { transactionBase64: `unsigned-${builds}`, lastValidBlockHeight: 1_000 + builds };
      },
      async accept(prepared) {
        return { signature: `sig:${prepared}`, transactionBase64: `signed:${prepared}` };
      },
      async broadcast(_env, transactionBase64, lastValidBlockHeight) {
        heights.push(lastValidBlockHeight);
        if (transactionBase64 === 'signed:unsigned-1') throw failure;
        return 'sig:unsigned-2';
      },
    };
    const idem = `deposit-stuck-${kind}`;
    const first = await buildDeposit(testEnv.DB, testEnv, 'demo-user', {
      sourceWallet, amount: 2_500_000,
    }, idem, chain);
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', first.depositId, 'user-signed', chain))
      .rejects.toBe(failure);
    const again = await buildDeposit(testEnv.DB, testEnv, 'demo-user', {
      sourceWallet, amount: 2_500_000,
    }, idem, chain);
    expect(again).toMatchObject({
      depositId: first.depositId, status: 'prepared', amount: 2_500_000, transactionBase64: 'unsigned-2',
    });
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', again.depositId, 'user-signed-again', chain))
      .resolves.toMatchObject({ signature: 'sig:unsigned-2', amount: 2_500_000 });
    expect(heights).toEqual([1_001, 1_002]);
    expect(builds).toBe(2);
  });

  it('rebuilds a signed deposit with no stored lifetime when the node says the blockhash expired', async () => {
    const sourceWallet = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
    let builds = 0;
    const chain: DepositChain = {
      async build() {
        builds += 1;
        return { transactionBase64: `unsigned-${builds}`, lastValidBlockHeight: builds === 1 ? null : 2_000 };
      },
      async accept(prepared) {
        return { signature: `sig:${prepared}`, transactionBase64: `signed:${prepared}` };
      },
      async broadcast(_env, transactionBase64) {
        if (transactionBase64 === 'signed:unsigned-1') {
          throw new PaymentOutcome('EXPIRED', 'The signed payment authorization expired', false);
        }
        return 'sig:unsigned-2';
      },
    };
    const first = await buildDeposit(testEnv.DB, testEnv, 'demo-user', {
      sourceWallet, amount: 2_500_000,
    }, 'deposit-no-lifetime', chain);
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', first.depositId, 'user-signed', chain))
      .rejects.toMatchObject({ code: 'EXPIRED', release: false });
    const again = await buildDeposit(testEnv.DB, testEnv, 'demo-user', {
      sourceWallet, amount: 2_500_000,
    }, 'deposit-no-lifetime', chain);
    expect(again).toMatchObject({ depositId: first.depositId, status: 'prepared', transactionBase64: 'unsigned-2' });
    expect(builds).toBe(2);
  });

  it('keeps a signed deposit that failed for lack of funds, so the same signature is sent again', async () => {
    const sourceWallet = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
    let builds = 0;
    let broadcasts = 0;
    const chain: DepositChain = {
      async build() {
        builds += 1;
        return { transactionBase64: 'unsigned-deposit', lastValidBlockHeight: 1_000 };
      },
      async accept() {
        return { signature: 'deposit-signature', transactionBase64: 'fully-signed' };
      },
      async broadcast() {
        broadcasts += 1;
        if (broadcasts === 1) throw new PaymentOutcome('INSUFFICIENT_FUNDS', 'Not enough USDC in the wallet for this payment', false);
        return 'deposit-signature';
      },
    };
    const prepared = await buildDeposit(testEnv.DB, testEnv, 'demo-user', {
      sourceWallet, amount: 2_500_000,
    }, 'deposit-short', chain);
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', prepared.depositId, 'user-signed', chain))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    const again = await buildDeposit(testEnv.DB, testEnv, 'demo-user', {
      sourceWallet, amount: 2_500_000,
    }, 'deposit-short', chain);
    expect(again).toMatchObject({ depositId: prepared.depositId, status: 'signed', transactionBase64: 'unsigned-deposit' });
    await expect(submitDeposit(testEnv.DB, testEnv, 'demo-user', again.depositId, undefined, chain))
      .resolves.toMatchObject({ signature: 'deposit-signature' });
    expect({ builds, broadcasts }).toEqual({ builds: 1, broadcasts: 2 });
  });

  it('persists one signed faucet transfer before broadcast and safely resumes it', async () => {
    const faucetEnv: Env = { ...testEnv, ENVIRONMENT: 'preview', PAYMENTS_MODE: 'solana-rpc',
      FAUCET_ENABLED: 'true', FAUCET_GRANT_BASE: '20000000' };
    let prepares = 0;
    let broadcasts = 0;
    const interrupted: FaucetChain = {
      async prepare(_env, grant) {
        prepares += 1;
        expect(grant.wallet).toBe('connected-wallet');
        return { signature: 'faucet-signature', transactionBase64: 'signed-payload', lastValidBlockHeight: 1_000 };
      },
      async broadcast() { broadcasts += 1; throw new Error('lost RPC response'); },
    };
    await expect(claimFaucet(testEnv.DB, faucetEnv, 'demo-user', {
      targetWallet: 'connected-wallet', chain: interrupted,
    })).rejects.toThrow('lost RPC response');
    expect(await testEnv.DB.prepare('SELECT status, signature, transaction_base64 FROM faucet_grants').first())
      .toMatchObject({ status: 'prepared', signature: 'faucet-signature', transaction_base64: 'signed-payload' });

    const resumed: FaucetChain = {
      async prepare() { throw new Error('must reuse the persisted transaction'); },
      async broadcast(_env, transfer) {
        broadcasts += 1;
        expect(transfer).toEqual({ signature: 'faucet-signature', transactionBase64: 'signed-payload', lastValidBlockHeight: 1_000 });
        return 'sent' as const;
      },
    };
    expect(await claimFaucet(testEnv.DB, faucetEnv, 'demo-user', { targetWallet: 'connected-wallet', chain: resumed })).toEqual({
      asset: 'USDC', amount: 20000000, signature: 'faucet-signature', wallet: 'connected-wallet', alreadyClaimed: false,
    });
    expect(await claimFaucet(testEnv.DB, faucetEnv, 'demo-user', { targetWallet: 'connected-wallet', chain: resumed })).toEqual({
      asset: 'USDC', amount: 20000000, signature: 'faucet-signature', wallet: 'connected-wallet', alreadyClaimed: true,
    });
    expect({ prepares, broadcasts }).toEqual({ prepares: 1, broadcasts: 2 });
  });

  it('serves health and the seeded catalog', async () => {
    expect(await (await request('/health')).json()).toMatchObject({ ok: true });
    const albums = await (await request('/albums')).json() as unknown[];
    expect(albums).toHaveLength(1);
    expect(await (await request('/funding/config')).json()).toMatchObject({ depositAddress: 'wallet' });
  });

  it('does not grant a daily free pull', async () => {
    const response = await post('/daily/claim', {}, 'daily-gone');
    expect(response.status).toBe(404);
    expect(await testEnv.DB.prepare("SELECT free_paid, free_common, streak, last_daily FROM users WHERE id = 'demo-user'").first())
      .toMatchObject({ free_paid: 1, free_common: 0, streak: 0, last_daily: null });
  });

  it('enforces geo restrictions at the API edge', async () => {
    const blocked = await requestFromCountry('/me', 'JP');
    expect(blocked.status).toBe(451);
    expect(await blocked.json()).toMatchObject({ code: 'GEO_BLOCKED' });

    expect((await requestFromCountry('/me', 'AU')).status).toBe(200);
  });

  // Ben, 11 Oct 2026: mainnet-dev opens every country for the Solana Mobile CLOCK IN judges. The app closes itself on
  // GEO_BLOCKED or on /me naming a closed country (src/config/geo.ts), so `off` lifts both. Any other value is the block.
  it('lifts the geo block, and /me names no closed country, only when GEO_BLOCK is off', async () => {
    await testEnv.DB.prepare("UPDATE users SET country = 'JP' WHERE id = 'demo-user'").run();
    for (const value of [undefined, 'on', 'OFF', '']) {
      const blockedEnv: Env = { ...testEnv, GEO_BLOCK: value };
      expect((await requestFromCountry('/me', 'US', undefined, blockedEnv)).status, String(value)).toBe(451);
      expect(await (await requestFromCountry('/me', 'AU', undefined, blockedEnv)).json()).toMatchObject({ country: 'JP' });
    }

    const openEnv: Env = { ...testEnv, GEO_BLOCK: 'off' };
    const me = await requestFromCountry('/me', 'US', undefined, openEnv);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: 'demo-user', country: 'XX' });
    const prepared = await requestFromCountry('/pulls/prepare', 'JP', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'geo-off-prepare' },
      body: JSON.stringify({ gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC', idem: 'geo-off-prepare' }),
    }, openEnv);
    expect(prepared.status).toBe(200);
  });

  it('allows only configured browser origins and does not expose the admin header through CORS', async () => {
    const corsEnv: Env = { ...testEnv, ALLOWED_ORIGINS: 'https://app.example' };
    const allowed = await worker.fetch(new Request('http://example.test/me', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,x-admin-api-key',
      },
    }), corsEnv);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(allowed.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(allowed.headers.get('access-control-allow-headers')).not.toContain('x-admin-api-key');
    expect(allowed.headers.get('vary')).toBe('Origin');

    const denied = await worker.fetch(new Request('http://example.test/me', {
      method: 'OPTIONS', headers: { origin: 'https://evil.example' },
    }), corsEnv);
    expect(denied.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('does not expose shipment routes', async () => {
    const list = await request('/shipments');
    expect(list.status).toBe(404);
    expect(await list.json()).toMatchObject({ code: 'UNKNOWN', message: 'Route not found' });

    const quote = await post('/shipments/quote', { cardIds: ['card-1'] });
    expect(quote.status).toBe(404);
    expect(await quote.json()).toMatchObject({ code: 'UNKNOWN', message: 'Route not found' });
  });

  it('commits a new user\'s free pull idempotently without an age gate', async () => {
    const missingGacha = await post('/pulls/prepare', { count: 1, targeted: false, asset: 'USDC' }, 'prepare-no-gacha');
    expect(missingGacha.status).toBe(400);
    const preparedResponse = await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-free');
    expect(preparedResponse.status).toBe(200);
    const prepared = await preparedResponse.json() as { pullId: string; costUsd: number };
    expect(prepared.costUsd).toBe(0);
    expect(await testEnv.DB.prepare('SELECT gacha_id FROM pulls WHERE id = ?').bind(prepared.pullId).first())
      .toMatchObject({ gacha_id: 'all-cards' });

    const [first, concurrent] = await Promise.all([
      post('/pulls/commit', { pullId: prepared.pullId }, 'commit-free'),
      post('/pulls/commit', { pullId: prepared.pullId }, 'commit-free-concurrent'),
    ]);
    expect(first.status).toBe(200);
    expect(concurrent.status).toBe(200);
    const answer = await first.json() as { outcomes: { inventoryItemId: string }[] };
    expect(answer.outcomes).toHaveLength(1);
    expect(answer.outcomes[0].inventoryItemId).toMatch(/^item_/);
    expect(await concurrent.json()).toEqual(answer);
    expect(await (await post('/pulls/commit', { pullId: prepared.pullId }, 'commit-free-again')).json()).toEqual(answer);
    const inventory = await (await request('/me/inventory')).json() as { itemIds: string[] }[];
    expect(inventory).toHaveLength(1);
    expect(inventory[0].itemIds).toEqual([answer.outcomes[0].inventoryItemId]);
    expect(await (await request('/me/holdings')).json()).toEqual(inventory);
    expect(await testEnv.DB.prepare(`SELECT id, tier, source_kind, source_id, status FROM user_inventory
      WHERE id = ?`).bind(answer.outcomes[0].inventoryItemId).first()).toMatchObject({
      tier: 'common', source_kind: 'pull', source_id: prepared.pullId, status: 'owned',
    });
    const ledger = await testEnv.DB.prepare(`SELECT vrf_public_key, vrf_input, vrf_proof, vrf_output
      FROM pulls WHERE id = ?`).bind(prepared.pullId).first<{
        vrf_public_key: string; vrf_input: string; vrf_proof: string; vrf_output: string;
      }>();
    expect(ledger?.vrf_input).toHaveLength(64);
    expect(ledger?.vrf_proof).toHaveLength(160);
    expect(ledger?.vrf_output).toHaveLength(128);
    expect(ledger && [...Proof.from(bytes(ledger.vrf_proof)).verify(
      PublicKey.from(ledger.vrf_public_key), bytes(ledger.vrf_input),
    )]).toEqual(ledger && [...bytes(ledger.vrf_output)]);
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM pull_outcomes WHERE pull_id = ?')
      .bind(prepared.pullId).first<{ count: number }>()).toMatchObject({ count: 1 });
  });

  it('expires an abandoned mixed pull and restores both free-pull counters exactly once', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 1, free_common = 1 WHERE id = 'demo-user'").run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'prepare-mixed-expiry')).json() as { pullId: string; costUsd: number; useFreePulls: number };
    expect(prepared).toMatchObject({ costUsd: 3, useFreePulls: 2 });
    expect(await testEnv.DB.prepare("SELECT free_paid, free_common FROM users WHERE id = 'demo-user'").first())
      .toMatchObject({ free_paid: 0, free_common: 0 });

    await testEnv.DB.prepare("UPDATE pulls SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(prepared.pullId).run();
    expect(await (await request('/me')).json()).toMatchObject({ freePulls: 2 });
    expect(await testEnv.DB.prepare("SELECT free_paid, free_common FROM users WHERE id = 'demo-user'").first())
      .toMatchObject({ free_paid: 1, free_common: 1 });
    expect(await testEnv.DB.prepare('SELECT status FROM pulls WHERE id = ?').bind(prepared.pullId).first())
      .toMatchObject({ status: 'expired' });
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM pull_settlements WHERE pull_id = ? AND kind = 'expired'")
      .bind(prepared.pullId).first()).toMatchObject({ count: 1 });

    await request('/me');
    expect(await testEnv.DB.prepare("SELECT free_paid, free_common FROM users WHERE id = 'demo-user'").first())
      .toMatchObject({ free_paid: 1, free_common: 1 });
    expect((await post('/pulls/commit', { pullId: prepared.pullId }, 'commit-expired-mixed')).status).toBe(400);
  });

  it('allows a signed paid pull to settle after its quote expires without refunding reserved pulls', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 1, free_common = 0 WHERE id = 'demo-user'").run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'prepare-signed-expiry')).json() as { pullId: string; costUsd: number; useFreePulls: number };
    expect(prepared).toMatchObject({ costUsd: 4, useFreePulls: 1 });
    await testEnv.DB.prepare("UPDATE pulls SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(prepared.pullId).run();

    const committed = await post('/pulls/commit', {
      pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}`,
    }, 'commit-signed-expiry');
    expect(committed.status).toBe(200);
    expect(await testEnv.DB.prepare('SELECT status FROM pulls WHERE id = ?').bind(prepared.pullId).first())
      .toMatchObject({ status: 'committed' });
    expect(await testEnv.DB.prepare("SELECT free_paid, free_common FROM users WHERE id = 'demo-user'").first())
      .toMatchObject({ free_paid: 0, free_common: 0 });
  });

  it('gives every gacha explicit inventory while allowing overlapping membership', async () => {
    const albumPreparedResponse = await post('/pulls/prepare', {
      gachaId: 'album:A', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-album');
    expect(albumPreparedResponse.status).toBe(200);
    const albumPrepared = await albumPreparedResponse.json() as { pullId: string };
    expect(await testEnv.DB.prepare('SELECT gacha_id, album_id FROM pulls WHERE id = ?').bind(albumPrepared.pullId).first())
      .toMatchObject({ gacha_id: 'album:A', album_id: 'A' });

    const committed = await post('/pulls/commit', { pullId: albumPrepared.pullId }, 'commit-album');
    expect(committed.status).toBe(200);
    expect(await committed.json()).toMatchObject({ outcomes: [{ albumId: 'A' }] });

    const invalid = await post('/pulls/prepare', {
      gachaId: 'all-cards', albumId: 'A', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-mismatched-gacha');
    expect(invalid.status).toBe(400);
  });

  it('publishes versioned admin changes when stock is added to or removed from a gacha', async () => {
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-before-admin-edit')).json() as { pullId: string };
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO cards
        (id, name, set_name, number, printed_rarity, image_small, image_large)
        VALUES ('card-2', 'Card Two', 'TEST', '2', 'Reverse', 'small-2', 'large-2')`),
      testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, tier, available)
        VALUES ('reverse:card-2', 'card-2', 'reverse', 0)`),
    ]);
    const path = '/admin/gachas/all-cards/inventory/reverse%3Acard-2';
    expect((await request(path, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(401);
    expect((await request(path, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-api-key': 'wrong' }, body: '{}',
    })).status).toBe(401);
    const added = await request(path, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-api-key': adminKey },
      body: JSON.stringify({ selectionWeight: 7 }),
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({
      gachaId: 'all-cards', inventoryKey: 'reverse:card-2', inventoryVersion: 2, member: true,
    });
    expect(await testEnv.DB.prepare('SELECT inventory_version FROM gachas WHERE id = ?').bind('all-cards').first())
      .toMatchObject({ inventory_version: 2 });
    expect(await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM gacha_inventory
      WHERE gacha_id = 'all-cards' AND inventory_version = 1`).first()).toMatchObject({ count: 1 });
    expect(await testEnv.DB.prepare(`SELECT selection_weight FROM gacha_inventory
      WHERE gacha_id = 'all-cards' AND inventory_version = 2 AND inventory_key = 'reverse:card-2'`).first())
      .toMatchObject({ selection_weight: 7 });
    expect(await testEnv.DB.prepare('SELECT inventory_version FROM pulls WHERE id = ?').bind(prepared.pullId).first())
      .toMatchObject({ inventory_version: 1 });

    const repeated = await request(path, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-api-key': adminKey },
      body: JSON.stringify({ selectionWeight: 7 }),
    });
    expect(await repeated.json()).toMatchObject({ inventoryVersion: 2, member: true });

    const removed = await request(path, { method: 'DELETE', headers: { 'x-admin-api-key': adminKey } });
    expect(await removed.json()).toEqual({
      gachaId: 'all-cards', inventoryKey: 'reverse:card-2', inventoryVersion: 3, member: false,
    });
    expect(await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM gacha_inventory
      WHERE gacha_id = 'all-cards' AND inventory_version = 3`).first()).toMatchObject({ count: 1 });

    const empty = await request('/admin/gachas/all-cards/inventory/common%3AA%3Acard-1', {
      method: 'DELETE', headers: { 'x-admin-api-key': adminKey },
    });
    expect(empty.status).toBe(400);
  });

  it('does not merge concurrent admin inventory publications', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO cards
        (id, name, set_name, number, printed_rarity, image_small, image_large) VALUES
        ('card-2', 'Card Two', 'TEST', '2', 'Reverse', 'small-2', 'large-2'),
        ('card-3', 'Card Three', 'TEST', '3', 'Reverse', 'small-3', 'large-3')`),
      testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, tier, available) VALUES
        ('reverse:card-2', 'card-2', 'reverse', 0), ('reverse:card-3', 'card-3', 'reverse', 0)`),
    ]);
    const responses = await Promise.all(['reverse%3Acard-2', 'reverse%3Acard-3'].map((key) => request(
      `/admin/gachas/all-cards/inventory/${key}`,
      { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-api-key': adminKey }, body: '{}' },
    )));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const current = await testEnv.DB.prepare('SELECT inventory_version FROM gachas WHERE id = ?')
      .bind('all-cards').first<{ inventory_version: number }>();
    expect(current).toMatchObject({ inventory_version: 2 });
    expect(await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM gacha_inventory
      WHERE gacha_id = 'all-cards' AND inventory_version = ?`).bind(current!.inventory_version).first())
      .toMatchObject({ count: 2 });
  });

  it('verifies local paid signatures and charges only once', async () => {
    await testEnv.DB.prepare('UPDATE users SET free_paid = 0 WHERE id = ?').bind('demo-user').run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-paid')).json() as { pullId: string; costUsd: number };
    expect(prepared.costUsd).toBe(1);
    const wrong = await post('/pulls/commit', { pullId: prepared.pullId, txSignature: 'mock:wrong' }, 'commit-wrong');
    expect(wrong.status).toBe(400);
    const committed = await post('/pulls/commit', { pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}` }, 'commit-paid');
    expect(committed.status).toBe(200);
    expect(await testEnv.DB.prepare('SELECT pull_id, asset, amount, slot FROM payment_receipts WHERE signature = ?')
      .bind(`mock:${prepared.pullId}`).first()).toMatchObject({
      pull_id: prepared.pullId, asset: 'USDC', amount: 1_000_000, slot: 0,
    });
    expect(await testEnv.DB.prepare('SELECT status, reason FROM payment_obligations WHERE pull_id = ?')
      .bind(prepared.pullId).first()).toMatchObject({ status: 'fulfilled', reason: null });
    expect(await (await request('/me/balance')).json()).toMatchObject({ usdc: 4_000_000 });
    expect((await request('/odds')).status).toBe(400);
    expect(await (await request('/odds?gachaId=all-cards')).json())
      .toMatchObject({ paid: { price: 1 }, stock: { holosLeft: 0 } });
  });

  it('stores one unsigned payment transaction and returns it unchanged on prepare retry', async () => {
    const wallet = 'So11111111111111111111111111111111111111112';
    const feePayer = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
    const mint = '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547';
    const destination = 'FfGJNEx585tv26UsD1nh3fZooexRVFxK7Mfz8FofApVG';
    await testEnv.DB.prepare("UPDATE users SET wallet = ?, free_paid = 0 WHERE id = 'demo-user'").bind(wallet).run();
    let blockhashCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { method: string };
      if (payload.method === 'getTokenAccountBalance') {
        return Response.json({ jsonrpc: '2.0', id: payload.method, result: { value: { amount: '10000000' } } });
      }
      if (payload.method === 'getLatestBlockhash') {
        blockhashCalls++;
        return Response.json({ jsonrpc: '2.0', id: payload.method, result: { value: {
          blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1,
        } } });
      }
      throw new Error(`unexpected RPC method ${payload.method}`);
    }));
    const solanaEnv: Env = {
      ...testEnv,
      PAYMENTS_MODE: 'solana-rpc',
      ENABLED_ASSETS: 'USDC',
      SOLANA_RPC_URL: 'https://rpc.example',
      FEE_PAYER_ADDRESS: feePayer,
      FEE_PAYER_KEYPAIR: undefined,
      USDC_MINT: mint,
      TREASURY_USDC_TOKEN_ACCOUNT: destination,
    };

    const first = await preparePull(testEnv.DB, solanaEnv, 'demo-user', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'stable-solana-prepare');
    const second = await preparePull(testEnv.DB, solanaEnv, 'demo-user', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'stable-solana-prepare');
    expect(second.transfer?.transactionBase64).toBe(first.transfer?.transactionBase64);
    expect(blockhashCalls).toBe(1);
    expect(await testEnv.DB.prepare('SELECT payment_transaction_base64 FROM pulls WHERE id = ?')
      .bind(first.pullId).first()).toMatchObject({ payment_transaction_base64: first.transfer?.transactionBase64 });
    const decoded = getTransactionDecoder().decode(Uint8Array.from(
      atob(first.transfer!.transactionBase64!), (character) => character.charCodeAt(0),
    ));
    expect(Object.values(decoded.signatures)).toEqual([null, null]);
  });

  it('refuses a bundle that cannot be covered by current stock before payment is prepared', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'"),
      testEnv.DB.prepare("UPDATE stock_items SET available = 3 WHERE inventory_key = 'common:A:card-1'"),
    ]);
    const response = await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'prepare-short-bundle');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RESTOCKING' });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM pulls').first()).toMatchObject({ count: 0 });
  });

  it('expires a lapsed signed authorization and restores its mixed free reservations', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 1, free_common = 1 WHERE id = 'demo-user'").run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'prepare-lapsed-signed')).json() as { pullId: string };
    const signature = 'lapsed-authorization-signature';
    await testEnv.DB.prepare('UPDATE pulls SET tx_signature = ? WHERE id = ?')
      .bind(signature, prepared.pullId).run();
    const pull = await testEnv.DB.prepare('SELECT * FROM pulls WHERE id = ?')
      .bind(prepared.pullId).first<import('../src/types').PullRow>();

    await expireFailedPaymentAuthorization(
      testEnv.DB, pull!, signature, '2026-01-02T00:00:00.000Z',
    );

    expect(await testEnv.DB.prepare('SELECT status FROM pulls WHERE id = ?').bind(prepared.pullId).first())
      .toMatchObject({ status: 'expired' });
    expect(await testEnv.DB.prepare("SELECT free_paid, free_common FROM users WHERE id = 'demo-user'").first())
      .toMatchObject({ free_paid: 1, free_common: 1 });
    expect(await testEnv.DB.prepare('SELECT kind FROM pull_settlements WHERE pull_id = ?')
      .bind(prepared.pullId).first()).toMatchObject({ kind: 'expired' });
  });

  it('records a confirmed payment obligation when stock changes, then fulfills it on retry', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'").run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'prepare-paid-stock-race')).json() as { pullId: string };
    await testEnv.DB.prepare("UPDATE stock_items SET available = 3 WHERE inventory_key = 'common:A:card-1'").run();

    const first = await post('/pulls/commit', {
      pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}`,
    }, 'commit-paid-stock-race');
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ code: 'RESTOCKING' });
    expect(await testEnv.DB.prepare('SELECT pull_id FROM payment_receipts WHERE signature = ?')
      .bind(`mock:${prepared.pullId}`).first()).toMatchObject({ pull_id: prepared.pullId });
    expect(await testEnv.DB.prepare('SELECT status, reason FROM payment_obligations WHERE pull_id = ?')
      .bind(prepared.pullId).first()).toMatchObject({ status: 'pending', reason: 'RESTOCKING' });
    expect(await testEnv.DB.prepare('SELECT status FROM pulls WHERE id = ?').bind(prepared.pullId).first())
      .toMatchObject({ status: 'prepared' });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM user_inventory').first()).toMatchObject({ count: 0 });

    await testEnv.DB.prepare("UPDATE stock_items SET available = 5 WHERE inventory_key = 'common:A:card-1'").run();
    const retried = await post('/pulls/commit', {
      pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}`,
    }, 'commit-paid-stock-race-retry');
    expect(retried.status).toBe(200);
    expect((await retried.json() as { outcomes: unknown[] }).outcomes).toHaveLength(5);
    expect(await testEnv.DB.prepare('SELECT status, reason FROM payment_obligations WHERE pull_id = ?')
      .bind(prepared.pullId).first()).toMatchObject({ status: 'fulfilled', reason: null });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM payment_receipts WHERE pull_id = ?')
      .bind(prepared.pullId).first()).toMatchObject({ count: 1 });
    expect(await (await request('/me/balance')).json()).toMatchObject({ usdc: 0 });
  });

  it('refuses a pull when a published winning tier is out of stock instead of substituting a common', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'"),
      testEnv.DB.prepare("UPDATE odds_config_tiers SET weight = 0 WHERE odds_config_id = 'paid-v1'"),
      testEnv.DB.prepare(`INSERT INTO odds_config_tiers
        (odds_config_id, tier, weight, label, value_base, sort_order)
        VALUES ('paid-v1', 'holo', 1000000, 'Holo', 1500000, 1)`),
      testEnv.DB.prepare(`INSERT INTO cards
        (id, name, set_name, number, printed_rarity, image_small, image_large)
        VALUES ('card-holo-empty', 'Empty Holo', 'TEST', '2', 'Holo', 'small', 'large')`),
      testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, tier, available)
        VALUES ('holo:empty', 'card-holo-empty', 'holo', 0)`),
      testEnv.DB.prepare(`INSERT INTO gacha_inventory (gacha_id, inventory_key)
        VALUES ('all-cards', 'holo:empty')`),
    ]);
    const response = await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-empty-holo');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RESTOCKING' });
  });

  it('pins odds at prepare even when the pool publishes a new version', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'").run();
    const clientSeed = '11'.repeat(32);
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC', clientSeed,
    }, 'prepare-pinned')).json() as { pullId: string };
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO odds_configs (id, kind, version, total_weight, created_at)
        VALUES ('paid-v2', 'paid', 2, 1000000, '2026-01-02T00:00:00.000Z')`),
      testEnv.DB.prepare(`INSERT INTO odds_config_tiers
        (odds_config_id, tier, weight, label, value_base, sort_order)
        VALUES ('paid-v2', 'graded', 1000000, 'Graded slab', 60000000, 0)`),
      testEnv.DB.prepare("UPDATE gachas SET paid_odds_config_id = 'paid-v2', inventory_version = 2 WHERE id = 'all-cards'"),
    ]);

    const committed = await post('/pulls/commit', {
      pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}`,
    }, 'commit-pinned');
    expect(committed.status).toBe(200);
    expect(await committed.json()).toMatchObject({ outcomes: [{ rarity: 'common' }] });
    expect(await testEnv.DB.prepare(`SELECT odds_config_id, inventory_version, client_seed, seed_source
      FROM pulls WHERE id = ?`).bind(prepared.pullId).first()).toMatchObject({
      odds_config_id: 'paid-v1', inventory_version: 1, client_seed: clientSeed, seed_source: 'client',
    });
  });

  it('materializes every non-common tier as an individual user inventory item', async () => {
    const tiers = ['reverse', 'holo', 'ultra', 'graded'] as const;
    await testEnv.DB.prepare("UPDATE users SET free_paid = 4 WHERE id = 'demo-user'").run();
    for (const [index, tier] of tiers.entries()) {
      const cardId = `card-${tier}`;
      const inventoryKey = tier === 'graded' ? 'graded' : `${tier}:${cardId}`;
      await testEnv.DB.batch([
        testEnv.DB.prepare(`INSERT INTO cards
          (id, name, set_name, number, printed_rarity, image_small, image_large)
          VALUES (?, ?, 'TEST', ?, ?, 'small', 'large')`).bind(cardId, `Card ${tier}`, String(index + 2), tier),
        testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, tier, available)
          VALUES (?, ?, ?, 1)`).bind(inventoryKey, cardId, tier),
        testEnv.DB.prepare(`INSERT INTO gacha_inventory (gacha_id, inventory_key)
          VALUES ('all-cards', ?)`).bind(inventoryKey),
        testEnv.DB.prepare("UPDATE odds_config_tiers SET weight = 0 WHERE odds_config_id = 'paid-v1'"),
        testEnv.DB.prepare(`INSERT INTO odds_config_tiers
          (odds_config_id, tier, weight, label, value_base, sort_order) VALUES
          ('paid-v1', ?, 1000000, ?, 1, ?)
          ON CONFLICT(odds_config_id, tier) DO UPDATE SET weight = 1000000`)
          .bind(tier, tier, index + 1),
      ]);
      const prepared = await (await post('/pulls/prepare', {
        gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC', clientSeed: String(index + 2).repeat(64),
      }, `prepare-${tier}`)).json() as { pullId: string };
      const committed = await post('/pulls/commit', { pullId: prepared.pullId }, `commit-${tier}`);
      expect(committed.status).toBe(200);
      const response = await committed.json() as { outcomes: { inventoryItemId: string; rarity: string; serial?: string }[] };
      expect(response.outcomes[0]).toMatchObject({ rarity: tier });
      expect(await testEnv.DB.prepare(`SELECT tier, source_kind, source_id, status, serial FROM user_inventory
        WHERE id = ?`).bind(response.outcomes[0].inventoryItemId).first()).toMatchObject({
        tier, source_kind: 'pull', source_id: prepared.pullId, status: 'owned',
      });
      expect(await testEnv.DB.prepare(`SELECT user_inventory_item_id FROM pull_outcomes WHERE pull_id = ?`)
        .bind(prepared.pullId).first()).toMatchObject({ user_inventory_item_id: response.outcomes[0].inventoryItemId });
    }
  });

  it('never allocates one database stock unit to two different pulls', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 2 WHERE id = 'demo-user'").run();
    await testEnv.DB.prepare("UPDATE stock_items SET available = 1 WHERE inventory_key = 'common:A:card-1'").run();
    const first = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-one')).json() as { pullId: string };
    const second = await (await post('/pulls/prepare', {
      gachaId: 'album:A', count: 1, targeted: false, asset: 'USDC',
    }, 'prepare-two')).json() as { pullId: string };

    const responses = await Promise.all([
      post('/pulls/commit', { pullId: first.pullId }, 'commit-one'),
      post('/pulls/commit', { pullId: second.pullId }, 'commit-two'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM user_inventory WHERE status = 'owned'")
      .first<{ count: number }>()).toMatchObject({ count: 1 });
    expect(await testEnv.DB.prepare("SELECT available FROM stock_items WHERE inventory_key = 'common:A:card-1'")
      .first()).toMatchObject({ available: 0 });
  });

  it('burns exactly five duplicates into one free_common pull and persists that answer', async () => {
    await testEnv.DB.batch(Array.from({ length: 6 }, (_, index) => testEnv.DB.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'pull', ?, 0, ?)`)
      .bind(`seed-item-${index}`, `seed-${index}`, `2026-01-01T00:00:0${index}.000Z`)));
    const first = await post('/burns', {}, 'burn-once');
    expect(first.status).toBe(200);
    const answer = await first.json() as { extras: number; freePulls: number; outcomes?: unknown };
    expect(answer).toMatchObject({ extras: 0, freePulls: 2 }); // seed free_paid 1, plus the burn's free_common
    expect(answer).not.toHaveProperty('outcomes');
    expect(answer).not.toHaveProperty('pullId');
    expect(await (await post('/burns', {}, 'burn-once')).json()).toEqual(answer);
    expect(await testEnv.DB.prepare('SELECT free_paid, free_common FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_paid: 1, free_common: 1 });
    expect(await testEnv.DB.prepare(`SELECT COUNT(*) AS qty FROM user_inventory
      WHERE user_id = 'demo-user' AND status = 'owned'`).first()).toMatchObject({ qty: 1 });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM inventory_consumptions').first())
      .toMatchObject({ count: 5 });
    expect(await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM user_inventory WHERE source_kind = 'burn'`).first())
      .toMatchObject({ count: 0 });
  });

  it('refuses a burn short of five extras and credits nothing', async () => {
    await testEnv.DB.batch(Array.from({ length: 4 }, (_, index) => testEnv.DB.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'pull', ?, 0, ?)`)
      .bind(`short-item-${index}`, `short-seed-${index}`, `2026-01-01T00:00:0${index}.000Z`)));
    const response = await post('/burns', {}, 'burn-short');
    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ code: 'UNKNOWN' });
    expect(await testEnv.DB.prepare('SELECT free_paid, free_common FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_paid: 1, free_common: 0 });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM inventory_consumptions').first())
      .toMatchObject({ count: 0 });
  });

  it('cannot consume the same inventory items twice when burns race', async () => {
    await testEnv.DB.batch(Array.from({ length: 6 }, (_, index) => testEnv.DB.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'burn', ?, 0, ?)`)
      .bind(`race-item-${index}`, `race-seed-${index}`, `2026-01-01T00:00:0${index}.000Z`)));

    const responses = await Promise.all([
      post('/burns', {}, 'burn-race-one'),
      post('/burns', {}, 'burn-race-two'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM inventory_consumptions')
      .first()).toMatchObject({ count: 5 });
    expect(await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM user_inventory WHERE status = 'burned'`)
      .first()).toMatchObject({ count: 5 });
    expect(await testEnv.DB.prepare('SELECT free_common FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_common: 1 });
  });
});

// The client's open contract questions (PROGRESS.md "For Dev 2", FRONTEND_BATCH_PLAN Batch B step 2), answered as tests
// against the worker rather than as messages. Each is something the app already depends on.
describe('client contract', () => {
  type Quote = { pullId: string; costUsd: number; useFreePulls: number; transfer?: { to: string; mint: string; amount: number; memo: string } };
  const prepare = async (value: Record<string, unknown>) =>
    (await (await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC', ...value })).json()) as Quote;

  it('charges exactly what a quote says: costUsd in base units equals transfer.amount, and the memo is the bare pullId', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'").run();
    const quotes = [
      await prepare({}),
      await prepare({ gachaId: 'album:A', targeted: true }),
    ];
    await testEnv.DB.prepare("UPDATE users SET free_paid = 1 WHERE id = 'demo-user'").run();
    quotes.push(await prepare({ count: 5 })); // mixed: one free, four paid
    expect(quotes.map((q) => q.costUsd)).toEqual([1, 1.5, 4]);
    expect(quotes[2].useFreePulls).toBe(1);
    for (const q of quotes) {
      expect(q.transfer?.amount).toBe(Math.round(q.costUsd * 1_000_000));
      expect(q.transfer?.memo).toBe(q.pullId);
    }
  });

  it('a newer prepare supersedes nothing: an earlier unsigned quote still commits', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'").run();
    const first = await prepare({});
    const second = await prepare({});
    expect((await post('/pulls/commit', { pullId: first.pullId, txSignature: `mock:${first.pullId}` })).status).toBe(200);
    expect((await post('/pulls/commit', { pullId: second.pullId, txSignature: `mock:${second.pullId}` })).status).toBe(200);
  });

  it('a commit for a pull the server never issued answers EXPIRED, which the client drops', async () => {
    const response = await post('/pulls/commit', { pullId: 'pull_never_issued', txSignature: 'mock:pull_never_issued' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'EXPIRED' });
  });

  it('the balance a commit charged is what the very next /me/balance reads (no cached answer)', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'").run();
    const before = await (await request('/me/balance')).json() as { usdc: number };
    const q = await prepare({});
    await post('/pulls/commit', { pullId: q.pullId, txSignature: `mock:${q.pullId}` });
    expect(await (await request('/me/balance')).json()).toMatchObject({ usdc: before.usdc - 1_000_000 });
  });

  it('a completion claim sent again with its key, or with a new key, answers with the same gift (#402)', async () => {
    const q = await prepare({}); // the demo user's free pull draws card-1, the whole of album A
    expect((await post('/pulls/commit', { pullId: q.pullId })).status).toBe(200);
    const { tcg, claim, expectedGift, ledger } = await giftWorld();
    const first = await claim('claim-1');
    expect(first).toEqual({ status: 200, body: expectedGift() });
    expect(await claim('claim-1')).toEqual(first); // a lost answer, sent again
    expect(await claim('claim-2')).toEqual(first); // a new key after a relaunch: the same gift, not a second one
    expect(tcg.generated).toBe(1);
    expect(tcg.submitted).toHaveLength(1);
    expect(await ledger()).toMatchObject({ completionItems: 0, rewards: 0, claimedAt: expect.any(String),
      gift: { status: 'confirmed', gift_id: 'gift-1', tx_signature: tcg.submitted[0] } });
  });
});

// #269: a completion claim must not answer 200 with nothing awarded. Since #402 what it awards is one Jupiter gift.
describe('completion claim (#269, #402)', () => {
  it('returns the stored gift for a new key, and replaces a stored empty snapshot', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger } = await giftWorld();
    const first = await claim('claim-1');
    expect(first).toEqual({ status: 200, body: expectedGift() });
    expect(await claim('claim-2')).toEqual(first);
    await testEnv.DB.prepare(`INSERT INTO idempotency (user_id, operation, idem, response_json, created_at)
      VALUES ('demo-user', 'completion', 'claim-empty', '{"outcomes":[]}', '2026-01-02T00:00:00.000Z')`).run();
    expect(await claim('claim-empty')).toEqual(first);
    expect(await claim('claim-empty')).toEqual(first);
    const stored = await testEnv.DB.prepare(`SELECT response_json FROM idempotency WHERE user_id = 'demo-user' AND operation = 'completion' AND idem = 'claim-empty'`)
      .first<{ response_json: string }>();
    expect(JSON.parse(stored!.response_json)).toEqual(expectedGift());
    expect(tcg.generated).toBe(1);
    expect(tcg.submitted).toHaveLength(1);
    expect(await ledger()).toMatchObject({ completionItems: 0, rewards: 0 });
  });

  it('a mash of claims for one album buys one gift: every 200 is that gift, the rest are soft unavailable', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, holdGenerate } = await giftWorld();
    const soft = { status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } };
    // Claims sent while another claim's generate is still open at tcgapi find its pending row: none generates again.
    const held = holdGenerate();
    const owner = claim('race-owner');
    await held.reached;
    const late = await Promise.all(Array.from({ length: 3 }, (_, index) => claim(`race-late-${index}`)));
    for (const result of late) expect(result).toEqual(soft);
    held.release();
    expect(await owner).toEqual({ status: 200, body: expectedGift() });
    expect(tcg.generated).toBe(1);
  });

  it('a claim that reads the owner\'s pending row in the same millisecond does not generate again', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, holdGenerate } = await giftWorld();
    // One frozen clock: the late claim's `now` equals the owner's INSERT timestamp, so a timestamp cannot tell them apart.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'));
    const held = holdGenerate();
    try {
      const owner = claim('same-ms-owner');
      await held.reached;
      expect(Date.now()).toBe(Date.parse('2026-10-06T00:00:00.000Z')); // the clock really is frozen across the race
      // A late claim that mistakes itself for the owner reaches generate and waits on the same hold: settle on whichever comes first.
      const late = claim('same-ms-late');
      let poll: ReturnType<typeof setInterval> | undefined;
      await Promise.race([late, new Promise<void>((resolve) => {
        poll = setInterval(() => { if (tcg.generated > 1) resolve(); }, 1);
      })]);
      clearInterval(poll);
      expect(tcg.generated).toBe(1);
      held.release();
      expect(await late).toEqual({ status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } });
      expect(await owner).toEqual({ status: 200, body: expectedGift() });
      expect(tcg.generated).toBe(1);
    } finally {
      held.release(); // a failed run leaves no claim parked at tcgapi
      vi.useRealTimers();
    }
  });

  it('two retries of a failed claim in the failure\'s millisecond take it over once, and generate once', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger, holdGenerate } = await giftWorld();
    // One frozen clock: each retry's takeover writes `updated_at` back to the value it compared, so a timestamp cannot
    // tell the first takeover from the second.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'));
    const soft = { status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } };
    let held: ReturnType<typeof holdGenerate> | undefined;
    let retries: Promise<Awaited<ReturnType<typeof claim>>>[] | undefined;
    try {
      tcg.failGenerate = true;
      expect(await claim('failed-first')).toEqual(soft);
      expect(await ledger()).toMatchObject({ gift: { status: 'failed', gift_id: null } });
      tcg.failGenerate = false;
      held = holdGenerate();
      // Both retries read the failed row before either takes it over.
      retries = [claim('retry-a'), claim('retry-b')];
      await held.reached;
      expect(Date.now()).toBe(Date.parse('2026-10-06T00:00:00.000Z')); // the clock really is frozen across the race
      // A second taker reaches generate and waits on the same hold: settle on it, or on the loser's answer.
      let poll: ReturnType<typeof setInterval> | undefined;
      await Promise.race([Promise.any(retries), new Promise<void>((resolve) => {
        poll = setInterval(() => { if (tcg.generated > 1) resolve(); }, 1);
      })]);
      clearInterval(poll);
      expect(tcg.generated).toBe(1);
      held.release();
      const results = await Promise.all(retries);
      expect(results.filter((result) => result.status === 200)).toEqual([{ status: 200, body: expectedGift() }]);
      expect(results.filter((result) => result.status !== 200)).toEqual([soft]);
      expect(tcg.generated).toBe(1);
    } finally {
      held?.release(); // a failed run leaves no claim parked at tcgapi
      // ...nor one still running once afterEach unstubs fetch, which would send its submit to the real tcgapi.
      if (retries) await Promise.allSettled(retries);
      vi.useRealTimers();
    }
  });

  it('an owner whose generate fails after a takeover does not fail the taker\'s attempt, so no third claim generates', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger, gateGenerate } = await giftWorld();
    const soft = { status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'));
    const owner = gateGenerate();
    const taker = gateGenerate();
    const claims: Promise<Awaited<ReturnType<typeof claim>>>[] = [];
    try {
      const x = claim('owner-x');
      claims.push(x);
      await owner.reached;
      // Past GENERATE_HOLD_MS with the owner's generate still open: a retry takes the row over (attempt 0 -> 1).
      vi.setSystemTime(new Date('2026-10-06T00:00:31.000Z'));
      const r1 = claim('taker-r1');
      claims.push(r1);
      await taker.reached;
      expect(tcg.generated).toBe(2);
      owner.fail();
      expect(await x).toEqual(soft);
      // The owner's failure belongs to attempt 0: the taker's attempt 1 is still pending, not failed.
      expect(await ledger()).toMatchObject({ gift: { status: 'pending', gift_id: null } });
      const r2 = claim('retry-r2');
      claims.push(r2);
      expect(await r2).toEqual(soft);
      expect(tcg.generated).toBe(2);
      taker.answer();
      expect(await r1).toEqual({ status: 200, body: expectedGift() });
      expect(tcg.generated).toBe(2);
      expect(new Set(tcg.submitted).size).toBe(1);
    } finally {
      owner.fail();
      taker.answer(); // a failed run leaves no claim parked at tcgapi
      // ...nor one still running once afterEach unstubs fetch, which would send its submit to the real tcgapi.
      await Promise.allSettled(claims);
      vi.useRealTimers();
    }
  });

  it('a takeover whose own generate fails marks its attempt failed, so the next retry generates at once', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger } = await giftWorld();
    const soft = { status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } };
    tcg.failGenerate = true;
    expect(await claim('fail-owner')).toEqual(soft); // attempt 0 fails
    expect(await claim('fail-taker')).toEqual(soft); // takes it over as attempt 1, and that fails too
    expect(await ledger()).toMatchObject({ gift: { status: 'failed', gift_id: null } });
    tcg.failGenerate = false;
    expect(await claim('retry')).toEqual({ status: 200, body: expectedGift() });
    expect(tcg.generated).toBe(1);
  });

  it('a generate that answers a different pack is not stored, and fails its attempt so a retry generates at once', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger } = await giftWorld();
    tcg.generateCount = 2;
    expect(await claim('wrong-pack')).toEqual({ status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } });
    expect(await ledger()).toMatchObject({ claimedAt: null, gift: { status: 'failed', gift_id: null, tx_signature: null } });
    expect(tcg.submitted).toEqual([]);
    tcg.generateCount = undefined;
    expect(await claim('wrong-pack-retry')).toEqual({ status: 200, body: expectedGift() });
    expect(tcg.generated).toBe(2);
  });

  it('a burst of claims sent at once buys one gift', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger } = await giftWorld();
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => claim(`race-claim-${index}`)));
    expect(tcg.generated).toBe(1);
    // A resubmission of the one signed transaction cannot land twice; a second generate (a second gift) never happens.
    expect(new Set(tcg.submitted).size).toBe(1);
    expect(results.some((result) => result.status === 200)).toBe(true);
    for (const result of results) {
      if (result.status === 200) expect(result.body).toEqual(expectedGift());
      else expect(result).toEqual({ status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } });
    }
    expect(await claim('race-claim-after')).toEqual({ status: 200, body: expectedGift() });
    expect(tcg.generated).toBe(1);
    expect(await ledger()).toMatchObject({ completionItems: 0, rewards: 0, claimedAt: expect.any(String),
      gift: { status: 'confirmed' } });
  });

  it('a rejected submit leaves the album unclaimed, and a retry submits the one stored gift', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger } = await giftWorld();
    tcg.failSubmit = 'reject';
    expect(await claim('claim-rejected')).toEqual({ status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } });
    expect(await ledger()).toMatchObject({ completionItems: 0, rewards: 0, claimedAt: null,
      gift: { status: 'failed', gift_id: 'gift-1', tx_signature: null } });
    tcg.failSubmit = undefined;
    expect(await claim('claim-retry')).toEqual({ status: 200, body: expectedGift() });
    expect(tcg.generated).toBe(1); // the stored transaction is submitted again, not a second gift generated
    expect(new Set(tcg.submitted).size).toBe(1);
    expect(await ledger()).toMatchObject({ claimedAt: expect.any(String), gift: { status: 'confirmed' } });
  });

  it('a submit that landed but lost its answer is confirmed from the house\'s sent gifts', async () => {
    await seedCompletedAlbum();
    const { tcg, claim, expectedGift, ledger } = await giftWorld();
    tcg.failSubmit = 'lost';
    expect(await claim('claim-lost')).toEqual({ status: 200, body: expectedGift() });
    expect(tcg.generated).toBe(1);
    expect(tcg.submitted).toHaveLength(1);
    expect(await ledger()).toMatchObject({ completionItems: 0, claimedAt: expect.any(String),
      gift: { status: 'confirmed', tx_signature: tcg.submitted[0] } });
  });

  it('a claim that gifts nothing is not a 200, and leaves the album unclaimed', async () => {
    await seedCompletedAlbum();
    const { env, tcg, claim, expectedGift, ledger } = await giftWorld();
    const unclaimed = { completionItems: 0, rewards: 0, claimedAt: null };

    // The flag off (the shipped default), with everything else ready to gift: soft unavailable, and tcgapi is never asked.
    const disabled = await claim('claim-disabled', { ...env, JUPITER_GIFT_ENABLED: 'false' });
    expect(disabled).toEqual({ status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } });
    expect(tcg.calls).toEqual([]);
    expect(await ledger()).toMatchObject({ ...unclaimed, gift: null });

    // tcgapi refuses to generate: soft unavailable, still unclaimed, and the row is free for a retry.
    tcg.failGenerate = true;
    const failed = await claim('claim-failed');
    expect(failed).toEqual({ status: 503, body: { code: 'UNKNOWN', message: GIFT_UNAVAILABLE } });
    expect(tcg.submitted).toEqual([]);
    expect(await ledger()).toMatchObject({ ...unclaimed, gift: { status: 'failed', gift_id: null, tx_signature: null } });

    // The same key, once tcgapi is back, gifts: a failure stored no snapshot that would replay as a 200.
    tcg.failGenerate = false;
    expect(await claim('claim-failed')).toEqual({ status: 200, body: expectedGift() });
    expect(tcg.generated).toBe(1);

    // An album claimed before #402 (claimed_at with no stored gift) is not bought again.
    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO albums (id, title, subtitle, cover_url, size, status, sort_order) VALUES ('B', 'Old', 'Old', 'cover', 1, 'live', 1)"),
      testEnv.DB.prepare(`INSERT INTO album_completions (user_id, album_id, completed_at, claimed_at)
        VALUES ('demo-user', 'B', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`),
    ]);
    const old = await worker.fetch(new Request('http://example.test/completion-claims', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'claim-old' },
      body: JSON.stringify({ albumId: 'B', idem: 'claim-old' }),
    }), env);
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({ code: 'UNKNOWN', message: ALREADY_CLAIMED, hint: 'already-claimed' });
    expect(tcg.generated).toBe(1);
    expect(await ledger()).toMatchObject({ completionItems: 0, rewards: 0 });
  });
});

// #277: the hardening items from the 26 Sept audit.
describe('server hardening (#277)', () => {
  const seedExtras = (prefix: string, count = 6) => testEnv.DB.batch(Array.from({ length: count }, (_, index) =>
    testEnv.DB.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'burn', ?, 0, ?)`)
      .bind(`${prefix}-item-${index}`, `${prefix}-seed-${index}`, `2026-01-01T00:00:0${index}.000Z`)));

  it('answers every prepare that loses the race for a free pull with a 409, never a 500', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, `race-prepare-${index}`)));
    const statuses = responses.map((response) => response.status);
    expect(statuses).not.toContain(500);
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
    for (const response of responses.filter((r) => r.status !== 200)) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'UNKNOWN' });
    }
    expect(await testEnv.DB.prepare("SELECT free_paid FROM users WHERE id = 'demo-user'").first())
      .toMatchObject({ free_paid: 0 });
  });

  it('refuses a prepare that reuses an idempotency key for a different pull', async () => {
    const first = await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, 'reused-prepare');
    expect(first.status).toBe(200);
    const again = await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, 'reused-prepare');
    expect(await again.json()).toEqual(await first.json());
    for (const changed of [{ count: 5 }, { gachaId: 'album:A' }, { targeted: true, albumId: 'A', gachaId: 'album:A' }, { asset: 'USDT' }]) {
      const response = await post('/pulls/prepare', {
        gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC', ...changed,
      }, 'reused-prepare');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'TX_MISMATCH' });
    }
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM pulls').first()).toMatchObject({ count: 1 });
  });

  describe('a commit on a real RPC reads the balance after the pull is settled', () => {
    const solanaEnv = (): Env => ({ ...testEnv, PAYMENTS_MODE: 'solana-rpc', ENABLED_ASSETS: 'USDC',
      SOLANA_RPC_URL: 'https://rpc.example', USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
    beforeEach(() => testEnv.DB.prepare("UPDATE users SET wallet = 'So11111111111111111111111111111111111111112' WHERE id = 'demo-user'").run());
    const stubBalance = (amount: string) => vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { method: string };
      if (payload.method !== 'getTokenAccountBalance') throw new Error(`unexpected RPC method ${payload.method}`);
      return Response.json({ jsonrpc: '2.0', id: payload.method, result: { value: { amount } } });
    }));

    it('still dispenses a free pull when the balance read fails, and says nothing about the balance', async () => {
      const env = solanaEnv();
      stubBalance('7000000');
      const prepared = await preparePull(testEnv.DB, env, 'demo-user', {
        gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
      }, 'free-rpc-down');
      let balanceReads = 0;
      vi.stubGlobal('fetch', vi.fn(async () => { balanceReads++; throw new Error('rpc down'); }));
      const committed = await commitPull(testEnv.DB, env, 'demo-user', prepared.pullId) as { outcomes: unknown[]; balance?: unknown };
      expect(committed.outcomes).toHaveLength(1);
      expect(committed).not.toHaveProperty('balance');
      expect(balanceReads).toBeGreaterThan(0);
      expect(await testEnv.DB.prepare('SELECT status FROM pulls WHERE id = ?').bind(prepared.pullId).first())
        .toMatchObject({ status: 'committed' });
    });

    it('answers with the wallet balance when the read succeeds, and never stores it in the replay', async () => {
      const env = solanaEnv();
      stubBalance('7000000');
      const prepared = await preparePull(testEnv.DB, env, 'demo-user', {
        gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
      }, 'free-rpc-up');
      const committed = await commitPull(testEnv.DB, env, 'demo-user', prepared.pullId) as { balance?: unknown };
      expect(committed.balance).toEqual({ usdc: 7000000, usdt: 0, pulls: 7 });
      const stored = await testEnv.DB.prepare('SELECT response_json FROM pulls WHERE id = ?').bind(prepared.pullId)
        .first<{ response_json: string }>();
      expect(JSON.parse(stored!.response_json)).not.toHaveProperty('balance');
    });
  });

  it('credits free_common even when paid odds and the gacha would not cover a card draw', async () => {
    await testEnv.DB.prepare("UPDATE gachas SET status = 'paused' WHERE id = 'all-cards'").run();
    await seedExtras('paused');
    const response = await post('/burns', {}, 'burn-paused-gacha');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ extras: 0, freePulls: 2 });
    expect(await testEnv.DB.prepare('SELECT free_paid, free_common FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_paid: 1, free_common: 1 });
  });

  it('does not complete an album at burn time', async () => {
    await testEnv.DB.prepare("UPDATE albums SET size = 1 WHERE id = 'A'").run();
    await seedExtras('no-complete');
    const response = await post('/burns', {}, 'burn-no-complete');
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('albumCompleted');
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM album_completions').first()).toMatchObject({ count: 0 });
  });

  it('a prepare whose batch keeps failing for another reason is not passed off as a lost race', async () => {
    const spy = vi.spyOn(testEnv.DB, 'batch').mockImplementation(async () => { throw new Error('D1 fault'); });
    try {
      const response = await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, 'faulty-prepare');
      expect(response.status).toBe(500);
      expect(spy).toHaveBeenCalledTimes(2); // priced once more from a fresh read, then passed on (#306)
    } finally { spy.mockRestore(); }
    expect(await testEnv.DB.prepare("SELECT free_paid FROM users WHERE id = 'demo-user'").first()).toMatchObject({ free_paid: 1 });
  });

  // #306: the counts looked sufficient after a failed batch — a reservation released between the failure and the re-read, or a
  // one-off fault. Priced again from a fresh read, the prepare succeeds instead of a raw 500.
  it('a prepare whose batch fails once, with its free pulls still there, is priced again and succeeds', async () => {
    const spy = vi.spyOn(testEnv.DB, 'batch').mockImplementationOnce(async () => { throw new Error('D1 fault'); });
    try {
      const response = await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, 'retried-prepare');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ useFreePulls: 1, costUsd: 0 });
    } finally { spy.mockRestore(); }
    expect(await testEnv.DB.prepare("SELECT free_paid FROM users WHERE id = 'demo-user'").first()).toMatchObject({ free_paid: 0 });
  });

  it('an admin route on a server with no admin key is 501, not the 503 a broken ledger answers (#306)', async () => {
    const unkeyed: Env = { ...testEnv, ADMIN_API_KEY: undefined as unknown as string };
    const response = await worker.fetch(new Request('http://example.test/admin/ledger', { headers: { 'x-admin-api-key': adminKey } }), unkeyed);
    expect(response.status).toBe(501);
  });

  it('a burn on a real RPC answers no balance (the ledger table is the mock\'s), and the mock keeps its ledger balance', async () => {
    await seedExtras('rpc-burn', 12);
    const rpcEnv: Env = { ...testEnv, PAYMENTS_MODE: 'solana-rpc' };
    const onRpc = await worker.fetch(new Request('http://example.test/burns', { method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'burn-on-rpc' }, body: JSON.stringify({ idem: 'burn-on-rpc' }) }), rpcEnv);
    expect(onRpc.status).toBe(200);
    const rpcBody = await onRpc.json() as { extras: number; freePulls: number };
    expect(rpcBody).toMatchObject({ extras: 6, freePulls: 2 }); // 12 copies are 11 extras; five consumed. Seed free_paid 1 plus the credit.
    expect(rpcBody).not.toHaveProperty('balance');
    expect(rpcBody).not.toHaveProperty('outcomes');
    const onMock = await post('/burns', {}, 'burn-on-mock');
    expect(await onMock.json()).toMatchObject({ extras: 1, freePulls: 3, balance: { usdc: 5000000, usdt: 0, pulls: 5 } });
  });

  const ledger = (key: string | null = adminKey) => request('/admin/ledger', key ? { headers: { 'x-admin-api-key': key } } : undefined);

  describe('/admin/ledger checks the payment ledger; /health stays public and constant-cost', () => {
    const paidPull = async (id: string) => {
      await testEnv.DB.prepare(`INSERT INTO pulls (id, user_id, idem, sequence, gacha_id, inventory_version, odds_config_id,
          free_odds_config_id, client_seed, seed_source, count, targeted, asset, cost_base, status, expires_at, created_at)
        VALUES (?, 'demo-user', ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM pulls), 'all-cards', 1, 'paid-v1', 'free-v1',
          'seed', 'server', 1, 0, 'USDC', 1000000, 'prepared', '2026-01-02', '2026-01-01')`)
        .bind(id, id).run();
    };

    it('is 200 with no violations on a clean ledger', async () => {
      const response = await ledger();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, violations: {
        receiptsWithoutObligation: 0, receiptsNotMatchingPull: 0, fulfilledWithoutCommit: 0, committedButPending: 0,
      } });
    });

    it('is 503 and names the rule when a receipt has no obligation', async () => {
      await paidPull('health-pull');
      await testEnv.DB.prepare(`INSERT INTO payment_receipts (signature, pull_id, asset, amount, destination, slot, finalized_at)
        VALUES ('orphan-sig', 'health-pull', 'USDC', 1000000, 'treasury', 1, '2026-01-01')`).run();
      const response = await ledger();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, violations: { receiptsWithoutObligation: 1 } });
      // The public route neither scans nor tells: it is 200 with no counts on the same broken ledger.
      const health = await request('/health');
      expect(health.status).toBe(200);
      expect(await health.json()).not.toHaveProperty('violations');
      // And the ledger route is the admin's only.
      expect((await ledger(null)).status).toBe(401);
      expect((await ledger('wrong-key-000000000000000000000000000000')).status).toBe(401);
    });

    it('is 503 when a receipt pays a different amount than its pull quoted', async () => {
      await paidPull('health-short');
      await testEnv.DB.batch([
        testEnv.DB.prepare(`INSERT INTO payment_receipts (signature, pull_id, asset, amount, destination, slot, finalized_at)
          VALUES ('short-sig', 'health-short', 'USDC', 999999, 'treasury', 1, '2026-01-01')`),
        testEnv.DB.prepare(`INSERT INTO payment_obligations (pull_id, signature, status, created_at, updated_at)
          VALUES ('health-short', 'short-sig', 'pending', '2026-01-01', '2026-01-01')`),
      ]);
      expect(await (await ledger()).json()).toMatchObject({ ok: false, violations: { receiptsNotMatchingPull: 1 } });
    });

    it('is 503 when an obligation is fulfilled with no committed pull, or pending after one', async () => {
      await paidPull('health-fulfilled');
      await paidPull('health-pending');
      await testEnv.DB.batch([
        testEnv.DB.prepare(`INSERT INTO payment_receipts (signature, pull_id, asset, amount, destination, slot, finalized_at) VALUES
          ('fulfilled-sig', 'health-fulfilled', 'USDC', 1000000, 'treasury', 1, '2026-01-01'),
          ('pending-sig', 'health-pending', 'USDC', 1000000, 'treasury', 1, '2026-01-01')`),
        testEnv.DB.prepare(`INSERT INTO payment_obligations (pull_id, signature, status, created_at, updated_at) VALUES
          ('health-fulfilled', 'fulfilled-sig', 'fulfilled', '2026-01-01', '2026-01-01'),
          ('health-pending', 'pending-sig', 'pending', '2026-01-01', '2026-01-01')`),
        testEnv.DB.prepare(`INSERT INTO pull_settlements (pull_id, kind, created_at) VALUES ('health-pending', 'committed', '2026-01-01')`),
      ]);
      expect(await (await ledger()).json()).toMatchObject({ ok: false, violations: {
        fulfilledWithoutCommit: 1, committedButPending: 1, receiptsWithoutObligation: 0,
      } });
    });
  });
});

describe('uniform index', () => {
  it('rejects the draws above the largest multiple of the bound instead of folding them with a modulo', () => {
    const draws = [0xFFFF_FFFF, 5];
    expect(uniformIndex(3, () => draws.shift()!)).toBe(2);
    expect(draws).toEqual([]);
    expect(uniformIndex(3, () => 0xFFFF_FFFE)).toBe(0xFFFF_FFFE % 3);
  });
});

// #304: the faucet's follow-ups.
describe('faucet follow-ups (#304)', () => {
  const faucetEnv = (): Env => ({ ...testEnv, ENVIRONMENT: 'preview', PAYMENTS_MODE: 'solana-rpc', SOLANA_RPC_URL: 'https://rpc.example',
    FAUCET_ENABLED: 'true', FAUCET_GRANT_BASE: '20000000' });
  const transfer = (lastValidBlockHeight: number | null = 1_000) => ({ signature: 'faucet-sig', transactionBase64: 'dHg=', lastValidBlockHeight });
  /** A chain: the signature's status before and after a send, the confirmed height (the transfers here are valid through
   *  1,000), and what simulation says. Status reads answer from a node at slot 900 unless told otherwise. */
  const stubRpc = (chain: { status: unknown; afterSend?: unknown; height?: number; simulateErr?: unknown; statusSlot?: number }) => {
    const methods: string[] = [];
    let sent = false;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      methods.push(method);
      const ok = (result: unknown) => Response.json({ jsonrpc: '2.0', id: 1, result });
      if (method === 'getSignatureStatuses') {
        return ok({ context: { slot: chain.statusSlot ?? 900 }, value: [sent ? chain.afterSend ?? null : chain.status] });
      }
      if (method === 'getEpochInfo') return ok({ absoluteSlot: 900, blockHeight: chain.height ?? 500 });
      if (method === 'simulateTransaction') return ok({ value: { err: chain.simulateErr ?? null } });
      if (method === 'sendTransaction') { sent = true; return ok('faucet-sig'); }
      throw new Error(`unexpected RPC ${method}`);
    }));
    return methods;
  };
  const CONFIRMED = { err: null, confirmationStatus: 'confirmed' };
  const FAILED = { err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'confirmed' };

  it('a transfer that already landed is found by its signature before anything is simulated', async () => {
    const methods = stubRpc({ status: CONFIRMED, simulateErr: { InstructionError: [0, 'AlreadyProcessed'] } });
    expect(await solanaFaucetChain.broadcast(faucetEnv(), transfer())).toBe('sent');
    expect(methods).toEqual(['getSignatureStatuses']);
  });

  it('a transfer that failed on chain moved nothing: void, never simulated', async () => {
    const methods = stubRpc({ status: FAILED });
    expect(await solanaFaucetChain.broadcast(faucetEnv(), transfer())).toBe('void');
    expect(methods).not.toContain('simulateTransaction');
  });

  it('a transfer proven expired (height past its lifetime, still no status from a node that far along) is void', async () => {
    const methods = stubRpc({ status: null, height: 1_001 });
    expect(await solanaFaucetChain.broadcast(faucetEnv(), transfer())).toBe('void');
    expect(methods).not.toContain('simulateTransaction');
  });

  it('not proven expired: at its last valid height, from a lagging status node, or with no lifetime, it is never void', async () => {
    for (const [chain, lifetime] of [[{ height: 1_000 }, 1_000], [{ height: 1_001, statusSlot: 899 }, 1_000], [{ height: 9_999 }, null]] as const) {
      stubRpc({ status: null, afterSend: CONFIRMED, ...chain });
      expect(await solanaFaucetChain.broadcast(faucetEnv(), transfer(lifetime))).toBe('sent'); // simulated, sent, confirmed
    }
  });

  it('a transfer sent now that then fails on chain is void, not sent', async () => {
    stubRpc({ status: null, afterSend: FAILED });
    expect(await solanaFaucetChain.broadcast(faucetEnv(), transfer())).toBe('void');
  });

  it('BlockhashNotFound is the hedged hand fix only for a transfer with no stored lifetime; with one, it stays a retry', async () => {
    stubRpc({ status: null, simulateErr: 'BlockhashNotFound' });
    await expect(solanaFaucetChain.broadcast(faucetEnv(), transfer(null))).rejects.toMatchObject({ status: 409, message: FAUCET_STUCK });
    stubRpc({ status: null, simulateErr: 'BlockhashNotFound' });
    await expect(solanaFaucetChain.broadcast(faucetEnv(), transfer(1_000))).rejects.toMatchObject({ status: 503 });
    stubRpc({ status: null, simulateErr: { InstructionError: [1, { Custom: 1 }] } });
    await expect(solanaFaucetChain.broadcast(faucetEnv(), transfer(null))).rejects.toMatchObject({ status: 503 });
  });

  it('a void transfer puts the grant back and signs it again, once, to the wallet the claim names', async () => {
    const outcomes: ('sent' | 'void')[] = ['void', 'sent'];
    const prepared: string[] = [];
    const sent: string[] = [];
    let n = 0;
    const chain: FaucetChain = {
      async prepare(_env, grant) { n += 1; prepared.push(grant.wallet); return { signature: `sig-${n}`, transactionBase64: `tx-${n}`, lastValidBlockHeight: 700 + n }; },
      async broadcast(_env, t) { sent.push(t.signature); return outcomes.shift()!; },
    };
    expect(await claimFaucet(testEnv.DB, faucetEnv(), 'demo-user', { chain })).toMatchObject({ signature: 'sig-2', alreadyClaimed: false });
    expect([prepared, sent]).toEqual([['wallet', 'wallet'], ['sig-1', 'sig-2']]);
    expect(await testEnv.DB.prepare("SELECT status, signature, last_valid_block_height FROM faucet_grants WHERE user_id = 'demo-user'").first())
      .toMatchObject({ status: 'sent', signature: 'sig-2', last_valid_block_height: 702 });
  });

  it('a second void in one claim stops at a retryable 503, with the grant back to reserved and nothing sent', async () => {
    let n = 0;
    const chain: FaucetChain = {
      async prepare() {
        n += 1;
        if (n > 2) throw new Error('signed a third time'); // a bound, so a loop fails here instead of hanging the suite
        return { signature: `sig-${n}`, transactionBase64: `tx-${n}`, lastValidBlockHeight: 700 };
      },
      async broadcast() { return 'void'; },
    };
    await expect(claimFaucet(testEnv.DB, faucetEnv(), 'demo-user', { chain })).rejects.toMatchObject({ status: 503 });
    expect(n).toBe(2);
    expect(await testEnv.DB.prepare("SELECT status, signature FROM faucet_grants WHERE user_id = 'demo-user'").first())
      .toMatchObject({ status: 'reserved', signature: null });
    expect(await faucetGrantWallet(testEnv.DB, 'demo-user')).toBeNull();
  });

  it('the stored lifetime is the signed transfer\'s own, never a second read; anything unreadable is null', () => {
    const signed = (lifetimeConstraint: unknown) => ({ lifetimeConstraint });
    expect(signedLifetime(signed({ blockhash: 'hash', lastValidBlockHeight: 2_000n }))).toBe(2_000);
    for (const unreadable of [undefined, null, {}, { blockhash: 'hash' }, { lastValidBlockHeight: 2_000n },
      { blockhash: 'hash', lastValidBlockHeight: 2_000 }, { blockhash: 'hash', lastValidBlockHeight: 2n ** 60n },
      { blockhash: 'hash', lastValidBlockHeight: -1n }, { nonce: 'n', nonceAccountAddress: 'a' }]) {
      expect(signedLifetime(signed(unreadable))).toBeNull();
    }
    expect(signedLifetime(null)).toBeNull();
  });

  it('an UPDATE that fails for any other reason stays its own retryable error, not the hand fix', async () => {
    const real = testEnv.DB.prepare.bind(testEnv.DB);
    const spy = vi.spyOn(testEnv.DB, 'prepare').mockImplementation((sql: string) => {
      const statement = real(sql);
      if (!sql.includes("SET status = 'prepared', wallet = ?")) return statement;
      return { bind: () => ({ run: async () => { throw new Error('D1_ERROR: Network connection lost.'); } }) } as unknown as D1PreparedStatement;
    });
    const chain: FaucetChain = {
      async prepare(_env, grant) { return { signature: `sig:${grant.wallet}`, transactionBase64: 'tx', lastValidBlockHeight: 1 }; },
      async broadcast() { throw new Error('must not send'); },
    };
    try {
      const error = await claimFaucet(testEnv.DB, faucetEnv(), 'demo-user', { chain }).catch((e: unknown) => e);
      expect(String(error)).toContain('Network connection lost');
      expect(error).not.toMatchObject({ status: 409 });
    } finally { spy.mockRestore(); }
  });

  it('on a database with the old per-wallet key, a wallet another row already names is the hand fix, not a raw 500', async () => {
    await testEnv.DB.exec('DROP INDEX IF EXISTS idx_faucet_grants_one_per_user');
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, created_at)
        VALUES ('legacy-a', 'demo-user', 'wallet-a', ?, 20000000, 'reserved', '2026-09-20')`).bind(testEnv.USDC_MINT),
      testEnv.DB.prepare(`INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, created_at)
        VALUES ('legacy-b', 'demo-user', 'wallet-b', ?, 20000000, 'reserved', '2026-09-21')`).bind(testEnv.USDC_MINT),
    ]);
    const sent: string[] = [];
    const chain: FaucetChain = {
      async prepare(_env, grant) { return { signature: `sig:${grant.wallet}`, transactionBase64: 'tx', lastValidBlockHeight: 1 }; },
      async broadcast(_env, t) { sent.push(t.signature); return 'sent'; },
    };
    await expect(claimFaucet(testEnv.DB, faucetEnv(), 'demo-user', { targetWallet: 'wallet-b', chain }))
      .rejects.toMatchObject({ status: 409, message: FAUCET_STUCK });
    expect(sent).toEqual([]);
  });

  it('a grant reserved under another mint is a hand fix too', async () => {
    await testEnv.DB.prepare(`INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, created_at)
      VALUES ('stale', 'demo-user', 'wallet', 'OtherMint1111111111111111111111111111111111', 20000000, 'reserved', '2026-09-20')`).run();
    const chain: FaucetChain = { async prepare() { throw new Error('must not prepare'); }, async broadcast() { throw new Error('must not send'); } };
    await expect(claimFaucet(testEnv.DB, faucetEnv(), 'demo-user', { chain })).rejects.toMatchObject({ status: 409, message: FAUCET_STUCK });
  });

  it('/funding says where the grant went once it is sent', () => {
    expect(faucetInfo(faucetEnv(), null)).toEqual({ asset: 'USDC', amount: 20000000, claimed: false });
    expect(faucetInfo(faucetEnv(), 'connected-wallet')).toEqual({ asset: 'USDC', amount: 20000000, claimed: true, wallet: 'connected-wallet' });
  });

  it('only a definite not-linked answer counts as no; a directory outage stays its own error', async () => {
    const answer = (error?: ApiError) => linkedBy(async () => { if (error) throw error; });
    expect(await answer()('w')).toBe(true);
    expect(await answer(new ApiError('UNAUTHENTICATED', 'not linked', 403))('w')).toBe(false);
    await expect(answer(new ApiError('UNAUTHENTICATED', 'Privy user directory is unavailable', 503))('w')).rejects.toMatchObject({ status: 503 });
  });
});

// A burn credits `free_common` (#294). Album completion is still recorded when that pull is later committed, from what
// the settling batch sees (#305).
describe('a burn free pull completes an album the way a daily free pull does (#294)', () => {
  it('spends the credit as free_common, draws an album common, and can complete the album', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'"),
      testEnv.DB.prepare("UPDATE albums SET size = 2 WHERE id = 'A'"),
      testEnv.DB.prepare(`INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
        VALUES ('card-2', 'Card Two', 'TEST', '2', 'Common', 's', 'l')`),
      testEnv.DB.prepare("INSERT INTO album_cards (album_id, card_id, slot) VALUES ('A', 'card-2', 2)"),
      testEnv.DB.prepare("UPDATE stock_items SET available = 0 WHERE inventory_key = 'common:A:card-1'"),
      testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, album_id, tier, available)
        VALUES ('common:A:card-2', 'card-2', 'A', 'common', 5)`),
      testEnv.DB.prepare("INSERT INTO gacha_inventory (gacha_id, inventory_key) VALUES ('all-cards', 'common:A:card-2')"),
      ...Array.from({ length: 6 }, (_, index) => testEnv.DB.prepare(`INSERT INTO user_inventory
        (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
        VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'pull', ?, 0, ?)`)
        .bind(`ent-${index}`, `ent-src-${index}`, `2026-01-01T00:00:0${index}.000Z`)),
    ]);
    const burned = await burnExtras(testEnv.DB, 'demo-user', 'entitlement');
    expect(burned).toMatchObject({ freePulls: 1 });
    expect(burned).not.toHaveProperty('outcomes');
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM album_completions').first()).toMatchObject({ count: 0 });
    // The burn returns the five finite copies. Empty that slot again so the later crank's only card is the one that fills the album.
    await testEnv.DB.prepare("UPDATE stock_items SET available = 0 WHERE inventory_key = 'common:A:card-1'").run();
    const prepared = await preparePull(testEnv.DB, testEnv, 'demo-user', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'entitlement-pull');
    expect(prepared).toMatchObject({ costUsd: 0, useFreePulls: 1 });
    expect(await testEnv.DB.prepare('SELECT reserved_paid, reserved_common, cost_base FROM pulls WHERE id = ?')
      .bind(prepared.pullId).first()).toMatchObject({ reserved_paid: 0, reserved_common: 1, cost_base: 0 });
    const committed = await commitPull(testEnv.DB, testEnv, 'demo-user', prepared.pullId) as {
      outcomes: { cardId: string; rarity: string }[]; albumCompleted?: string;
    };
    expect(committed.outcomes).toEqual([expect.objectContaining({ cardId: 'card-2', rarity: 'common' })]);
    expect(committed.albumCompleted).toBe('A');
    expect(await testEnv.DB.prepare('SELECT free_paid, free_common FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_paid: 0, free_common: 0 });
  });
});

describe('completions are recorded at settlement (#305)', () => {
  // The race itself: a card lands after the pull counted and before the pull's batch runs. The pull's count saw the
  // album one short, so only a statement evaluated inside the batch can record it.
  it('a pull records a completion that a card landing between its count and its batch finished', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE albums SET size = 2 WHERE id = 'A'"),
      testEnv.DB.prepare(`INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
        VALUES ('card-2', 'Card Two', 'TEST', '2', 'Common', 's', 'l')`),
      testEnv.DB.prepare("INSERT INTO album_cards (album_id, card_id, slot) VALUES ('A', 'card-2', 2)"),
      testEnv.DB.prepare("INSERT INTO stock_items (inventory_key, card_id, album_id, tier, available) VALUES ('common:A:card-2', 'card-2', 'A', 'common', 0)"),
      testEnv.DB.prepare(`INSERT INTO user_inventory (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
        VALUES ('held-1', 'demo-user', 'common:A:card-1', 'card-1', 'common', 'burn', 'held', 0, '2026-01-01')`),
    ]);
    const prepared = await (await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, 'race-pull')).json() as { pullId: string };
    const realBatch = testEnv.DB.batch.bind(testEnv.DB);
    let landed = false;
    const spy = vi.spyOn(testEnv.DB, 'batch').mockImplementation(async (statements) => {
      if (!landed) {
        landed = true; // the racing burn's card, committed just ahead of this pull's batch
        await testEnv.DB.prepare(`INSERT INTO user_inventory (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
          VALUES ('raced-2', 'demo-user', 'common:A:card-2', 'card-2', 'common', 'burn', 'raced', 0, '2026-01-02')`).run();
      }
      return realBatch(statements);
    });
    try {
      const commit = await post('/pulls/commit', { pullId: prepared.pullId }, 'race-pull-commit');
      expect(commit.status).toBe(200);
      // It drew a dupe itself and its count saw the album short, but the batch recorded it: the answer announces it, so the
      // holo can be claimed (PR #308's review: recorded and never announced, it could never be).
      expect(await commit.json()).toMatchObject({ outcomes: [{ cardId: 'card-1', isDupe: true }], albumCompleted: 'A' });
    } finally { spy.mockRestore(); }
    expect(landed).toBe(true);
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM album_completions WHERE user_id = 'demo-user' AND album_id = 'A'")
      .first()).toMatchObject({ count: 1 });
    // The replay is the stored answer, and says the same.
    expect(await (await post('/pulls/commit', { pullId: prepared.pullId }, 'race-pull-commit-replay')).json()).toMatchObject({ albumCompleted: 'A' });
    // Recorded and announced once: the next settlement's statement is ignored, not a failed batch, and it announces nothing.
    const again = await (await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, 'race-pull-2')).json() as { pullId: string };
    const second = await post('/pulls/commit', { pullId: again.pullId, txSignature: `mock:${again.pullId}` }, 'race-pull-commit-2');
    expect(second.status).toBe(200);
    expect(await second.json()).not.toHaveProperty('albumCompleted');
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM album_completions WHERE album_id = 'A'").first()).toMatchObject({ count: 1 });
  });

  it('an infinite album card is drawn without a vault count, and unoffered rare tiers do not block the pull', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'"),
      testEnv.DB.prepare("UPDATE stock_items SET supply = 'infinite', available = 0 WHERE inventory_key = 'common:A:card-1'"),
      testEnv.DB.prepare("UPDATE odds_config_tiers SET weight = 770000 WHERE odds_config_id = 'paid-v1' AND tier = 'common'"),
      testEnv.DB.prepare(`INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order) VALUES
        ('paid-v1', 'reverse', 122500, 'Reverse', 1, 1),
        ('paid-v1', 'holo', 90000, 'Holo', 1, 2),
        ('paid-v1', 'ultra', 16000, 'Ultra', 1, 3),
        ('paid-v1', 'graded', 1500, 'Graded', 1, 4)`),
    ]);
    const oddsBody = await (await request('/odds?gachaId=all-cards')).json() as { stock: { perAlbum: Record<string, { live: number; total: number }> } };
    expect(oddsBody.stock.perAlbum.A).toEqual({ live: 1, total: 1 });
    const availability = await (await request('/albums/A/availability')).json() as Record<string, number>;
    expect(availability['card-1']).toBe(INFINITE_AVAILABLE_REPORT);
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'infinite-prepare')).json() as { pullId: string };
    const committed = await post('/pulls/commit', { pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}` }, 'infinite-commit');
    expect(committed.status).toBe(200);
    const body = await committed.json() as { outcomes: { cardId: string; rarity: string }[] };
    expect(body.outcomes).toHaveLength(5);
    expect(body.outcomes.every((outcome) => outcome.cardId === 'card-1' && outcome.rarity === 'common')).toBe(true);
    expect(await testEnv.DB.prepare("SELECT available, supply FROM stock_items WHERE inventory_key = 'common:A:card-1'").first())
      .toMatchObject({ available: 0, supply: 'infinite' });
  });

  it('a graded vault of one does not block a ×10 when paid odds are common only', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'"),
      testEnv.DB.prepare("UPDATE balances SET amount = 10000000 WHERE user_id = 'demo-user' AND asset = 'USDC'"),
      testEnv.DB.prepare("UPDATE stock_items SET supply = 'infinite', available = 0 WHERE inventory_key = 'common:A:card-1'"),
      testEnv.DB.prepare(`INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
        VALUES ('graded-slab', 'Slab', 'TEST', '9', 'Graded', 'small', 'large')`),
      testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, tier, available, supply)
        VALUES ('graded:slab', 'graded-slab', 'graded', 1, 'finite')`),
      testEnv.DB.prepare("INSERT INTO gacha_inventory (gacha_id, inventory_key) VALUES ('all-cards', 'graded:slab')"),
    ]);
    const oddsBody = await (await request('/odds?gachaId=all-cards')).json() as {
      paid: { rows: { tier: string; pct: number }[] };
    };
    expect(oddsBody.paid.rows.map((row) => row.tier)).toEqual(['common']);
    expect(oddsBody.paid.rows[0]?.pct).toBe(1);
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 10, targeted: false, asset: 'USDC',
    }, 'commons-only-x10')).json() as { pullId: string; costUsd: number };
    expect(prepared.costUsd).toBe(10);
    const committed = await post('/pulls/commit', {
      pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}`,
    }, 'commons-only-x10-commit');
    expect(committed.status).toBe(200);
    const body = await committed.json() as { outcomes: { rarity: string }[] };
    expect(body.outcomes).toHaveLength(10);
    expect(body.outcomes.every((outcome) => outcome.rarity === 'common')).toBe(true);
    expect(await testEnv.DB.prepare("SELECT available FROM stock_items WHERE inventory_key = 'graded:slab'").first())
      .toMatchObject({ available: 1 });
  });

  it('a targeted pull draws an infinite album card that stores no vault count', async () => {
    await testEnv.DB.prepare("UPDATE stock_items SET supply = 'infinite', available = 0 WHERE inventory_key = 'common:A:card-1'").run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'album:A', albumId: 'A', count: 1, targeted: true, asset: 'USDC',
    }, 'targeted-infinite')).json() as { pullId: string; costUsd: number };
    expect(prepared.costUsd).toBe(1.5);
    expect((await post('/pulls/commit', { pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}` }, 'targeted-infinite-commit')).status).toBe(200);
    expect(await testEnv.DB.prepare("SELECT available FROM stock_items WHERE inventory_key = 'common:A:card-1'").first())
      .toMatchObject({ available: 0 });
  });

  it('a targeted pull still draws a card the user already holds', async () => {
    await testEnv.DB.prepare("UPDATE stock_items SET supply = 'infinite', available = 0 WHERE inventory_key = 'common:A:card-1'").run();
    const firstPrep = await (await post('/pulls/prepare', {
      gachaId: 'album:A', albumId: 'A', count: 1, targeted: true, asset: 'USDC',
    }, 'targeted-dupe-1')).json() as { pullId: string };
    const first = await post('/pulls/commit', { pullId: firstPrep.pullId, txSignature: `mock:${firstPrep.pullId}` }, 'targeted-dupe-1-commit');
    expect(first.status).toBe(200);
    expect((await first.json() as { outcomes: { isDupe: boolean }[] }).outcomes[0]?.isDupe).toBe(false);
    const secondPrep = await post('/pulls/prepare', {
      gachaId: 'album:A', albumId: 'A', count: 1, targeted: true, asset: 'USDC',
    }, 'targeted-dupe-2');
    expect(secondPrep.status).toBe(200);
    const prepared = await secondPrep.json() as { pullId: string; costUsd: number };
    expect(prepared.costUsd).toBe(1.5);
    const second = await post('/pulls/commit', { pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}` }, 'targeted-dupe-2-commit');
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ outcomes: [{ cardId: 'card-1', isDupe: true }] });
  });

  it('a targeted ×5 charges five album rates and draws five album cards, duplicates included', async () => {
    const short = await post('/pulls/prepare', {
      gachaId: 'album:A', albumId: 'A', count: 5, targeted: true, asset: 'USDC',
    }, 'targeted-x5-short');
    expect(short.status).toBe(402);
    expect(await short.json()).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM pulls').first()).toMatchObject({ n: 0 });
    expect(await testEnv.DB.prepare('SELECT free_paid FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_paid: 1 });

    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE balances SET amount = 20000000 WHERE user_id = 'demo-user' AND asset = 'USDC'"),
      testEnv.DB.prepare("UPDATE stock_items SET supply = 'infinite', available = 0 WHERE inventory_key = 'common:A:card-1'"),
      testEnv.DB.prepare(`INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
        VALUES ('card-2', 'Card Two', 'TEST', '2', 'Common', 'small', 'large')`),
      testEnv.DB.prepare("INSERT INTO album_cards (album_id, card_id, slot) VALUES ('A', 'card-2', 2)"),
      testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, album_id, tier, available, supply)
        VALUES ('common:A:card-2', 'card-2', 'A', 'common', 0, 'infinite')`),
      testEnv.DB.prepare("INSERT INTO gacha_inventory (gacha_id, inventory_key) VALUES ('album:A', 'common:A:card-2')"),
    ]);
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'album:A', albumId: 'A', count: 5, targeted: true, asset: 'USDC',
    }, 'targeted-x5')).json() as { pullId: string; costUsd: number; useFreePulls: number };
    expect(prepared).toMatchObject({ costUsd: 7.5, useFreePulls: 0 });
    const ten = await (await post('/pulls/prepare', {
      gachaId: 'album:A', albumId: 'A', count: 10, targeted: true, asset: 'USDC',
    }, 'targeted-x10')).json() as { costUsd: number; useFreePulls: number };
    expect(ten).toMatchObject({ costUsd: 15, useFreePulls: 0 });
    const committed = await post('/pulls/commit', {
      pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}`,
    }, 'targeted-x5-commit');
    expect(committed.status).toBe(200);
    const body = await committed.json() as {
      outcomes: { cardId: string; albumId?: string; isDupe: boolean }[];
      ticketsEarned: number;
    };
    expect(body.outcomes).toHaveLength(5);
    expect(body.ticketsEarned).toBe(5);
    const seen = new Set<string>();
    for (const outcome of body.outcomes) {
      expect(outcome.albumId).toBe('A');
      expect(['card-1', 'card-2']).toContain(outcome.cardId);
      expect(outcome.isDupe).toBe(seen.has(outcome.cardId));
      seen.add(outcome.cardId);
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(await testEnv.DB.prepare('SELECT free_paid FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_paid: 1 });
    expect(await testEnv.DB.prepare("SELECT amount FROM balances WHERE user_id = 'demo-user' AND asset = 'USDC'").first())
      .toMatchObject({ amount: 12_500_000 });
  });

  it('a finite tier the gacha offers still restocks when its vault is empty', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'"),
      testEnv.DB.prepare(`INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
        VALUES ('finite-reverse', 'Finite Reverse', 'TEST', '2', 'Reverse', 'small', 'large')`),
      testEnv.DB.prepare(`INSERT INTO stock_items (inventory_key, card_id, tier, available, supply)
        VALUES ('reverse:finite', 'finite-reverse', 'reverse', 0, 'finite')`),
      testEnv.DB.prepare("INSERT INTO gacha_inventory (gacha_id, inventory_key) VALUES ('all-cards', 'reverse:finite')"),
      testEnv.DB.prepare("UPDATE odds_config_tiers SET weight = 0 WHERE odds_config_id = 'paid-v1' AND tier = 'common'"),
      testEnv.DB.prepare(`INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order)
        VALUES ('paid-v1', 'reverse', 1000000, 'Reverse', 1, 1)`),
    ]);
    const response = await post('/pulls/prepare', { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, 'finite-empty');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RESTOCKING' });
  });

  it('a finite vault still decrements on a pull and still moves when a burn returns copies', async () => {
    await testEnv.DB.prepare("UPDATE users SET free_paid = 0 WHERE id = 'demo-user'").run();
    await testEnv.DB.prepare("UPDATE stock_items SET available = 4 WHERE inventory_key = 'common:A:card-1'").run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'finite-pull')).json() as { pullId: string };
    expect((await post('/pulls/commit', { pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}` }, 'finite-pull-commit')).status).toBe(200);
    expect(await testEnv.DB.prepare("SELECT available, supply FROM stock_items WHERE inventory_key = 'common:A:card-1'").first())
      .toMatchObject({ available: 3, supply: 'finite' });
  });

  it('burning extras of an infinite album card does not move its vault count', async () => {
    await testEnv.DB.prepare("UPDATE stock_items SET supply = 'infinite', available = 0 WHERE inventory_key = 'common:A:card-1'").run();
    await testEnv.DB.batch(Array.from({ length: 6 }, (_, index) => testEnv.DB.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'pull', ?, 0, ?)`)
      .bind(`inf-item-${index}`, `inf-src-${index}`, `2026-01-01T00:00:0${index}.000Z`)));
    const response = await post('/burns', {}, 'burn-infinite');
    expect(response.status).toBe(200);
    const body = await response.json() as { extras: number; freePulls: number };
    expect(body).toMatchObject({ extras: 0, freePulls: 2 });
    expect(body).not.toHaveProperty('outcomes');
    expect(await testEnv.DB.prepare("SELECT available FROM stock_items WHERE inventory_key = 'common:A:card-1'").first())
      .toMatchObject({ available: 0 });
    expect(await testEnv.DB.prepare('SELECT free_common FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_common: 1 });
  });

  it('a finite vault takes the copies a burn returns and the burn draws no card', async () => {
    await testEnv.DB.prepare("UPDATE stock_items SET available = 5 WHERE inventory_key = 'common:A:card-1'").run();
    await testEnv.DB.batch(Array.from({ length: 6 }, (_, index) => testEnv.DB.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'pull', ?, 0, ?)`)
      .bind(`fin-item-${index}`, `fin-src-${index}`, `2026-01-01T00:00:0${index}.000Z`)));
    const response = await post('/burns', {}, 'burn-finite-vault');
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('outcomes');
    // Five extras return to the vault. Nothing is drawn.
    expect(await testEnv.DB.prepare("SELECT available FROM stock_items WHERE inventory_key = 'common:A:card-1'").first())
      .toMatchObject({ available: 10 });
  });

  it('accrues raffle tickets on paid slots only and serves them on GET /season', async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE stock_items SET available = 80 WHERE inventory_key = 'common:A:card-1'"),
      testEnv.DB.prepare("UPDATE balances SET amount = 50000000 WHERE user_id = 'demo-user' AND asset = 'USDC'"),
      testEnv.DB.prepare("UPDATE users SET free_paid = 0, free_common = 0 WHERE id = 'demo-user'"),
    ]);
    const fresh = await (await request('/season')).json() as { prizes: { slot: string; cardId: string; grade: string; photo: string }[]; myTickets: number };
    expect(fresh).toMatchObject({ id: 'season-one', title: 'Season One raffle', drawAt: '2026-11-30T16:00:00.000Z', myTickets: 0 });
    expect(fresh.prizes.map((prize) => [prize.slot, prize.cardId, prize.grade, prize.photo])).toEqual([
      ['grand', 'sv8-238', 'PSA 10', 'https://images.pokemontcg.io/sv8/238_hires.png'],
      ['mid', 'sv3-223', 'PSA 10', 'https://images.pokemontcg.io/sv3/223_hires.png'],
      ['mid', 'swsh7-218', 'PSA 10', 'https://images.pokemontcg.io/swsh7/218_hires.png'],
      ['mid', 'sv8-239', 'PSA 10', 'https://images.pokemontcg.io/sv8/239_hires.png'],
      ['mid', 'swsh11-180', 'PSA 10', 'https://images.pokemontcg.io/swsh11/180_hires.png'],
    ]);
    expect(fresh.prizes.every((prize) => !('valueUsd' in prize))).toBe(true);

    const targeted = await (await post('/pulls/prepare', {
      gachaId: 'album:A', count: 1, targeted: true, asset: 'USDC',
    }, 'season-targeted')).json() as { pullId: string; costUsd: number; useFreePulls: number };
    expect(targeted).toMatchObject({ costUsd: 1.5, useFreePulls: 0 });
    expect(await (await post('/pulls/commit', { pullId: targeted.pullId, txSignature: `mock:${targeted.pullId}` }, 'season-targeted-commit')).json())
      .toMatchObject({ ticketsEarned: 1, myTickets: 1 });
    expect(await (await post('/pulls/commit', { pullId: targeted.pullId, txSignature: `mock:${targeted.pullId}` }, 'season-targeted-replay')).json())
      .toMatchObject({ ticketsEarned: 1, myTickets: 1 });

    await testEnv.DB.prepare("UPDATE users SET free_paid = 1 WHERE id = 'demo-user'").run();
    const free = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'season-free')).json() as { pullId: string; costUsd: number };
    expect(free.costUsd).toBe(0);
    expect(await (await post('/pulls/commit', { pullId: free.pullId }, 'season-free-commit')).json())
      .toMatchObject({ ticketsEarned: 0, myTickets: 1 });

    const five = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'season-five')).json() as { pullId: string };
    expect(await (await post('/pulls/commit', { pullId: five.pullId, txSignature: `mock:${five.pullId}` }, 'season-five-commit')).json())
      .toMatchObject({ ticketsEarned: 5, myTickets: 6 });

    const ten = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 10, targeted: false, asset: 'USDC',
    }, 'season-ten')).json() as { pullId: string };
    expect(await (await post('/pulls/commit', { pullId: ten.pullId, txSignature: `mock:${ten.pullId}` }, 'season-ten-commit')).json())
      .toMatchObject({ ticketsEarned: 10, myTickets: 16 });

    await testEnv.DB.prepare("UPDATE users SET free_paid = 2, free_common = 1 WHERE id = 'demo-user'").run();
    const mixed = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC',
    }, 'season-mixed')).json() as { pullId: string; costUsd: number; useFreePulls: number };
    expect(mixed).toMatchObject({ costUsd: 2, useFreePulls: 3 });
    expect(await (await post('/pulls/commit', { pullId: mixed.pullId, txSignature: `mock:${mixed.pullId}` }, 'season-mixed-commit')).json())
      .toMatchObject({ ticketsEarned: 2, myTickets: 18 });

    const beforeClaim = 18;
    expect((await post('/daily/claim', {}, 'season-daily')).status).toBe(404);
    expect(await (await request('/season')).json()).toMatchObject({ myTickets: beforeClaim });
    expect(await testEnv.DB.prepare("SELECT tickets FROM season_ticket_balances WHERE user_id = 'demo-user'").first())
      .toMatchObject({ tickets: beforeClaim });
  });
});

describe('paid streak', () => {
  const yesterday = () => dayKey(new Date(Date.now() - 86_400_000));
  const older = () => dayKey(new Date(Date.now() - 3 * 86_400_000));

  beforeEach(async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE stock_items SET available = 80 WHERE inventory_key = 'common:A:card-1'"),
      testEnv.DB.prepare("UPDATE balances SET amount = 50000000 WHERE user_id = 'demo-user' AND asset = 'USDC'"),
      testEnv.DB.prepare("UPDATE users SET free_paid = 0, free_common = 0, streak = 0, last_daily = NULL WHERE id = 'demo-user'"),
    ]);
  });

  async function seasonBody() {
    return await (await request('/season')).json() as { myTickets: number; streak: { count: number; countedToday: boolean } };
  }

  async function paid(count: 1 | 5 | 10, idem: string) {
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count, targeted: false, asset: 'USDC',
    }, `${idem}-prep`)).json() as { pullId: string; costUsd: number };
    const committed = await (await post('/pulls/commit', {
      pullId: prepared.pullId, txSignature: `mock:${prepared.pullId}`,
    }, `${idem}-commit`)).json() as { ticketsEarned: number; myTickets: number };
    return { ...committed, pullId: prepared.pullId, costUsd: prepared.costUsd };
  }

  it('advances once on the first paid pull of the day and not on a later one', async () => {
    expect(await seasonBody()).toMatchObject({ myTickets: 0, streak: { count: 0, countedToday: false } });
    const first = await paid(1, 'streak-day');
    expect(first).toMatchObject({ ticketsEarned: 1, myTickets: 1, costUsd: 1 });
    expect(await seasonBody()).toMatchObject({ myTickets: 1, streak: { count: 1, countedToday: true } });
    const second = await paid(1, 'streak-same-day');
    expect(second).toMatchObject({ ticketsEarned: 1, myTickets: 2 });
    expect(await seasonBody()).toMatchObject({ streak: { count: 1, countedToday: true } });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM season_streak_grants').first()).toMatchObject({ n: 0 });
  });

  it('a ×5 earns five base tickets and advances the streak by one', async () => {
    const five = await paid(5, 'streak-five');
    expect(five).toMatchObject({ ticketsEarned: 5, myTickets: 5, costUsd: 5 });
    expect(await seasonBody()).toMatchObject({ streak: { count: 1, countedToday: true } });
    const ten = await paid(10, 'streak-ten');
    expect(ten).toMatchObject({ ticketsEarned: 10, myTickets: 15 });
    expect(await seasonBody()).toMatchObject({ streak: { count: 1, countedToday: true } });
  });

  it('a missed day reads as 0 and the next paid pull starts at 1', async () => {
    await testEnv.DB.prepare(`INSERT INTO season_streaks (user_id, season_id, count, last_day) VALUES ('demo-user', 'season-one', 4, ?)`)
      .bind(older()).run();
    expect(await seasonBody()).toMatchObject({ streak: { count: 0, countedToday: false } });
    expect(await paid(1, 'streak-after-miss')).toMatchObject({ ticketsEarned: 1, myTickets: 1 });
    expect(await seasonBody()).toMatchObject({ streak: { count: 1, countedToday: true } });
    expect(await testEnv.DB.prepare('SELECT count, last_day FROM season_streaks WHERE user_id = ?').bind('demo-user').first())
      .toMatchObject({ count: 1 });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM season_streak_grants').first()).toMatchObject({ n: 0 });
  });

  it('hitting 5 grants exactly two tickets once, then resets, and a replay does not grant again', async () => {
    await testEnv.DB.prepare(`INSERT INTO season_streaks (user_id, season_id, count, last_day) VALUES ('demo-user', 'season-one', 4, ?)`)
      .bind(yesterday()).run();
    const hit = await paid(1, 'streak-hit');
    expect(hit).toMatchObject({ ticketsEarned: 1, streakBonus: 2, myTickets: 3, streak: { count: 0, countedToday: true } });
    expect(await seasonBody()).toMatchObject({ myTickets: 3, streak: { count: 0, countedToday: true } });
    expect(await testEnv.DB.prepare('SELECT tickets, pull_id FROM season_streak_grants WHERE user_id = ?').bind('demo-user').all())
      .toMatchObject({ results: [{ tickets: 2, pull_id: hit.pullId }] });
    expect(await testEnv.DB.prepare('SELECT tickets FROM season_ticket_balances WHERE user_id = ?').bind('demo-user').first())
      .toMatchObject({ tickets: 3 });

    const replay = await (await post('/pulls/commit', { pullId: hit.pullId, txSignature: `mock:${hit.pullId}` }, 'streak-hit-replay')).json();
    expect(replay).toMatchObject({ ticketsEarned: 1, myTickets: 3 });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM season_streak_grants').first()).toMatchObject({ n: 1 });

    const later = await paid(1, 'streak-after-hit');
    expect(later).toMatchObject({ ticketsEarned: 1, streakBonus: 0, myTickets: 4, streak: { count: 0, countedToday: true } });
    expect(await seasonBody()).toMatchObject({ myTickets: 4, streak: { count: 0, countedToday: true } });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM season_streak_grants').first()).toMatchObject({ n: 1 });
    expect(await testEnv.DB.prepare('SELECT free_common, streak FROM users WHERE id = ?').bind('demo-user').first())
      .toMatchObject({ free_common: 0, streak: 0 });
  });

  it('a free pull, a burn, and a completion claim do not advance the streak', async () => {
    const day = yesterday();
    await testEnv.DB.prepare(`INSERT INTO season_streaks (user_id, season_id, count, last_day) VALUES ('demo-user', 'season-one', 2, ?)`)
      .bind(day).run();
    await testEnv.DB.prepare("UPDATE users SET free_common = 1 WHERE id = 'demo-user'").run();
    const prepared = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'streak-free-prep')).json() as { pullId: string; costUsd: number };
    expect(prepared.costUsd).toBe(0);
    expect(await (await post('/pulls/commit', { pullId: prepared.pullId }, 'streak-free-commit')).json())
      .toMatchObject({ ticketsEarned: 0, streakBonus: 0, myTickets: 0, streak: { count: 2, countedToday: false } });
    expect(await seasonBody()).toMatchObject({ streak: { count: 2, countedToday: false } });

    await testEnv.DB.batch(Array.from({ length: 6 }, (_, index) => testEnv.DB.prepare(`INSERT INTO user_inventory
      (id, user_id, inventory_key, card_id, tier, source_kind, source_id, outcome_index, acquired_at)
      VALUES (?, 'demo-user', 'common:A:card-1', 'card-1', 'common', 'pull', ?, 0, ?)`)
      .bind(`streak-item-${index}`, `streak-src-${index}`, `2026-01-02T00:00:0${index}.000Z`)));
    expect((await post('/burns', {}, 'streak-burn')).status).toBe(200);
    expect(await seasonBody()).toMatchObject({ myTickets: 0, streak: { count: 2, countedToday: false } });
    const burned = await (await post('/pulls/prepare', {
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC',
    }, 'streak-burn-pull')).json() as { pullId: string; costUsd: number };
    expect(burned.costUsd).toBe(0);
    expect(await (await post('/pulls/commit', { pullId: burned.pullId }, 'streak-burn-commit')).json())
      .toMatchObject({ ticketsEarned: 0, myTickets: 0 });

    const claim = await post('/completion-claims', { albumId: 'A' }, 'streak-partner');
    expect(claim.status).not.toBe(404);
    expect(await seasonBody()).toMatchObject({ myTickets: 0, streak: { count: 2, countedToday: false } });
    expect(await testEnv.DB.prepare('SELECT count, last_day FROM season_streaks WHERE user_id = ?').bind('demo-user').first())
      .toMatchObject({ count: 2, last_day: day });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM season_streak_grants').first()).toMatchObject({ n: 0 });
  });

  it('GET /me/streak is 0 until a paid day, then the bonus day until midnight', async () => {
    const fresh = await (await request('/me/streak')).json() as { resetsAt: string; bonusJustEarned: boolean };
    expect(fresh).toMatchObject({ count: 0, countedToday: false, bonusJustEarned: false });
    expect(Number.isNaN(Date.parse(fresh.resetsAt))).toBe(false);
    await testEnv.DB.prepare(`INSERT INTO season_streaks (user_id, season_id, count, last_day) VALUES ('demo-user', 'season-one', 4, ?)`)
      .bind(yesterday()).run();
    await paid(1, 'streak-endpoint');
    expect(await (await request('/me/streak')).json()).toMatchObject({ count: 0, countedToday: true, bonusJustEarned: true });
  });

  it('a ×10 on day 5 adds two streak tickets once, not two per dollar', async () => {
    await testEnv.DB.prepare(`INSERT INTO season_streaks (user_id, season_id, count, last_day) VALUES ('demo-user', 'season-one', 4, ?)`)
      .bind(yesterday()).run();
    const hit = await paid(10, 'streak-exploit');
    expect(hit).toMatchObject({ costUsd: 10, ticketsEarned: 10, streakBonus: 2, myTickets: 12, streak: { count: 0, countedToday: true } });
    const again = await paid(10, 'streak-exploit-again');
    expect(again).toMatchObject({ ticketsEarned: 10, streakBonus: 0, myTickets: 22, streak: { count: 0, countedToday: true } });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM season_streak_grants').first()).toMatchObject({ n: 1 });
    expect(await (await request('/me/streak')).json()).toMatchObject({ count: 0, countedToday: true, bonusJustEarned: true });
  });
});
