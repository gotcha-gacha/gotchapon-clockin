// The refund sweeper (#268) against the fake refund chain: a confirmed payment always resolves to pulls or a refund.
import { env } from 'cloudflare:workers';
import { getAddressEncoder } from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { checkLedger } from '../src/health';
import { ApiError } from '../src/http';
import { commitPull, preparePull } from '../src/pulls';
import { fakeRefunds, OWED_CARDS_PER_SWEEP, refundTiming, runRefundSweep, settleForPlayer, solanaRefundChain } from '../src/refunds';
import { fakeRandomness } from '../src/drawChain';
import { resetFakeDrawChain } from '../src/drawChain';
import { hexToBytes } from '../src/drawDerive';
import type { Env, PullRow } from '../src/types';

const testEnv = env as unknown as Env;
const T0 = '2026-01-01T00:00:00.000Z';
const adminKey = 'local-development-admin-key-000000000000';
const LONG_AGO = '2000-01-01T00:00:00.000Z';

function sweepEnv(overrides: Partial<Env> = {}): Env {
  return { ...testEnv, REFUND_CHAIN: 'fake', REFUNDS_ENABLED: 'true', ...overrides };
}

async function pullRow(id: string): Promise<PullRow> {
  return (await testEnv.DB.prepare('SELECT * FROM pulls WHERE id = ?').bind(id).first<PullRow>())!;
}
async function obligation(id: string) {
  return testEnv.DB.prepare('SELECT status, reason FROM payment_obligations WHERE pull_id = ?').bind(id)
    .first<{ status: string; reason: string | null }>();
}
async function refund(id: string) {
  return testEnv.DB.prepare('SELECT * FROM refunds WHERE pull_id = ?').bind(id)
    .first<{ status: string; amount: number; wallet: string; signature: string | null; mint: string }>();
}

