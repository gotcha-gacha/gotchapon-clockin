// #406 Phase 1: MagicBlock draws in the Worker, against the fake draw chain (no network). The fake's randomness is a hash of
// the pull's sequence and pool hash, so every expectation here is recomputed independently with `deriveSlots`.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { ApiError } from '../src/http';
import { commitPull, expireAbandonedPulls, preparePull } from '../src/pulls';
import { awaitDraw, drawView, failDraw } from '../src/draw';
import { fakeDrawRequests, fakeRandomness, resetFakeDrawChain } from '../src/drawChain';
import { deriveSlots, hexToBytes, poolHash, type FrozenPool } from '../src/drawDerive';
import type { Env, PullRow } from '../src/types';

const testEnv = env as unknown as Env;
const T0 = '2026-01-01T00:00:00.000Z';
const CARDS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

function magic(overrides: Partial<Env> = {}): Env {
  return { ...testEnv, DRAW_SOURCE: 'magicblock', DRAW_CHAIN: 'fake', DRAW_FAKE: 'instant', DRAW_WAIT_MS: '50',
    DRAW_TIMEOUT_MS: '60000', ...overrides };
}

async function pullRow(id: string): Promise<PullRow> {
  return (await testEnv.DB.prepare('SELECT * FROM pulls WHERE id = ?').bind(id).first<PullRow>())!;
}

async function prepare(e: Env, input: Record<string, unknown> = {}) {
  return preparePull(testEnv.DB, e, 'demo-user', { count: 10, targeted: false, asset: 'USDC', gachaId: 'all-cards', ...input },
    crypto.randomUUID());
}

async function failure(work: Promise<unknown>): Promise<ApiError> {
  try { await work; } catch (error) { if (error instanceof ApiError) return error; throw error; }
  throw new Error('expected the call to fail');
}

/** What the pull must have drawn, from public inputs only. */
async function expected(pull: PullRow) {
  const pool = JSON.parse(pull.pool_json!) as FrozenPool;
  const randomness = await fakeRandomness(pull.sequence, hexToBytes(pull.pool_hash!));
  return deriveSlots(pool, randomness);
}

async function settled(pullId: string) {
  return (await testEnv.DB.prepare(`SELECT outcome_index AS "index", tier, inventory_key AS key FROM pull_outcomes
    WHERE pull_id = ? ORDER BY outcome_index`).bind(pullId).all<{ index: number; tier: string; key: string }>()).results;
}

/** Commit as the app does: a paid pull carries its (mock) payment, which records a receipt and an obligation. */
function commit(e: Env, pullId: string, paid = true) {
  return commitPull(testEnv.DB, e, 'demo-user', pullId, paid ? `mock:${pullId}` : undefined);
}

const CLEAR_ALL = `
    DELETE FROM season_streak_grants; DELETE FROM season_streaks; DELETE FROM season_ticket_grants; DELETE FROM season_ticket_balances;
    DELETE FROM completion_rewards; DELETE FROM album_completions; DELETE FROM idempotency;
    DELETE FROM pull_outcomes; DELETE FROM payment_obligations; DELETE FROM payment_receipts; DELETE FROM pull_settlements; DELETE FROM pulls;
    DELETE FROM inventory_consumptions; DELETE FROM user_inventory; DELETE FROM gacha_inventory; DELETE FROM gacha_inventory_versions;
    DELETE FROM gachas; DELETE FROM stock_items; DELETE FROM odds_config_tiers; DELETE FROM odds_configs; DELETE FROM album_cards;
    DELETE FROM cards; DELETE FROM albums; DELETE FROM faucet_grants; DELETE FROM balances; DELETE FROM users;
    UPDATE gacha_state SET next_pull_sequence = 1 WHERE singleton = 1;
  `;