/** A paid pull whose payment is confirmed and recorded but which never settled; `recordedAt` backdates the obligation. */
async function stuckPaidPull(count: 1 | 5 = 1, recordedAt = LONG_AGO, e: Env = testEnv) {
  const prepared = await preparePull(testEnv.DB, e, 'demo-user', { count, targeted: false, asset: 'USDC', gachaId: 'all-cards' },
    crypto.randomUUID());
  const pull = await pullRow(prepared.pullId);
  const signature = `pay-${pull.id}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(`INSERT INTO payment_receipts (signature, pull_id, asset, amount, destination, slot, finalized_at)
      VALUES (?, ?, 'USDC', ?, 'treasury', 1, ?)`).bind(signature, pull.id, pull.cost_base, recordedAt),
    testEnv.DB.prepare(`INSERT INTO payment_obligations (pull_id, signature, status, reason, created_at, updated_at)
      VALUES (?, ?, 'pending', 'RESTOCKING', ?, ?)`).bind(pull.id, signature, recordedAt, recordedAt),
    testEnv.DB.prepare('UPDATE pulls SET tx_signature = ? WHERE id = ?').bind(signature, pull.id),
  ]);
  fakeRefunds.payers.set(signature, 'payer-wallet');
  return { ...pull, tx_signature: signature };
}

const CLEAR_LEDGER = `
    DELETE FROM season_streak_grants; DELETE FROM season_streaks; DELETE FROM season_ticket_grants; DELETE FROM season_ticket_balances;
    DELETE FROM completion_rewards; DELETE FROM album_completions; DELETE FROM idempotency; DELETE FROM sweep_checks; DELETE FROM refund_attempts; DELETE FROM refunds;
    DELETE FROM pull_outcomes; DELETE FROM payment_obligations; DELETE FROM payment_receipts; DELETE FROM pull_settlements; DELETE FROM pulls;
    DELETE FROM inventory_consumptions; DELETE FROM user_inventory;`;

beforeEach(async () => {
  fakeRefunds.reset();
  resetFakeDrawChain();
  const db = testEnv.DB;
  await db.exec(`${CLEAR_LEDGER}
    DELETE FROM gacha_inventory; DELETE FROM gacha_inventory_versions;
    DELETE FROM gachas; DELETE FROM stock_items; DELETE FROM odds_config_tiers; DELETE FROM odds_configs; DELETE FROM album_cards;
    DELETE FROM cards; DELETE FROM albums; DELETE FROM faucet_grants; DELETE FROM balances; DELETE FROM users;
    UPDATE gacha_state SET next_pull_sequence = 1 WHERE singleton = 1;
  `);
  await db.batch([
    db.prepare(`INSERT INTO users (id, wallet, country, free_paid, free_common, created_at) VALUES ('demo-user', 'wallet', 'MY', 0, 0, ?)`).bind(T0),
    db.prepare("INSERT INTO balances (user_id, asset, amount) VALUES ('demo-user', 'USDC', 100000000), ('demo-user', 'USDT', 0)"),
    db.prepare("INSERT INTO albums (id, title, subtitle, cover_url, size, status, sort_order) VALUES ('A', 'Album A', 'A', 'cover', 25, 'live', 0)"),
    db.prepare(`INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
      VALUES ('c1', 'Card 1', 'TEST', '1', 'Common', 's', 'l')`),
    db.prepare("INSERT INTO album_cards (album_id, card_id, slot) VALUES ('A', 'c1', 1)"),
    db.prepare(`INSERT INTO stock_items (inventory_key, card_id, album_id, tier, available, supply)
      VALUES ('common:A:c1', 'c1', 'A', 'common', 0, 'infinite')`),
    db.prepare(`INSERT INTO odds_configs (id, kind, version, total_weight, created_at) VALUES
      ('paid-v1', 'paid', 1, 1000000, ?), ('free-v1', 'free_common', 1, 1000000, ?)`).bind(T0, T0),
    db.prepare(`INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order) VALUES
      ('paid-v1', 'common', 1000000, 'Album card', 50000, 0), ('free-v1', 'common', 1000000, 'Album card', 50000, 0)`),
    db.prepare(`INSERT INTO gachas (id, album_id, name, status, supports_targeted, paid_odds_config_id, free_odds_config_id,
      price_base, targeted_price_base, created_at, updated_at) VALUES
      ('all-cards', NULL, 'All Cards', 'active', 0, 'paid-v1', 'free-v1', 1000000, 1500000, ?, ?)`).bind(T0, T0),
    db.prepare(`INSERT INTO gacha_inventory_versions (gacha_id, inventory_version, created_at) VALUES ('all-cards', 1, ?)`).bind(T0),
    db.prepare(`INSERT INTO gacha_inventory (gacha_id, inventory_key) VALUES ('all-cards', 'common:A:c1')`),
  ]);
});

afterEach(() => vi.unstubAllGlobals());

describe('refund sweeper: deciding (#268)', () => {
  it('a confirmed payment unsettled past REFUND_AFTER_MS is failed into refund_pending: settled expired, free pulls back', async () => {
    await testEnv.DB.prepare('UPDATE users SET free_common = 2 WHERE id = ?').bind('demo-user').run();
    const pull = await stuckPaidPull(5);
    expect(pull.reserved_common).toBe(2);
    const result = await runRefundSweep(testEnv.DB, sweepEnv({ REFUNDS_ENABLED: 'false' }));
    expect(result.decided.unsettled).toBe(1);
    expect(await obligation(pull.id)).toEqual({ status: 'refund_pending', reason: 'UNSETTLED' });
    expect((await pullRow(pull.id)).status).toBe('expired');
    expect(await testEnv.DB.prepare('SELECT kind FROM pull_settlements WHERE pull_id = ?').bind(pull.id).first()).toEqual({ kind: 'expired' });
    expect((await testEnv.DB.prepare('SELECT free_common FROM users WHERE id = ?').bind('demo-user').first<{ free_common: number }>())?.free_common).toBe(2);
  });

  it('a payment recorded more recently than REFUND_AFTER_MS is left for its commit', async () => {
    const pull = await stuckPaidPull(1, new Date(Date.now() - 60_000).toISOString());
    const result = await runRefundSweep(testEnv.DB, sweepEnv({ REFUND_AFTER_MS: String(15 * 60_000) }));
    expect(result.decided.unsettled).toBe(0);
    expect(await obligation(pull.id)).toEqual({ status: 'pending', reason: 'RESTOCKING' });
    expect((await pullRow(pull.id)).status).toBe('prepared');
  });

  it('once refunded, a late commit gets no cards; once committed, the sweep owes nothing', async () => {
    const refunded = await stuckPaidPull();
    await runRefundSweep(testEnv.DB, sweepEnv({ REFUNDS_ENABLED: 'false' }));
    await expect(commitPull(testEnv.DB, testEnv, 'demo-user', refunded.id, `mock:${refunded.id}`)).rejects.toMatchObject({ code: 'EXPIRED' });
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM user_inventory').first<{ n: number }>())?.n).toBe(0);

    // A pull that settled: its obligation is fulfilled, and a sweep after it changes nothing.
    const prepared = await preparePull(testEnv.DB, testEnv, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID());
    await commitPull(testEnv.DB, testEnv, 'demo-user', prepared.pullId, `mock:${prepared.pullId}`);
    await testEnv.DB.prepare('UPDATE payment_obligations SET created_at = ? WHERE pull_id = ?').bind(LONG_AGO, prepared.pullId).run();
    const result = await runRefundSweep(testEnv.DB, sweepEnv());
    expect(await obligation(prepared.pullId)).toMatchObject({ status: 'fulfilled' });
    expect(await refund(prepared.pullId)).toBeNull();
    expect(result.decided.unsettled).toBe(0);
  });

  it('a MagicBlock draw nobody re-committed is failed at the draw timeout (DRAW_TIMEOUT), not after 15 minutes', async () => {
    const pull = await stuckPaidPull(1, new Date().toISOString());
    await testEnv.DB.prepare(`UPDATE pulls SET draw_source = 'magicblock', pool_json = '{}', pool_hash = ?, draw_requested_at = ?
      WHERE id = ?`).bind('ab'.repeat(32), new Date(Date.now() - 120_000).toISOString(), pull.id).run();
    // The draw chain answers: no draw account for this sequence, so nothing landed and a refund is right.
    const result = await runRefundSweep(testEnv.DB, sweepEnv({ REFUNDS_ENABLED: 'false', DRAW_TIMEOUT_MS: '60000', DRAW_CHAIN: 'fake' }));
    expect(result.decided.drawTimeouts).toBe(1);
    expect(await obligation(pull.id)).toEqual({ status: 'refund_pending', reason: 'DRAW_TIMEOUT' });
  });

  it('a pull whose drawn bytes are stored is owed cards, not money: reported, never refunded', async () => {
    const pull = await stuckPaidPull();
    await testEnv.DB.prepare(`UPDATE pulls SET draw_source = 'magicblock', pool_json = '{}', pool_hash = ?, draw_randomness = ?
      WHERE id = ?`).bind('ab'.repeat(32), 'cd'.repeat(32), pull.id).run();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runRefundSweep(testEnv.DB, sweepEnv());
      expect(result.decided.cannotSettle).toEqual([pull.id]);
      expect(error.mock.calls.some(([m]) => String(m).includes('could not be settled this sweep'))).toBe(true);
    } finally { error.mockRestore(); }
    expect(await obligation(pull.id)).toMatchObject({ status: 'pending' });
    expect(await refund(pull.id)).toBeNull();
    expect((await checkLedger(testEnv.DB)).violations.paidPullCannotSettle).toBe(1);
  });
});

describe('refund sweeper: a draw that landed is owed cards (#420 review)', () => {
  const drawEnv = (overrides: Partial<Env> = {}) => sweepEnv({ DRAW_SOURCE: 'magicblock', DRAW_CHAIN: 'fake', DRAW_FAKE: 'after:2',
    DRAW_WAIT_MS: '0', DRAW_TIMEOUT_MS: '60000', REFUNDS_ENABLED: 'false', ...overrides });

  it('a MagicBlock draw that landed after the player stopped committing is settled for them, never refunded', async () => {
    const e = drawEnv();
    const prepared = await preparePull(testEnv.DB, e, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID());
    // The player's commit pays and requests the draw, then gives up while it is still being drawn.
    await expect(commitPull(testEnv.DB, e, 'demo-user', prepared.pullId, `mock:${prepared.pullId}`)).rejects.toMatchObject({ code: 'TX_NOT_FOUND' });
    await testEnv.DB.prepare('UPDATE pulls SET draw_requested_at = ? WHERE id = ?').bind(LONG_AGO, prepared.pullId).run();
    const result = await runRefundSweep(testEnv.DB, e);
    expect(result.decided).toMatchObject({ drawTimeouts: 0, settledForPlayer: 1, cannotSettle: [] });
    expect((await pullRow(prepared.pullId)).status).toBe('committed');
    expect(await obligation(prepared.pullId)).toMatchObject({ status: 'fulfilled' });
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM user_inventory').first<{ n: number }>())?.n).toBe(1);
    expect(await refund(prepared.pullId)).toBeNull();
  });

  it('a MagicBlock pull the sweep cannot check on chain is left alone and reported, never refunded blind', async () => {
    const e = drawEnv();
    const prepared = await preparePull(testEnv.DB, e, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID());
    await expect(commitPull(testEnv.DB, e, 'demo-user', prepared.pullId, `mock:${prepared.pullId}`)).rejects.toMatchObject({ code: 'TX_NOT_FOUND' });
    await testEnv.DB.prepare('UPDATE pulls SET draw_requested_at = ? WHERE id = ?').bind(LONG_AGO, prepared.pullId).run();
    await testEnv.DB.prepare('UPDATE payment_obligations SET created_at = ? WHERE pull_id = ?').bind(LONG_AGO, prepared.pullId).run();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let result;
    try { result = await runRefundSweep(testEnv.DB, drawEnv({ DRAW_CHAIN: 'solana', DRAW_PROGRAM_ID: undefined })); }
    finally { error.mockRestore(); }
    expect(result.decided.undecided).toContain(prepared.pullId);
    expect(result.decided).toMatchObject({ drawTimeouts: 0, unsettled: 0 });
    expect((await pullRow(prepared.pullId)).status).toBe('prepared');
    expect(await obligation(prepared.pullId)).toMatchObject({ status: 'pending' });
  });
});

describe('refund sweeper: owed cards are retried until they settle (#420 review, round 2)', () => {
  const drawEnv = (overrides: Partial<Env> = {}) => sweepEnv({ DRAW_SOURCE: 'magicblock', DRAW_CHAIN: 'fake', DRAW_FAKE: 'after:2',
    DRAW_WAIT_MS: '0', DRAW_TIMEOUT_MS: '60000', REFUNDS_ENABLED: 'false', ...overrides });

  it('A: a settle that fails once (a blip) is retried on the next sweep and the player gets the cards', async () => {
    const e = drawEnv();
    const prepared = await preparePull(testEnv.DB, e, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID());
    await expect(commitPull(testEnv.DB, e, 'demo-user', prepared.pullId, `mock:${prepared.pullId}`)).rejects.toMatchObject({ code: 'TX_NOT_FOUND' });
    await testEnv.DB.prepare('UPDATE pulls SET draw_requested_at = ? WHERE id = ?').bind(LONG_AGO, prepared.pullId).run();
    await testEnv.DB.prepare('UPDATE payment_obligations SET created_at = ? WHERE pull_id = ?').bind(LONG_AGO, prepared.pullId).run();
    // The blip: the mock balance cannot cover the pull when the sweep settles it, so that commit fails.
    await testEnv.DB.prepare("UPDATE balances SET amount = 0 WHERE user_id = 'demo-user' AND asset = 'USDC'").run();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let first;
    try { first = await runRefundSweep(testEnv.DB, e); } finally { error.mockRestore(); }
    expect(first.decided.cannotSettle).toEqual([prepared.pullId]); // once, not twice
    expect((await pullRow(prepared.pullId)).status).toBe('prepared');
    expect((await pullRow(prepared.pullId)).draw_randomness).not.toBeNull();
    // The blip passes; the next sweep settles it.
    await testEnv.DB.prepare("UPDATE balances SET amount = 100000000 WHERE user_id = 'demo-user' AND asset = 'USDC'").run();
    const second = await runRefundSweep(testEnv.DB, e);
    expect(second.decided).toMatchObject({ settledForPlayer: 1, cannotSettle: [] });
    expect((await pullRow(prepared.pullId)).status).toBe('committed');
    expect(await obligation(prepared.pullId)).toMatchObject({ status: 'fulfilled' });
  });

  it('a draw account at this sequence that belongs to another pull is not this pull\'s draw: no cards from it', async () => {
    const e = drawEnv({ DRAW_FAKE: 'instant' });
    const prepared = await preparePull(testEnv.DB, e, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID());
    const pull = await pullRow(prepared.pullId);
    // The chain already holds a fulfilled draw at this sequence, requested for another pull (a reused sequence).
    const { drawChain } = await import('../src/drawChain');
    await drawChain(e).request({ sequence: pull.sequence, pullIdHash: new Uint8Array(32).fill(9), count: 1, poolHash: hexToBytes(pull.pool_hash!) });
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO payment_receipts (signature, pull_id, asset, amount, destination, slot, finalized_at)
        VALUES (?, ?, 'USDC', 1000000, 'treasury', 1, ?)`).bind(`pay-${pull.id}`, pull.id, LONG_AGO),
      testEnv.DB.prepare(`INSERT INTO payment_obligations (pull_id, signature, status, reason, created_at, updated_at)
        VALUES (?, ?, 'pending', 'awaiting_allocation', ?, ?)`).bind(pull.id, `pay-${pull.id}`, LONG_AGO, LONG_AGO),
      testEnv.DB.prepare('UPDATE pulls SET tx_signature = ?, draw_requested_at = ? WHERE id = ?').bind(`pay-${pull.id}`, LONG_AGO, pull.id),
    ]);
    const result = await runRefundSweep(testEnv.DB, e);
    expect(result.decided).toMatchObject({ settledForPlayer: 0, drawTimeouts: 1 });
    expect((await pullRow(pull.id)).draw_randomness).toBeNull();
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM user_inventory').first<{ n: number }>())?.n).toBe(0);
  });
});

describe('refund sweeper: undecidable pulls cannot block deciding (#420 review, round 2)', () => {
  it('B: fifty MagicBlock pulls the sweep cannot check do not keep a refundable pull from being decided', async () => {
    const e = sweepEnv({ REFUNDS_ENABLED: 'false', DRAW_CHAIN: 'solana', DRAW_PROGRAM_ID: undefined });
    for (let i = 0; i < 50; i++) {
      const pull = await stuckPaidPull(1, '2000-01-01T00:00:00.000Z');
      await testEnv.DB.prepare(`UPDATE pulls SET draw_source = 'magicblock', pool_json = '{}', pool_hash = ?, draw_requested_at = ?
        WHERE id = ?`).bind('ab'.repeat(32), '2000-01-01T00:00:00.000Z', pull.id).run();
    }
    const refundable = await stuckPaidPull(1, '2001-01-01T00:00:00.000Z');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runRefundSweep(testEnv.DB, e);
      await runRefundSweep(testEnv.DB, e);
    } finally { error.mockRestore(); }
    expect(await obligation(refundable.id)).toMatchObject({ status: 'refund_pending' });
    // And the ones that cannot be decided show on the ledger, not only in the logs.
    expect((await checkLedger(testEnv.DB)).violations.magicblockUndecided).toBe(50);
  }, 60_000);
});