beforeEach(async () => {
  resetFakeDrawChain();
  const db = testEnv.DB;
  await db.exec(CLEAR_ALL);
  await db.batch([
    db.prepare(`INSERT INTO users (id, wallet, country, free_paid, free_common, created_at)
      VALUES ('demo-user', 'wallet', 'MY', 0, 0, ?)`).bind(T0),
    db.prepare("INSERT INTO balances (user_id, asset, amount) VALUES ('demo-user', 'USDC', 100000000), ('demo-user', 'USDT', 0)"),
    db.prepare("INSERT INTO albums (id, title, subtitle, cover_url, size, status, sort_order) VALUES ('A', 'Album A', 'A', 'cover', 25, 'live', 0)"),
    ...CARDS.map((id, i) => db.prepare(`INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
      VALUES (?, ?, 'TEST', ?, 'Common', 's', 'l')`).bind(id, `Card ${i + 1}`, String(i + 1))),
    ...CARDS.map((id, i) => db.prepare('INSERT INTO album_cards (album_id, card_id, slot) VALUES (\'A\', ?, ?)').bind(id, i + 1)),
    ...CARDS.map((id) => db.prepare(`INSERT INTO stock_items (inventory_key, card_id, album_id, tier, available, supply)
      VALUES (?, ?, 'A', 'common', 0, 'infinite')`).bind(`common:A:${id}`, id)),
    db.prepare(`INSERT INTO odds_configs (id, kind, version, total_weight, created_at) VALUES
      ('paid-v1', 'paid', 1, 1000000, ?), ('free-v1', 'free_common', 1, 1000000, ?)`).bind(T0, T0),
    db.prepare(`INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order) VALUES
      ('paid-v1', 'common', 1000000, 'Album card', 50000, 0), ('free-v1', 'common', 1000000, 'Album card', 50000, 0)`),
    db.prepare(`INSERT INTO gachas (id, album_id, name, status, supports_targeted, paid_odds_config_id, free_odds_config_id,
      price_base, targeted_price_base, created_at, updated_at) VALUES
      ('all-cards', NULL, 'All Cards', 'active', 0, 'paid-v1', 'free-v1', 1000000, 1500000, ?, ?),
      ('album:A', 'A', 'Album A', 'active', 1, 'paid-v1', 'free-v1', 1000000, 1500000, ?, ?)`).bind(T0, T0, T0, T0),
    db.prepare(`INSERT INTO gacha_inventory_versions (gacha_id, inventory_version, created_at) VALUES
      ('all-cards', 1, ?), ('album:A', 1, ?)`).bind(T0, T0),
    // Unequal weights, so a derivation that ignored them would draw differently.
    ...CARDS.flatMap((id, i) => ['all-cards', 'album:A'].map((gacha) => db.prepare(`INSERT INTO gacha_inventory
      (gacha_id, inventory_key, selection_weight) VALUES (?, ?, ?)`).bind(gacha, `common:A:${id}`, i + 1))),
  ]);
});