describe('refund sweeper: deciding is not starved (#420 review)', () => {
  it('fifty older pulls that are owed cards do not keep a refundable one behind them from being decided', async () => {
    const owedCards = [];
    for (let i = 0; i < 50; i++) owedCards.push(await stuckPaidPull(1, '2000-01-01T00:00:00.000Z'));
    for (const pull of owedCards) {
      await testEnv.DB.prepare(`UPDATE pulls SET draw_source = 'magicblock', pool_json = '{}', pool_hash = ?, draw_randomness = ?
        WHERE id = ?`).bind('ab'.repeat(32), 'cd'.repeat(32), pull.id).run();
    }
    const refundable = await stuckPaidPull(1, '2001-01-01T00:00:00.000Z');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let result;
    try { result = await runRefundSweep(testEnv.DB, sweepEnv({ REFUNDS_ENABLED: 'false', DRAW_CHAIN: 'fake' })); }
    finally { error.mockRestore(); }
    expect(result.decided.unsettled).toBe(1);
    expect(await obligation(refundable.id)).toMatchObject({ status: 'refund_pending' });
    expect(result.decided.cannotSettle).toHaveLength(OWED_CARDS_PER_SWEEP); // capped a sweep (#422)
  }, 60_000);
});

describe('refund sweeper follow-ups (#422)', () => {
  /** A recorded MagicBlock pull whose drawn bytes are stored but whose pool cannot be drawn, so every settle fails. */
  async function owedCardsThatFail(recordedAt = '2000-01-01T00:00:00.000Z') {
    const pull = await stuckPaidPull(1, recordedAt);
    await testEnv.DB.prepare(`UPDATE pulls SET draw_source = 'magicblock', pool_json = '{}', pool_hash = ?, draw_randomness = ?
      WHERE id = ?`).bind('ab'.repeat(32), 'cd'.repeat(32), pull.id).run();
    return pull;
  }

  it(`retries at most ${OWED_CARDS_PER_SWEEP} owed-card pulls a sweep, and reaches every one in turn`, async () => {
    const pulls = [];
    for (let i = 0; i < OWED_CARDS_PER_SWEEP + 2; i++) pulls.push(await owedCardsThatFail());
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen = new Set<string>();
    try {
      for (let sweep = 0; sweep < 2; sweep++) {
        const result = await runRefundSweep(testEnv.DB, sweepEnv({ REFUNDS_ENABLED: 'false' }));
        expect(result.decided.cannotSettle.length).toBeLessThanOrEqual(OWED_CARDS_PER_SWEEP);
        for (const id of result.decided.cannotSettle) seen.add(id);
      }
    } finally { error.mockRestore(); }
    expect([...seen].sort()).toEqual(pulls.map((p) => p.id).sort());
  }, 60_000);

  it('a MagicBlock pull that never got as far as requesting its draw rotates on the stuck list (its stamp)', async () => {
    // Payment recorded, no draw_requested_at (the draw program was removed before the request), chain unreadable: only the
    // 15-minute list sees these, and only its stamp moves them back.
    const e = sweepEnv({ REFUNDS_ENABLED: 'false', DRAW_CHAIN: 'solana', DRAW_PROGRAM_ID: undefined });
    for (let i = 0; i < 50; i++) {
      const pull = await stuckPaidPull(1, '2000-01-01T00:00:00.000Z');
      await testEnv.DB.prepare(`UPDATE pulls SET draw_source = 'magicblock', pool_json = '{}', pool_hash = ? WHERE id = ?`)
        .bind('ab'.repeat(32), pull.id).run();
    }
    const refundable = await stuckPaidPull(1, '2001-01-01T00:00:00.000Z');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runRefundSweep(testEnv.DB, e);
      await runRefundSweep(testEnv.DB, e);
    } finally { error.mockRestore(); }
    expect(await obligation(refundable.id)).toMatchObject({ status: 'refund_pending' });
  }, 60_000);

  it('owed cards are settled once the draw timeout has passed, not only after REFUND_AFTER_MS', async () => {
    const e = sweepEnv({ DRAW_SOURCE: 'magicblock', DRAW_CHAIN: 'fake', DRAW_FAKE: 'never', DRAW_WAIT_MS: '0',
      DRAW_TIMEOUT_MS: '60000', REFUND_AFTER_MS: String(15 * 60_000), REFUNDS_ENABLED: 'false' });
    const prepared = await preparePull(testEnv.DB, e, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID());
    await expect(commitPull(testEnv.DB, e, 'demo-user', prepared.pullId, `mock:${prepared.pullId}`)).rejects.toMatchObject({ code: 'TX_NOT_FOUND' });
    const pull = await pullRow(prepared.pullId);
    // Two minutes ago: past the 60 s draw timeout, well inside the 15-minute refund wait. The bytes are already stored.
    const twoMinutes = new Date(Date.now() - 120_000).toISOString();
    const bytes = await fakeRandomness(pull.sequence, hexToBytes(pull.pool_hash!));
    await testEnv.DB.prepare('UPDATE pulls SET draw_randomness = ?, draw_requested_at = ? WHERE id = ?')
      .bind([...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''), twoMinutes, pull.id).run();
    await testEnv.DB.prepare('UPDATE payment_obligations SET created_at = ? WHERE pull_id = ?').bind(twoMinutes, pull.id).run();
    const result = await runRefundSweep(testEnv.DB, e);
    expect(result.decided.settledForPlayer).toBe(1);
    expect((await pullRow(pull.id)).status).toBe('committed');
  });

  it('a pull the player already settled is not settled again or counted', async () => {
    const prepared = await preparePull(testEnv.DB, testEnv, 'demo-user', { count: 1, targeted: false, asset: 'USDC', gachaId: 'all-cards' }, crypto.randomUUID());
    const before = await pullRow(prepared.pullId);
    await commitPull(testEnv.DB, testEnv, 'demo-user', prepared.pullId, `mock:${prepared.pullId}`);
    const decided = { drawTimeouts: 0, unsettled: 0, settledForPlayer: 0, cannotSettle: [] as string[], undecided: [] as string[] };
    await settleForPlayer(testEnv.DB, testEnv, before, decided); // the sweep's copy, read before the player's commit
    expect(decided).toMatchObject({ settledForPlayer: 0, cannotSettle: [] });
  });
});

describe('refund sweeper: sending (#268)', () => {
  it('with REFUNDS_ENABLED unset it decides and sends nothing', async () => {
    const pull = await stuckPaidPull();
    const result = await runRefundSweep(testEnv.DB, sweepEnv({ REFUNDS_ENABLED: undefined }));
    expect(result.sending).toBe(false);
    expect(await obligation(pull.id)).toMatchObject({ status: 'refund_pending' });
    expect(await refund(pull.id)).toBeNull();
    expect(fakeRefunds.prepared).toEqual([]);
  });

  it('sends exactly the receipt amount to the wallet that paid, once, and the obligation turns refunded', async () => {
    const pull = await stuckPaidPull(5);
    const result = await runRefundSweep(testEnv.DB, sweepEnv());
    expect(result.sent.sent).toBe(1);
    expect(await refund(pull.id)).toMatchObject({ status: 'sent', amount: 5_000_000, wallet: 'payer-wallet', mint: testEnv.USDC_MINT });
    expect(await obligation(pull.id)).toMatchObject({ status: 'refunded' });
    expect(fakeRefunds.prepared).toEqual([{ pullId: pull.id, wallet: 'payer-wallet', amount: 5_000_000, signature: expect.any(String) }]);
    // Another sweep owes nothing and signs nothing.
    await runRefundSweep(testEnv.DB, sweepEnv());
    expect(fakeRefunds.prepared).toHaveLength(1);
    expect((await checkLedger(testEnv.DB)).ok).toBe(true);
  });

  it('a refund whose broadcast answer is lost is rebroadcast with the SAME signed bytes, never signed twice', async () => {
    const pull = await stuckPaidPull();
    fakeRefunds.broadcastOutcomes = ['throw'];
    await runRefundSweep(testEnv.DB, sweepEnv());
    const first = await refund(pull.id);
    expect(first).toMatchObject({ status: 'prepared' });
    expect(await obligation(pull.id)).toMatchObject({ status: 'refund_pending' });
    await runRefundSweep(testEnv.DB, sweepEnv());
    expect(fakeRefunds.prepared).toHaveLength(1);
    expect(await refund(pull.id)).toMatchObject({ status: 'sent', signature: first!.signature });
    expect(await obligation(pull.id)).toMatchObject({ status: 'refunded' });
  });

  it('a refund the chain proves can never land is signed again on the next sweep', async () => {
    const pull = await stuckPaidPull();
    fakeRefunds.broadcastOutcomes = ['void'];
    await runRefundSweep(testEnv.DB, sweepEnv());
    expect(await refund(pull.id)).toMatchObject({ status: 'reserved', signature: null });
    await runRefundSweep(testEnv.DB, sweepEnv());
    expect(fakeRefunds.prepared).toHaveLength(2);
    expect(await obligation(pull.id)).toMatchObject({ status: 'refunded' });
  });

  it('the daily cap stops the sweep before signing what would pass it', async () => {
    const a = await stuckPaidPull(5);
    const b = await stuckPaidPull(5);
    const result = await runRefundSweep(testEnv.DB, sweepEnv({ REFUND_DAILY_CAP_BASE: '7000000' }));
    expect(result.sent).toMatchObject({ sent: 1, stoppedBy: 'daily-cap' });
    const statuses = [(await obligation(a.id))!.status, (await obligation(b.id))!.status].sort();
    expect(statuses).toEqual(['refund_pending', 'refunded']);
    expect(fakeRefunds.prepared).toHaveLength(1);
  });

  it('a float too low to cover a refund stops the sweep with nothing signed', async () => {
    const pull = await stuckPaidPull(5);
    const next = await stuckPaidPull(5);
    fakeRefunds.float = 1_000_000;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runRefundSweep(testEnv.DB, sweepEnv());
      expect(result.sent).toMatchObject({ sent: 0, stoppedBy: 'float' });
      expect(error.mock.calls.some(([m]) => String(m).includes('float is too low'))).toBe(true);
    } finally { error.mockRestore(); }
    const reserved = [await refund(pull.id), await refund(next.id)].filter(Boolean);
    expect(reserved).toHaveLength(1); // the sweep stopped at the first, rather than trying the rest against the same float
    expect(reserved[0]).toMatchObject({ status: 'reserved' });
    expect(await obligation(pull.id)).toMatchObject({ status: 'refund_pending' });
  });

  it('REFUND_BATCH refunds a sweep, the rest on the next', async () => {
    for (let i = 0; i < 3; i++) await stuckPaidPull();
    const first = await runRefundSweep(testEnv.DB, sweepEnv({ REFUND_BATCH: '2' }));
    expect(first.sent).toMatchObject({ sent: 2, stoppedBy: 'batch' });
    const second = await runRefundSweep(testEnv.DB, sweepEnv({ REFUND_BATCH: '2' }));
    expect(second.sent).toMatchObject({ sent: 1, stoppedBy: null });
  });

  it('refunds that keep failing cannot hold the batch: a good one behind them is refunded within two sweeps', async () => {
    const failing = [];
    for (let i = 0; i < 5; i++) failing.push(await stuckPaidPull());
    for (const pull of failing) fakeRefunds.payers.delete(pull.tx_signature!); // their payment cannot be read
    const good = await stuckPaidPull();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runRefundSweep(testEnv.DB, sweepEnv({ REFUND_BATCH: '5' }));
      await runRefundSweep(testEnv.DB, sweepEnv({ REFUND_BATCH: '5' }));
    } finally { error.mockRestore(); }
    expect(await obligation(good.id)).toMatchObject({ status: 'refunded' });
    for (const pull of failing) expect(await obligation(pull.id)).toMatchObject({ status: 'refund_pending' });
  });

  it('a void for one signature never resets a refund that another sweep has since signed again', async () => {
    const pull = await stuckPaidPull();
    fakeRefunds.broadcastOutcomes = ['void'];
    // While this sweep broadcasts signature A, another has voided A and stored B.
    fakeRefunds.onBroadcast = async () => {
      fakeRefunds.onBroadcast = null;
      await testEnv.DB.prepare(`UPDATE refunds SET signature = 'sig-B', transaction_base64 = 'tx-B' WHERE pull_id = ?`).bind(pull.id).run();
    };
    await runRefundSweep(testEnv.DB, sweepEnv());
    expect(await refund(pull.id)).toMatchObject({ status: 'prepared', signature: 'sig-B' });
  });

  it('a refund still owed after an hour is a ledger violation', async () => {
    const pull = await stuckPaidPull();
    await runRefundSweep(testEnv.DB, sweepEnv({ REFUNDS_ENABLED: 'false' }));
    await testEnv.DB.prepare('UPDATE payment_obligations SET updated_at = ? WHERE pull_id = ?').bind(LONG_AGO, pull.id).run();
    expect((await checkLedger(testEnv.DB)).violations.refundsOverdue).toBe(1);
  });

  it('the fake refund chain is refused outside local', async () => {
    await stuckPaidPull();
    await expect(runRefundSweep(testEnv.DB, sweepEnv({ ENVIRONMENT: 'preview' }))).rejects.toThrow('local only');
  });
});