describe('MagicBlock draws (#406)', () => {
  it('AC-1: a paid ×10 freezes its pool at prepare and settles exactly the cards its randomness and pool derive', async () => {
    const e = magic();
    const prepared = await prepare(e);
    const pull = await pullRow(prepared.pullId);
    expect(pull.draw_source).toBe('magicblock');
    expect(pull.pool_hash).toBe(await poolHash(pull.pool_json!));
    expect(JSON.parse(pull.pool_json!).cards.common.map((c: { weight: number }) => c.weight)).toEqual([1, 2, 3, 4, 5, 6]);

    const response = await commit(e, prepared.pullId);
    const want = await expected(pull);
    expect(await settled(prepared.pullId)).toEqual(want.map((s) => ({ index: s.index, tier: s.tier, key: s.key })));
    expect(response.outcomes.map((o: { cardId: string }) => `common:A:${o.cardId}`)).toEqual(want.map((s) => s.key));
    // Ten draws over six cards: a derivation that ignored the randomness would not spread like this one does.
    expect(new Set(want.map((s) => s.key)).size).toBeGreaterThan(1);

    const after = await pullRow(prepared.pullId);
    expect(after.status).toBe('committed');
    expect(after.draw_randomness).toBe([...await fakeRandomness(pull.sequence, hexToBytes(pull.pool_hash!))]
      .map((b) => b.toString(16).padStart(2, '0')).join(''));
    expect(after.vrf_output).toBeNull();
    expect(after.draw_fulfil_signature).toBe(`fake-fulfil-${pull.sequence}`);
    expect(fakeDrawRequests(pull.sequence)).toBe(1);
  });

  it('AC-1: GET /pulls/:id/draw publishes what recomputes the pull', async () => {
    const e = magic();
    const prepared = await prepare(e, { count: 5 });
    await commit(e, prepared.pullId);
    const res = await worker.fetch(new Request(`http://example.test/pulls/${prepared.pullId}/draw`), e);
    expect(res.status).toBe(200);
    const view = await res.json() as { source: string; pool: string; poolHash: string; sequence: number; randomness: string;
      reservedPaid: number; reservedCommon: number; count: number; outcomes: { index: number; tier: string; key: string }[] };
    expect(view.source).toBe('magicblock');
    expect(await poolHash(view.pool)).toBe(view.poolHash);
    const recomputed = await deriveSlots(JSON.parse(view.pool), hexToBytes(view.randomness));
    expect(view.outcomes.map(({ index, tier, key }) => ({ index, tier, key }))).toEqual(recomputed);
  });

  it('the draw view names the cluster DRAW_CLUSTER sets, and none for anything else (#418)', async () => {
    const view = async (e: Env) => {
      const prepared = await prepare(e, { count: 1 });
      await commit(e, prepared.pullId);
      const res = await worker.fetch(new Request(`http://example.test/pulls/${prepared.pullId}/draw`), e);
      return await res.json() as { cluster: string | null; fulfilSignature: string | null };
    };
    expect((await view(magic())).cluster).toBeNull();
    expect((await view(magic({ DRAW_CLUSTER: 'devnet' }))).cluster).toBe('devnet');
    expect((await view(magic({ DRAW_CLUSTER: 'mainnet-beta' }))).cluster).toBe('mainnet-beta');
    for (const junk of ['testnet', 'Devnet', 'https://explorer.example/?x=']) expect((await view(magic({ DRAW_CLUSTER: junk }))).cluster).toBeNull();
  });

  it('AC-5: disabling cards after prepare does not change what the pull draws', async () => {
    const e = magic();
    const prepared = await prepare(e);
    const pull = await pullRow(prepared.pullId);
    const want = await expected(pull);
    // Leave only c1 live in the gacha, and make sure the pull is due to draw some of the cards now disabled.
    await testEnv.DB.prepare("UPDATE gacha_inventory SET enabled = 0 WHERE inventory_key != 'common:A:c1'").run();
    expect(want.some((s) => s.key !== 'common:A:c1')).toBe(true);
    await commit(e, prepared.pullId);
    expect((await settled(prepared.pullId)).map((s) => s.key)).toEqual(want.map((s) => s.key));
  });

  it('a pending draw answers retry-safely, then settles on a later commit with one request sent', async () => {
    const e = magic({ DRAW_FAKE: 'after:2', DRAW_WAIT_MS: '0' });
    const prepared = await prepare(e, { count: 1 });
    const pending = await failure(commit(e, prepared.pullId));
    expect([pending.code, pending.status]).toEqual(['TX_NOT_FOUND', 503]);
    expect((await pullRow(prepared.pullId)).status).toBe('prepared');
    const response = await commit(e, prepared.pullId);
    expect(response.outcomes).toHaveLength(1);
    expect(fakeDrawRequests((await pullRow(prepared.pullId)).sequence)).toBe(1);
  });

  it('a read the RPC refuses while waiting (a 429) costs that poll, not the commit', async () => {
    const e = magic({ DRAW_FAKE: 'after:3;fail:2', DRAW_WAIT_MS: '2000' });
    const prepared = await prepare(e, { count: 1 });
    expect((await commit(e, prepared.pullId)).outcomes).toHaveLength(1);
  });

  it('stored randomness settles the pull even after its draw account is gone (closed for rent)', async () => {
    const e = magic({ DRAW_FAKE: 'never', DRAW_WAIT_MS: '0' });
    const prepared = await prepare(e, { count: 5 });
    await failure(commit(e, prepared.pullId));
    const pull = await pullRow(prepared.pullId);
    // MagicBlock's bytes were stored by an earlier commit whose settlement then failed; the account has since been closed.
    const bytes = await fakeRandomness(pull.sequence, hexToBytes(pull.pool_hash!));
    await testEnv.DB.prepare('UPDATE pulls SET draw_randomness = ? WHERE id = ?')
      .bind([...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''), pull.id).run();
    resetFakeDrawChain();
    await commit(e, prepared.pullId);
    expect((await settled(prepared.pullId)).map((s) => s.key)).toEqual((await expected(pull)).map((s) => s.key));
  });

  it('a commit stops waiting at the draw deadline, however long DRAW_WAIT_MS is', async () => {
    const e = magic({ DRAW_FAKE: 'never', DRAW_WAIT_MS: '5000', DRAW_TIMEOUT_MS: '100' });
    const prepared = await prepare(e, { count: 1 });
    const started = Date.now();
    expect((await failure(commit(e, prepared.pullId))).code).toBe('EXPIRED');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('AC-3: a draw that never lands fails the whole ×10 past the timeout: no card, free pulls back, payment owed back', async () => {
    await testEnv.DB.prepare('UPDATE users SET free_common = 2 WHERE id = ?').bind('demo-user').run();
    const e = magic({ DRAW_FAKE: 'never', DRAW_WAIT_MS: '20', DRAW_TIMEOUT_MS: '150' });
    const prepared = await prepare(e);
    const pull = await pullRow(prepared.pullId);
    expect([pull.reserved_common, pull.draw_source]).toEqual([2, 'magicblock']);

    expect((await failure(commit(e, prepared.pullId))).code).toBe('TX_NOT_FOUND');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const failed = await failure(commit(e, prepared.pullId));
    expect([failed.code, failed.status]).toEqual(['EXPIRED', 409]);

    const after = await pullRow(prepared.pullId);
    expect(after.status).toBe('expired');
    expect(after.draw_failed_at).not.toBeNull();
    expect(await settled(prepared.pullId)).toEqual([]);
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM user_inventory').first<{ n: number }>())?.n).toBe(0);
    expect((await testEnv.DB.prepare('SELECT free_common FROM users WHERE id = ?').bind('demo-user').first<{ free_common: number }>())
      ?.free_common).toBe(2);
    expect(await testEnv.DB.prepare('SELECT status, reason FROM payment_obligations WHERE pull_id = ?').bind(prepared.pullId).first())
      .toEqual({ status: 'refund_pending', reason: 'DRAW_TIMEOUT' });
    expect(fakeDrawRequests(pull.sequence)).toBe(1);
  });

  it('AC-4: randomness that arrives after the pull failed settles nothing', async () => {
    const e = magic({ DRAW_FAKE: 'never', DRAW_WAIT_MS: '20', DRAW_TIMEOUT_MS: '100' });
    const prepared = await prepare(e, { count: 5 });
    await failure(commit(e, prepared.pullId));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await failure(commit(e, prepared.pullId))).code).toBe('EXPIRED');
    // MagicBlock answers late: the next commit still refuses, and nothing is settled or un-refunded.
    const late = magic({ DRAW_FAKE: 'instant' });
    expect((await failure(commit(late, prepared.pullId))).code).toBe('EXPIRED');
    expect(await settled(prepared.pullId)).toEqual([]);
    expect((await pullRow(prepared.pullId)).draw_randomness).toBeNull();
    expect((await testEnv.DB.prepare('SELECT status FROM payment_obligations WHERE pull_id = ?').bind(prepared.pullId)
      .first<{ status: string }>())?.status).toBe('refund_pending');
  });

  it('a pending draw outlives the 60 s prepare window and the abandoned-pull sweep (its payment pins it)', async () => {
    const e = magic({ DRAW_FAKE: 'after:2', DRAW_WAIT_MS: '0' });
    const prepared = await prepare(e, { count: 1 });
    await failure(commit(e, prepared.pullId));
    await testEnv.DB.prepare("UPDATE pulls SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(prepared.pullId).run();
    await expireAbandonedPulls(testEnv.DB, 'demo-user', new Date(), e);
    expect((await pullRow(prepared.pullId)).status).toBe('prepared');
    expect((await commit(e, prepared.pullId)).outcomes).toHaveLength(1);
  });

  it('a draw account requested for another pull is never read as this one: the pull waits out its timeout into a refund', async () => {
    const e = magic();
    const first = await prepare(e, { count: 1 });
    await commit(e, first.pullId);
    const sequence = (await pullRow(first.pullId)).sequence;
    // A database that reuses the sequence (a reset, or two environments on one program) while the chain keeps the old draw.
    await testEnv.DB.exec(`
      DELETE FROM season_streak_grants; DELETE FROM season_streaks; DELETE FROM season_ticket_grants; DELETE FROM season_ticket_balances;
      DELETE FROM pull_outcomes; DELETE FROM payment_obligations; DELETE FROM payment_receipts; DELETE FROM pull_settlements; DELETE FROM pulls;
      DELETE FROM inventory_consumptions; DELETE FROM user_inventory;
      UPDATE gacha_state SET next_pull_sequence = ${sequence} WHERE singleton = 1;
    `);
    const short = magic({ DRAW_WAIT_MS: '0', DRAW_TIMEOUT_MS: '100' });
    const second = await prepare(short, { count: 1 });
    expect((await pullRow(second.pullId)).sequence).toBe(sequence);
    const refused = await failure(commit(short, second.pullId));
    expect([refused.code, refused.status]).toEqual(['UNKNOWN', 503]);
    expect(await settled(second.pullId)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await failure(commit(short, second.pullId))).code).toBe('EXPIRED');
    expect((await testEnv.DB.prepare('SELECT status FROM payment_obligations WHERE pull_id = ?').bind(second.pullId)
      .first<{ status: string }>())?.status).toBe('refund_pending');
    expect(fakeDrawRequests(sequence)).toBe(1);
  });

  it('AC-6: the album chase and a pull paid wholly with burned free pulls stay on the server proof', async () => {
    const e = magic();
    const chase = await prepare(e, { count: 1, targeted: true, gachaId: 'album:A', albumId: 'A' });
    expect((await pullRow(chase.pullId)).draw_source).toBe('ecvrf');
    await testEnv.DB.prepare('UPDATE users SET free_common = 5 WHERE id = ?').bind('demo-user').run();
    const free = await prepare(e, { count: 5 });
    const freeRow = await pullRow(free.pullId);
    expect([freeRow.cost_base, freeRow.draw_source]).toEqual([0, 'ecvrf']);
    await commit(e, free.pullId, false);
    expect((await pullRow(free.pullId)).vrf_output).not.toBeNull();
    expect(fakeDrawRequests(freeRow.sequence)).toBe(0);
  });

  it('AC-6: a paid ×5 with burned free slots draws every slot, the free ones included, from MagicBlock', async () => {
    await testEnv.DB.prepare('UPDATE users SET free_common = 2 WHERE id = ?').bind('demo-user').run();
    const e = magic();
    const prepared = await prepare(e, { count: 5 });
    const pull = await pullRow(prepared.pullId);
    expect([pull.reserved_common, pull.cost_base, pull.draw_source]).toEqual([2, 3_000_000, 'magicblock']);
    await commit(e, prepared.pullId);
    expect((await settled(prepared.pullId)).map((s) => s.key)).toEqual((await expected(pull)).map((s) => s.key));
  });

  it('a pool holding finite stock stays on the server proof, and says so (Ben, 6 Oct 2026)', async () => {
    await testEnv.DB.prepare("UPDATE stock_items SET supply = 'finite', available = 9 WHERE inventory_key = 'common:A:c6'").run();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const prepared = await prepare(magic(), { count: 1 });
      expect((await pullRow(prepared.pullId)).draw_source).toBe('ecvrf');
      expect(warn.mock.calls.some(([message]) => String(message).includes('pool holds finite stock'))).toBe(true);
    } finally { warn.mockRestore(); }
  });

  it('failDraw never fails a pull whose randomness is already stored', async () => {
    const e = magic({ DRAW_FAKE: 'never', DRAW_WAIT_MS: '0' });
    const prepared = await prepare(e, { count: 1 });
    await failure(commit(e, prepared.pullId));
    await testEnv.DB.prepare("UPDATE pulls SET draw_randomness = ? WHERE id = ?").bind('ab'.repeat(32), prepared.pullId).run();
    await failDraw(testEnv.DB, await pullRow(prepared.pullId));
    const after = await pullRow(prepared.pullId);
    expect([after.status, after.draw_failed_at]).toEqual(['prepared', null]);
    expect((await testEnv.DB.prepare('SELECT status FROM payment_obligations WHERE pull_id = ?').bind(prepared.pullId)
      .first<{ status: string }>())?.status).toBe('pending');
  });

  it('a draw account for this pull but another pool is not read as this pull\'s', async () => {
    const e = magic({ DRAW_FAKE: 'after:3', DRAW_WAIT_MS: '0' });
    const prepared = await prepare(e, { count: 1 });
    await failure(commit(e, prepared.pullId)); // requested with the pool frozen at prepare
    // The row's pool is swapped after the request: same pull id, another pool hash.
    const pull = await pullRow(prepared.pullId);
    const other = JSON.stringify({ ...JSON.parse(pull.pool_json!), paid: [{ tier: 'common', weight: 7 }] });
    await testEnv.DB.prepare('UPDATE pulls SET pool_json = ?, pool_hash = ? WHERE id = ?')
      .bind(other, await poolHash(other), pull.id).run();
    const refused = await failure(commit(e, prepared.pullId));
    expect([refused.code, refused.status]).toEqual(['UNKNOWN', 503]);
    expect(await settled(prepared.pullId)).toEqual([]);
  });

  it('a pull whose frozen pool cannot be drawn is refunded before any draw is asked for, never re-split', async () => {
    await testEnv.DB.prepare('UPDATE users SET free_common = 4 WHERE id = ?').bind('demo-user').run();
    const e = magic();
    // A row that disagrees with its frozen slots, and a pool frozen before pools carried slots.
    const disagrees = await prepare(e, { count: 5 });
    await testEnv.DB.prepare('UPDATE pulls SET reserved_common = 1 WHERE id = ?').bind(disagrees.pullId).run();
    const old = await prepare(e, { count: 5 });
    const row = await pullRow(old.pullId);
    const { slots: _dropped, ...withoutSlots } = JSON.parse(row.pool_json!);
    await testEnv.DB.prepare('UPDATE pulls SET pool_json = ? WHERE id = ?').bind(JSON.stringify(withoutSlots), row.id).run();
    for (const pullId of [disagrees.pullId, old.pullId]) {
      const refused = await failure(commit(e, pullId));
      expect([refused.code, refused.status]).toEqual(['EXPIRED', 409]);
      expect(await settled(pullId)).toEqual([]);
      expect((await pullRow(pullId)).status).toBe('expired');
      expect((await testEnv.DB.prepare('SELECT status FROM payment_obligations WHERE pull_id = ?').bind(pullId)
        .first<{ status: string }>())?.status).toBe('refund_pending');
      expect(fakeDrawRequests((await pullRow(pullId)).sequence)).toBe(0);
    }
  });

  it('an undrawable pool on a pull whose bytes are already stored is reported, never answered "refunded"', async () => {
    const e = magic({ DRAW_FAKE: 'never', DRAW_WAIT_MS: '0' });
    const prepared = await prepare(e, { count: 1 });
    await failure(commit(e, prepared.pullId));
    // A row edited by hand: bytes stored, then a pool that no longer matches the row.
    await testEnv.DB.prepare('UPDATE pulls SET draw_randomness = ?, pool_json = ? WHERE id = ?')
      .bind('cd'.repeat(32), '{}', prepared.pullId).run();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const refused = await failure(commit(e, prepared.pullId));
      expect([refused.code, refused.status]).toEqual(['UNKNOWN', 503]);
      expect(error.mock.calls.some(([message]) => String(message).includes('cannot be drawn and was not failed'))).toBe(true);
    } finally { error.mockRestore(); }
    expect((await pullRow(prepared.pullId)).status).toBe('prepared');
    expect((await testEnv.DB.prepare('SELECT status FROM payment_obligations WHERE pull_id = ?').bind(prepared.pullId)
      .first<{ status: string }>())?.status).toBe('pending');
  });

  it('A: a prepare whose stored sequence cannot be read back hands out no commitment', async () => {
    // Every query but the read-back of the new pull's sequence goes to the real database.
    const db = new Proxy(testEnv.DB, { get(target, key) {
      if (key !== 'prepare') return Reflect.get(target, key).bind?.(target) ?? Reflect.get(target, key);
      return (sql: string) => sql === 'SELECT sequence FROM pulls WHERE id = ?'
        ? { bind: () => ({ first: async () => null }) }
        : target.prepare(sql);
    } }) as D1Database;
    const refused = await failure(preparePull(db, magic(), 'demo-user',
      { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID()));
    expect([refused.code, refused.status]).toEqual(['UNKNOWN', 503]);
  });

  it('A: the prepare response commits the pull to its sequence and pool hash before the user pays', async () => {
    const e = magic();
    const prepared = await prepare(e, { count: 5 }) as { pullId: string; draw?: { source: string; sequence: number; poolHash: string } };
    const row = await pullRow(prepared.pullId);
    expect(prepared.draw).toEqual({ source: 'magicblock', sequence: row.sequence, poolHash: row.pool_hash });
    expect(row.sequence).toBeGreaterThan(0);
    // A replayed prepare (same idempotency key) answers the same commitment.
    const idem = crypto.randomUUID();
    const first = await preparePull(testEnv.DB, e, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, idem);
    const again = await preparePull(testEnv.DB, e, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, idem);
    expect(again).toEqual(first);
    // A pull on the server proof carries none.
    const ecvrf = await prepare(testEnv, { count: 1 }) as { draw?: unknown };
    expect(ecvrf.draw).toBeUndefined();
  });

  it('B: the public draw view answers even when the draw settings are missing (a rotated key)', async () => {
    const e = magic();
    const prepared = await prepare(e, { count: 1 });
    await commit(e, prepared.pullId);
    await testEnv.DB.prepare('UPDATE pulls SET draw_fulfil_signature = NULL WHERE id = ?').bind(prepared.pullId).run();
    const broken = magic({ DRAW_CHAIN: 'solana', DRAW_PROGRAM_ID: undefined, DRAW_AUTHORITY_KEYPAIR: undefined });
    const res = await worker.fetch(new Request(`http://example.test/pulls/${prepared.pullId}/draw`), broken);
    expect(res.status).toBe(200);
    expect((await res.json() as { randomness: string }).randomness).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a stale commit that reaches the deadline after another settled the pull answers retry, never "refunded"', async () => {
    const e = magic();
    const prepared = await prepare(e, { count: 1 });
    const stale = await pullRow(prepared.pullId); // read before any commit
    await commit(e, prepared.pullId);
    expect((await pullRow(prepared.pullId)).status).toBe('committed');
    // The stale copy believes the draw started long ago and has no bytes; the chain no longer shows the draw.
    resetFakeDrawChain();
    const late = await failure(awaitDraw(testEnv.DB, magic({ DRAW_FAKE: 'never', DRAW_WAIT_MS: '0', DRAW_TIMEOUT_MS: '1' }),
      { ...stale, draw_requested_at: '2000-01-01T00:00:00.000Z' }));
    expect([late.code, late.status]).toEqual(['TX_NOT_FOUND', 503]);
    expect((await pullRow(prepared.pullId)).status).toBe('committed');
    expect((await commit(e, prepared.pullId)).outcomes).toHaveLength(1);
  });

  it('with the switch off, a paid pull keeps the server proof', async () => {
    const prepared = await prepare(testEnv, { count: 1 });
    expect((await pullRow(prepared.pullId)).draw_source).toBe('ecvrf');
    await commit(testEnv, prepared.pullId);
    expect((await pullRow(prepared.pullId)).vrf_output).not.toBeNull();
  });

  it('a draw that could not run is refused at prepare, before anything is reserved', async () => {
    await testEnv.DB.prepare('UPDATE users SET free_common = 2 WHERE id = ?').bind('demo-user').run();
    for (const broken of [
      magic({ ENVIRONMENT: 'preview' }), // the fake chain outside local
      magic({ DRAW_CHAIN: 'solana', DRAW_PROGRAM_ID: undefined }),
      magic({ DRAW_CHAIN: 'solana', DRAW_PROGRAM_ID: 'GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut', DRAW_AUTHORITY_KEYPAIR: '[1,2]' }),
    ]) {
      const error = await failure(prepare(broken, { count: 5 }));
      expect(error.status).toBe(503);
    }
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM pulls').first<{ n: number }>())?.n).toBe(0);
    expect((await testEnv.DB.prepare('SELECT free_common FROM users WHERE id = ?').bind('demo-user').first<{ free_common: number }>())
      ?.free_common).toBe(2);
  });
});