describe('refund sweeper: wiring (#268)', () => {
  it('POST /admin/refunds/run needs the admin key, then runs the sweep', async () => {
    const pull = await stuckPaidPull();
    const e = sweepEnv();
    const refused = await worker.fetch(new Request('http://example.test/admin/refunds/run', { method: 'POST' }), e);
    expect(refused.status).toBe(401);
    const ran = await worker.fetch(new Request('http://example.test/admin/refunds/run',
      { method: 'POST', headers: { 'x-admin-api-key': adminKey } }), e);
    expect(ran.status).toBe(200);
    expect(await obligation(pull.id)).toMatchObject({ status: 'refunded' });
  });

  it('the Cron Trigger runs the sweep', async () => {
    const pull = await stuckPaidPull();
    const waits: Promise<unknown>[] = [];
    await worker.scheduled!({} as ScheduledController, sweepEnv(), { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext);
    await Promise.all(waits);
    expect(await obligation(pull.id)).toMatchObject({ status: 'refunded' });
  });
});

describe('refund chain: who paid (#268)', () => {
  const ix = (info: Record<string, string>) => ({ program: 'spl-token', parsed: { type: 'transferChecked', info } });
  function stubTx(instructions: unknown[], err: unknown = null) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1,
      result: { meta: { err }, transaction: { message: { instructions } } } }))));
  }
  const MINT = 'MintUsdc', TREASURY = 'Treasury';

  it('the refund goes to the authority of the payment\'s one transfer into the treasury', async () => {
    stubTx([{ program: 'spl-memo', parsed: 'pull_1' }, ix({ authority: 'PayerWallet', destination: TREASURY, mint: MINT })]);
    expect(await solanaRefundChain.payer(testEnv, 'sig', MINT, TREASURY)).toBe('PayerWallet');
  });

  it('no single transfer to the treasury in that mint, or a failed transaction, is refused', async () => {
    for (const [instructions, err] of [
      [[ix({ authority: 'A', destination: TREASURY, mint: MINT }), ix({ authority: 'B', destination: TREASURY, mint: MINT })], null],
      [[ix({ authority: 'A', destination: 'Elsewhere', mint: MINT })], null],
      [[ix({ authority: 'A', destination: TREASURY, mint: 'OtherMint' })], null],
      [[ix({ authority: 'A', destination: TREASURY, mint: MINT })], { InstructionError: [0, 'Custom'] }],
    ] as [unknown[], unknown][]) {
      stubTx(instructions, err);
      await expect(solanaRefundChain.payer(testEnv, 'sig', MINT, TREASURY)).rejects.toBeInstanceOf(ApiError);
    }
  });
});

// #406's columns on pulls (scripts/magicblock-draw.sql) and the refunds table (scripts/refunds.sql) reach each deployed D1 when
// someone runs the script. The cron runs on every environment from the moment this Worker is deployed (#419's lesson).
const DRAW_COLUMNS = ['draw_source', 'pool_json', 'pool_hash', 'draw_account', 'draw_request_signature', 'draw_requested_at',
  'draw_randomness', 'draw_failed_at', 'draw_fulfil_signature'];

describe('refund sweeper on a D1 neither script has reached (#268)', () => {
  it('decides refunds, sends none, and /admin/ledger still answers, without #406\'s columns or the refunds table', async () => {
    const db = testEnv.DB;
    const pulls = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pulls'").first<{ sql: string }>())!.sql;
    const refundsTable = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'refunds'").first<{ sql: string }>())!.sql;
    const attemptsTable = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'refund_attempts'").first<{ sql: string }>())!.sql;
    const checksTable = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sweep_checks'").first<{ sql: string }>())!.sql;
    const drawColumn = new RegExp(`\\b(${DRAW_COLUMNS.join('|')})\\b`);
    await db.exec(CLEAR_LEDGER);
    await db.exec('DROP TABLE sweep_checks');
    await db.exec('DROP TABLE refund_attempts');
    await db.exec('DROP TABLE refunds');
    await db.exec('DROP TABLE pulls');
    await db.prepare(pulls.split('\n').filter((line) => !drawColumn.test(line)).join('\n')).run();
    await db.prepare('CREATE INDEX idx_pulls_user_status ON pulls(user_id, status)').run();
    try {
      const columns = (await db.prepare("SELECT name FROM pragma_table_info('pulls')").all<{ name: string }>()).results.map((c) => c.name);
      expect(columns.filter((c) => DRAW_COLUMNS.includes(c))).toEqual([]);
      expect(await db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'refunds'").first()).toBeNull();
      expect(await db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sweep_checks'").first()).toBeNull();

      const pull = await stuckPaidPull();
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      let result;
      try { result = await runRefundSweep(db, sweepEnv()); } finally { error.mockRestore(); }
      expect(result.decided.unsettled).toBe(1);
      expect(result.sent).toMatchObject({ sent: 0, errors: ['refund tables missing'] });
      expect(await obligation(pull.id)).toMatchObject({ status: 'refund_pending', reason: 'UNSETTLED' });

      const ledger = await worker.fetch(new Request('http://example.test/admin/ledger', { headers: { 'x-admin-api-key': adminKey } }), testEnv);
      expect(ledger.status).toBe(200);
      expect((await ledger.json() as { ok: boolean }).ok).toBe(true);
    } finally {
      await db.exec(CLEAR_LEDGER.replace('DELETE FROM sweep_checks; DELETE FROM refund_attempts; DELETE FROM refunds;', ''));
      await db.exec('DROP TABLE pulls');
      await db.prepare(pulls).run();
      await db.prepare('CREATE INDEX idx_pulls_user_status ON pulls(user_id, status)').run();
      await db.prepare(refundsTable).run();
      await db.prepare(attemptsTable).run();
      await db.prepare(checksTable).run();
    }
    const restored = (await db.prepare("SELECT name FROM pragma_table_info('pulls')").all<{ name: string }>()).results.map((c) => c.name);
    expect(restored).toEqual(expect.arrayContaining(DRAW_COLUMNS));
  });
});

describe('refund chain: the real adapter\'s answers (#420 review)', () => {
  type Status = { err: unknown; confirmationStatus: string } | null;
  /** A JSON-RPC stand-in: signature statuses in order (the last repeats), the chain's height, and the sends it saw. */
  function rpcStub(statuses: Status[], blockHeight = 100, slot = 1_000) {
    const sends: unknown[] = [];
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body);
      const result = method === 'getSignatureStatuses' ? { context: { slot }, value: [statuses[Math.min(i++, statuses.length - 1)]] }
        : method === 'getEpochInfo' ? { absoluteSlot: slot, blockHeight }
        : method === 'sendTransaction' ? (sends.push(params), 'sig') : null;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
    }));
    return sends;
  }
  const signed = { signature: 'sig', transactionBase64: 'AQ==', lastValidBlockHeight: 150 };
  beforeEach(() => { refundTiming.polls = 3; refundTiming.intervalMs = 1; });
  afterEach(() => { refundTiming.polls = 24; refundTiming.intervalMs = 500; });

  it('confirmed with no error is sent; confirmed with an error is void (nothing moved)', async () => {
    rpcStub([{ err: null, confirmationStatus: 'confirmed' }]);
    expect(await solanaRefundChain.broadcast(testEnv, signed)).toBe('sent');
    rpcStub([{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' }]);
    expect(await solanaRefundChain.broadcast(testEnv, signed)).toBe('void');
  });

  it('no status while the blockhash can still land is never void: it is sent and waited for, then "still confirming"', async () => {
    const sends = rpcStub([null], 100);
    await expect(solanaRefundChain.broadcast(testEnv, signed)).rejects.toThrow('still confirming');
    expect(sends).toHaveLength(1);
  });

  it('a status only "processed" (could be on a dropped fork) is neither sent nor void', async () => {
    rpcStub([{ err: null, confirmationStatus: 'processed' }]);
    await expect(solanaRefundChain.broadcast(testEnv, signed)).rejects.toThrow('still confirming');
    rpcStub([{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'processed' }]);
    await expect(solanaRefundChain.broadcast(testEnv, signed)).rejects.toThrow('still confirming');
  });

  it('no status with the confirmed height past the blockhash\'s life, read again from a node as far along, is void', async () => {
    rpcStub([null, null], 151, 1_000);
    expect(await solanaRefundChain.broadcast(testEnv, signed)).toBe('void');
  });

  async function throwawayKey() {
    vi.stubGlobal('isSecureContext', true);
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const seed = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).slice(-32);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
    const { getBase58Decoder } = await import('@solana/kit');
    return { json: JSON.stringify([...seed, ...pub]), address: getBase58Decoder().decode(pub) };
  }

  it('prepare refuses a float that cannot cover the refund (INSUFFICIENT_FUNDS), signing nothing', async () => {
    const key = await throwawayKey();
    const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    // The refund wallet's token account: this mint, this owner, 999,999 base units (one unit short of $1).
    const data = new Uint8Array(165);
    data.set(getAddressEncoder().encode(MINT as never), 0);
    data.set(getAddressEncoder().encode(key.address as never), 32);
    new DataView(data.buffer).setBigUint64(64, 999_999n, true);
    data[108] = 1; // initialized
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const { method, id } = JSON.parse(init.body);
      methods.push(method);
      const result = method === 'getAccountInfo' ? { context: { slot: 1 }, value: { data: [btoa(String.fromCharCode(...data)), 'base64'],
        executable: false, lamports: 2_039_280, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rentEpoch: 0, space: 165 } } : null;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }));
    await expect(solanaRefundChain.prepare({ ...testEnv, REFUND_KEYPAIR: key.json, REFUND_ADDRESS: key.address },
      { pullId: 'p', wallet: 'So11111111111111111111111111111111111111112', mint: MINT, amount: 1_000_000 }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(methods).toEqual(['getAccountInfo']);
  });

  it('prepare refuses a key that is not REFUND_ADDRESS, before touching the chain', async () => {
    vi.stubGlobal('isSecureContext', true);
    // A throwaway key pair, made here: 64 bytes, secret seed then public key, as REFUND_KEYPAIR holds.
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const seed = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).slice(-32);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
    const key = JSON.stringify([...seed, ...pub]);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(solanaRefundChain.prepare({ ...testEnv, REFUND_KEYPAIR: key, REFUND_ADDRESS: 'So11111111111111111111111111111111111111112' },
      { pullId: 'p', wallet: 'So11111111111111111111111111111111111111112', mint: 'So11111111111111111111111111111111111111112', amount: 1 }))
      .rejects.toThrow(/REFUND_ADDRESS|refund key/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