// The columns #406 added to pulls. scripts/magicblock-draw.sql adds them to a D1 that predates them.
const DRAW_COLUMNS = ['draw_source', 'pool_json', 'pool_hash', 'draw_account', 'draw_request_signature', 'draw_requested_at',
  'draw_randomness', 'draw_failed_at', 'draw_fulfil_signature'];

async function pullColumns(): Promise<string[]> {
  return (await testEnv.DB.prepare('SELECT name FROM pragma_table_info(\'pulls\')').all<{ name: string }>()).results.map((c) => c.name);
}

describe('a Worker with the switch off, on a D1 that predates #406', () => {
  it('prepares and commits paid, multi, chase and free pulls without scripts/magicblock-draw.sql', async () => {
    const db = testEnv.DB;
    const current = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pulls'").first<{ sql: string }>())!.sql;
    const drawColumn = new RegExp(`\\b(${DRAW_COLUMNS.join('|')})\\b`);
    // pulls as it was before #406: every line naming one of its columns (the column definitions and the CHECK tying them) goes.
    const before = current.split('\n').filter((line) => !drawColumn.test(line)).join('\n');
    await db.exec('DROP TABLE pulls');
    await db.prepare(before).run();
    await db.prepare('CREATE INDEX idx_pulls_user_status ON pulls(user_id, status)').run();
    try {
      const columns = await pullColumns();
      // The rebuild took: none of #406's columns, and the table is still the pulls table.
      expect(columns.filter((c) => DRAW_COLUMNS.includes(c))).toEqual([]);
      expect(columns).toEqual(expect.arrayContaining(['vrf_output', 'payment_checked_at', 'created_at']));

      const one = await prepare(testEnv, { count: 1 });
      expect((await commit(testEnv, one.pullId)).outcomes).toHaveLength(1);
      const ten = await prepare(testEnv, { count: 10 });
      expect((await commit(testEnv, ten.pullId)).outcomes).toHaveLength(10);
      const chase = await prepare(testEnv, { count: 1, targeted: true, gachaId: 'album:A' });
      expect((await commit(testEnv, chase.pullId)).outcomes).toHaveLength(1);
      await db.prepare('UPDATE users SET free_common = 1 WHERE id = ?').bind('demo-user').run();
      const free = await prepare(testEnv, { count: 1 });
      expect((await commit(testEnv, free.pullId, false)).outcomes).toHaveLength(1);
      expect((await pullRow(free.pullId)).cost_base).toBe(0);
      for (const id of [one.pullId, ten.pullId, chase.pullId, free.pullId]) {
        const row = await pullRow(id);
        expect([row.status, row.vrf_output === null]).toEqual(['committed', false]);
        // The public draw view reads the row whole; a missing column reads as the server proof.
        expect((await drawView(db, testEnv, 'demo-user', id)).source).toBe('ecvrf');
      }
      // A repeated prepare (same key) replays from the stored row.
      const input = { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' };
      const first = await preparePull(db, testEnv, 'demo-user', input, 'pre-406-replay');
      expect((await preparePull(db, testEnv, 'demo-user', input, 'pre-406-replay')).pullId).toBe(first.pullId);
    } finally {
      await db.exec(CLEAR_ALL);
      await db.exec('DROP TABLE pulls');
      await db.prepare(current).run();
      await db.prepare('CREATE INDEX idx_pulls_user_status ON pulls(user_id, status)').run();
    }
    expect(await pullColumns()).toEqual(expect.arrayContaining(DRAW_COLUMNS));
  });
});
