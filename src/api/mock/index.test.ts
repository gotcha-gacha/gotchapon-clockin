// The mock keeps the server's product rules. These are the rules, named — CLAUDE.md "Non-negotiable
// product rules" + BUILD_PLAN §2 "Contract rules". The same suite should pass against Dev 2's mock
// server once EXPO_PUBLIC_API_URL points at it (swap `createMockApi` for `createHttpApi`).
import { beforeEach, describe, expect, test } from '@jest/globals';
import { createMockApi, DEMO_WALLET, type MockApi } from './index';
import { ALBUMS, POOLS } from './fixtures';
import { ApiError } from '../errors';
import { ALBUM_SIZE, BURN_COST, INVENTORY_GACHA_ID, type PullCommitResponse, type PullPrepareRequest } from '../contract';

let clock = Date.parse('2026-09-10T04:00:00Z'); // 12:00 MYT
const now = () => clock;
let api: MockApi;

const idem = (() => { let n = 0; return () => `idem-${++n}`; })();

function preparePull(req: Omit<PullPrepareRequest, 'gachaId'> & { gachaId?: string }) {
  const gachaId = req.gachaId ?? (req.albumId ? `album:${req.albumId}` : INVENTORY_GACHA_ID);
  return api.preparePull({ ...req, gachaId });
}

async function pull(count: 1 | 5 | 10 = 1, opts: { targeted?: boolean; albumId?: string } = {}): Promise<PullCommitResponse> {
  const prep = await preparePull({ count, targeted: opts.targeted ?? false, albumId: opts.albumId, asset: 'USDC', idem: idem() });
  return api.commitPull({ pullId: prep.pullId, txSignature: prep.transfer ? `mock:${prep.pullId}` : undefined });
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: 'ApiError', code });
}

beforeEach(() => {
  clock = Date.parse('2026-09-10T04:00:00Z');
  api = createMockApi({ latencyMs: 0, now, seed: 'test' });
});

describe('a new session', () => {
  test('a new user has no starter free pulls and no balance; pulls = floor(usdc)', async () => {
    expect((await api.me()).freePulls).toBe(0);
    expect(await api.balance()).toEqual({ usdc: 0, usdt: 0, pulls: 0 });
    api.dev.deposit(8.5);
    expect((await api.balance()).pulls).toBe(8);
  });

  test('a free pull is consumed first and needs no transfer', async () => {
    api.dev.creditFree(1);
    const prep = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    expect(prep.useFreePulls).toBe(1);
    expect(prep.costUsd).toBe(0);
    expect(prep.transfer).toBeUndefined();
    const res = await api.commitPull({ pullId: prep.pullId });
    expect(res.freePulls).toBe(0);
    expect(res.outcomes).toHaveLength(1);
  });

  test('a pull with no balance and no free pull is refused before anything is rolled', async () => {
    await expectCode(preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() }), 'INSUFFICIENT_FUNDS');
    expect((await api.holdings()).reduce((n, h) => n + h.qty, 0)).toBe(0);
  });
});

describe('charge point and payment', () => {
  test('the outcome is rolled at commit, not at prepare, and balance is charged at commit', async () => {
    api.dev.deposit(10);
    const prep = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    expect(prep.transfer).toMatchObject({ amount: 1_000_000, memo: prep.pullId });
    expect((await api.balance()).pulls).toBe(10); // nothing charged yet
    expect((await api.holdings()).reduce((n, h) => n + h.qty, 0)).toBe(0); // nothing allocated yet
    const res = await api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` });
    expect(res.balance?.pulls).toBe(9);
    expect(res.outcomes).toHaveLength(1);
  });

  test('commit is idempotent on pullId: the same pull never resolves twice', async () => {
    api.dev.deposit(5);
    const prep = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    const a = await api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` });
    const b = await api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` });
    expect(b).toEqual(a);
    expect((await api.balance()).pulls).toBe(4);
  });

  test('a transaction signature can never produce two pulls', async () => {
    api.dev.deposit(5);
    const p1 = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    await api.commitPull({ pullId: p1.pullId, txSignature: 'mock:sig-shared' });
    const p2 = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    await expectCode(api.commitPull({ pullId: p2.pullId, txSignature: 'mock:sig-shared' }), 'TX_MISMATCH');
    expect((await api.balance()).pulls).toBe(4); // the second pull took nothing
  });

  test('a paid commit without a confirmed payment is refused and allocates nothing', async () => {
    api.dev.deposit(5);
    const prep = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    await expectCode(api.commitPull({ pullId: prep.pullId }), 'TX_NOT_FOUND');
    await expectCode(api.commitPull({ pullId: prep.pullId, txSignature: 'not-on-chain' }), 'TX_NOT_FOUND');
    expect((await api.holdings()).reduce((n, h) => n + h.qty, 0)).toBe(0);
    expect((await api.balance()).pulls).toBe(5);
  });

  test('a prepared pull expires after 60 s', async () => {
    api.dev.deposit(5);
    const prep = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    clock += 61_000;
    await expectCode(api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` }), 'EXPIRED');
  });

  test('×5 and ×10 charge count × $1 and return count outcomes, no bundle discount', async () => {
    api.dev.deposit(20);
    const prep = await preparePull({ count: 10, targeted: false, asset: 'USDC', idem: idem() });
    expect(prep.costUsd).toBe(10);
    expect(prep.transfer?.amount).toBe(10_000_000);
    const res = await api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` });
    expect(res.outcomes).toHaveLength(10);
    expect(res.balance?.pulls).toBe(10);
  });
});

describe('inventory', () => {
  test('never allocates a card beyond stock: with one copy left it is drawn once, then the odds skip it', async () => {
    api.dev.deposit(200);
    const album = ALBUMS[0];
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    api.dev.setStock(album.cards[0].id, 1);
    api.dev.forceTier('common');
    const first = await pull();
    expect(first.outcomes[0].cardId).toBe(album.cards[0].id);
    await expectCode(pull(), 'RESTOCKING');
    expect((await api.availability(album.id))[album.cards[0].id]).toBe(0);
  });

  test('a duplicate common becomes an extra; 5 extras burn into one free pull and go back to the vault', async () => {
    api.dev.deposit(100);
    api.dev.forceTier('common');
    // Restrict to one card so every pull after the first is a dupe.
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    const only = ALBUMS[0].cards[3].id;
    api.dev.setStock(only, 40);
    let res = await pull(); expect(res.outcomes[0].isDupe).toBe(false); expect(res.extras).toBe(0);
    for (let i = 0; i < BURN_COST; i++) res = await pull();
    expect(res.outcomes[0].isDupe).toBe(true);
    expect(res.extras).toBe(BURN_COST);
    expect((await api.availability('A'))[only]).toBe(40 - 6);
    const beforeFree = (await api.me()).freePulls;
    const burn = await api.burn({ idem: idem() });
    expect(burn).not.toHaveProperty('outcomes');
    expect(burn).not.toHaveProperty('pullId');
    expect(burn.freePulls).toBe(beforeFree + 1);
    expect(burn.extras).toBe(0); // five returned, and the burn draws no card
    expect((await api.availability('A'))[only]).toBe(40 - 6 + BURN_COST);
    await expectCode(api.burn({ idem: idem() }), 'UNKNOWN');
  });

  test('a burn sent again with the same key is answered with that burn and burns nothing more', async () => {
    api.dev.deposit(100);
    api.dev.forceTier('common');
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    const only = ALBUMS[0].cards[3].id;
    api.dev.setStock(only, 40);
    for (let i = 0; i <= 2 * BURN_COST; i++) await pull(); // ten extras: enough for a second burn, were it one
    const key = idem();
    const first = await api.burn({ idem: key });
    const after = { state: api.dev.state(), stock: (await api.availability('A'))[only] };
    expect(await api.burn({ idem: key })).toEqual(first);
    expect({ state: api.dev.state(), stock: (await api.availability('A'))[only] }).toEqual(after);
    const second = await api.burn({ idem: idem() });
    expect(second.freePulls).toBe(first.freePulls + 1); // a new key is a second credit
    expect(second.extras).toBe(first.extras - BURN_COST);
  });

  test('a targeted pull draws any in-stock card in the album, including one already held', async () => {
    api.dev.deposit(40);
    api.dev.forceTier('common');
    const album = ALBUMS[1];
    const [owned, fresh] = album.cards;
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    api.dev.setStock(owned.id, 5);
    const first = await pull(1, { targeted: true, albumId: album.id });
    expect(first.outcomes[0]).toMatchObject({ cardId: owned.id, isDupe: false, albumId: album.id });
    api.dev.setStock(owned.id, null);
    api.dev.setStock(fresh.id, null);
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) seen.add((await pull(1, { targeted: true, albumId: album.id })).outcomes[0].cardId);
    expect(seen.has(owned.id)).toBe(true);
    expect(seen.has(fresh.id)).toBe(true);
  });

  test('a targeted pull still draws after every card in the album is already held', async () => {
    api.dev.deposit(50);
    api.dev.forceTier('common');
    const album = ALBUMS[0];
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    for (const c of album.cards) {
      for (const other of album.cards) api.dev.setStock(other.id, other.id === c.id ? 1 : 0);
      await pull(1, { targeted: true, albumId: album.id });
    }
    for (const c of album.cards) api.dev.setStock(c.id, 3);
    const again = await pull(1, { targeted: true, albumId: album.id });
    expect(again.outcomes[0].isDupe).toBe(true);
    expect(again.outcomes[0].albumId).toBe(album.id);
    expect(again.albumCompleted).toBeUndefined();
  });

  test('targeted pulls cost the album rate times the count and do not spend free pulls', async () => {
    api.dev.deposit(5);
    api.dev.creditFree(2);
    const one = await preparePull({ count: 1, targeted: true, albumId: 'A', asset: 'USDC', idem: idem() });
    expect(one).toMatchObject({ costUsd: 1.5, useFreePulls: 0 });
    await expectCode(preparePull({ count: 5, targeted: true, albumId: 'A', asset: 'USDC', idem: idem() }), 'INSUFFICIENT_FUNDS');
    expect((await api.me()).freePulls).toBe(2);
    api.dev.deposit(15);
    const five = await preparePull({ count: 5, targeted: true, albumId: 'A', asset: 'USDC', idem: idem() });
    expect(five).toMatchObject({ costUsd: 7.5, useFreePulls: 0 });
    const ten = await preparePull({ count: 10, targeted: true, albumId: 'A', asset: 'USDC', idem: idem() });
    expect(ten).toMatchObject({ costUsd: 15, useFreePulls: 0 });
    expect((await api.me()).freePulls).toBe(2);
  });

  test('a targeted ×5 charges 5 × $1.50 and draws five cards from that album, duplicates included', async () => {
    api.dev.deposit(20);
    api.dev.creditFree(2);
    api.dev.forceTier('common');
    const album = ALBUMS[0];
    const only = album.cards[0];
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    api.dev.setStock(only.id, null);
    const res = await pull(5, { targeted: true, albumId: album.id });
    expect(res.outcomes).toHaveLength(5);
    expect(res.outcomes.every((outcome) => outcome.albumId === album.id && outcome.cardId === only.id)).toBe(true);
    expect(res.outcomes.filter((outcome) => outcome.isDupe)).toHaveLength(4);
    expect(res.ticketsEarned).toBe(5);
    expect((await api.balance()).usdc).toBe(12_500_000);
    expect((await api.me()).freePulls).toBe(2);
  });
});

describe('completion', () => {
  test('completing an album records one Jupiter gift, once', async () => {
    api.dev.deposit(100);
    api.dev.forceTier('common');
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    for (const c of ALBUMS[0].cards) api.dev.setStock(c.id, 1);
    let completedAt: string | undefined;
    for (let i = 0; i < ALBUM_SIZE; i++) { const r = await pull(); completedAt = r.albumCompleted ?? completedAt; }
    expect(completedAt).toBe('A');
    const key = idem();
    const reward = await api.claimCompletion({ albumId: 'A', idem: key });
    expect(await api.claimCompletion({ albumId: 'A', idem: key })).toEqual(reward);
    expect(reward.outcomes).toEqual([]);
    expect(reward.gift).toMatchObject({ status: 'confirmed', packType: 'degen_100', count: 1, receiver: DEMO_WALLET, openUrl: 'https://jup.ag/gacha' });
    expect(await api.claimCompletion({ albumId: 'A', idem: idem() })).toEqual(reward);
    expect((await api.holdings()).some((holding) => holding.rarity === 'holo')).toBe(false);
    await expectCode(api.claimCompletion({ albumId: 'B', idem: idem() }), 'UNKNOWN');
  });

});

describe('money safety (review round 1)', () => {
  test('a ×5 that runs out of stock mid-batch charges nothing, allocates nothing, and the same pullId can be retried', async () => {
    api.dev.deposit(20);
    api.dev.forceTier('common');
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    api.dev.setStock(ALBUMS[0].cards[0].id, 2);
    const prep = await preparePull({ count: 5, targeted: false, asset: 'USDC', idem: idem() });
    await expectCode(api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` }), 'RESTOCKING');
    expect((await api.balance()).pulls).toBe(20);
    expect((await api.holdings()).reduce((n, h) => n + h.qty, 0)).toBe(0);
    expect((await api.availability('A'))[ALBUMS[0].cards[0].id]).toBe(2);
    for (const c of ALBUMS[0].cards) api.dev.setStock(c.id, 5);
    const res = await api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` });
    expect(res.outcomes).toHaveLength(5);
    expect(res.balance?.pulls).toBe(15);
  });

  test('free pulls are reserved at prepare: a fourth prepare against three free pulls needs money', async () => {
    api.dev.creditFree(3);
    const preps = [];
    for (let i = 0; i < 3; i++) preps.push(await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() }));
    // each new prepare supersedes the previous un-committed one and hands its free pull back
    expect(preps.map((p) => p.useFreePulls)).toEqual([1, 1, 1]);
    await api.commitPull({ pullId: preps[2].pullId });
    await expectCode(api.commitPull({ pullId: preps[0].pullId }), 'EXPIRED');
    api.dev.deposit(3);
    const p4 = await preparePull({ count: 5, targeted: false, asset: 'USDC', idem: idem() });
    expect(p4.useFreePulls).toBe(2); // 3 free pulls − 1 already committed; the superseded prepares gave theirs back
    expect(p4.costUsd).toBe(3);
    const res = await api.commitPull({ pullId: p4.pullId, txSignature: `mock:${p4.pullId}` });
    expect(res.freePulls).toBe(0);
    expect(res.balance?.pulls).toBe(0);
    await expectCode(preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() }), 'INSUFFICIENT_FUNDS');
    expect((await api.holdings()).reduce((n, h) => n + h.qty, 0)).toBe(6);
  });

  test('a targeted pull against an album that is not open is refused at prepare, before any charge', async () => {
    api.dev.deposit(5);
    await expectCode(preparePull({ count: 1, targeted: true, albumId: 'soon-1', asset: 'USDC', idem: idem() }), 'RESTOCKING');
    await expectCode(preparePull({ count: 1, targeted: true, albumId: 'nope', asset: 'USDC', idem: idem() }), 'UNKNOWN');
    expect((await api.balance()).pulls).toBe(5);
  });
});

describe('money safety (review round 2)', () => {
  test('hand off the crank: an abandoned prepare gives its free pull back after it expires, and the next pull is still free', async () => {
    api.dev.creditFree(3);
    const p1 = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    expect(p1.useFreePulls).toBe(1);
    clock += 120_000;
    expect((await api.me()).freePulls).toBe(3);
    api.dev.deposit(2);
    const p2 = await preparePull({ count: 5, targeted: false, asset: 'USDC', idem: idem() });
    expect(p2.useFreePulls).toBe(3);
    expect(p2.costUsd).toBe(2);
    await expectCode(api.commitPull({ pullId: p1.pullId }), 'EXPIRED');
    expect((await api.me()).freePulls).toBe(0); // reserved by p2, not lost
  });

  test('a burn credits a free pull when every vault is empty, and draws no card', async () => {
    api.dev.deposit(100);
    api.dev.forceTier('common');
    for (const a of ALBUMS) for (const c of a.cards) api.dev.setStock(c.id, 0);
    const only = ALBUMS[0].cards[3].id;
    api.dev.setStock(only, 6);
    for (let i = 0; i < 6; i++) await pull();
    expect((await api.extras()).count).toBe(5);
    expect((await api.availability('A'))[only]).toBe(0);
    api.dev.setStock('pool:graded', 0);
    const before = (await api.holdings()).find((h) => h.cardId === only)?.qty;
    const freeBefore = (await api.me()).freePulls;
    const res = await api.burn({ idem: idem() });
    expect(res).not.toHaveProperty('outcomes');
    expect(res.freePulls).toBe(freeBefore + 1);
    expect(res.extras).toBe(0);
    expect((await api.holdings()).find((h) => h.cardId === only)?.qty).toBe((before ?? 0) - 5);
    expect((await api.availability('A'))[only]).toBe(5); // five returned, nothing drawn
  });
});

describe('odds and errors', () => {
  test('published odds are album commons only and sum to 1', async () => {
    const o = await api.odds(INVENTORY_GACHA_ID);
    expect(o.paid.rows).toEqual([{ tier: 'common', label: 'Album card', pct: 1, valueUsd: 0.05 }]);
    expect(o.paid.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(1, 10);
    expect(o.paid.evPct).toBeCloseTo(0.05, 10);
    expect(o.free.rows).toEqual([expect.objectContaining({ tier: 'common', pct: 1 })]);
    expect([...o.paid.rows, ...o.free.rows].some((r) => r.tier !== 'common')).toBe(false);
  });

  test('errors carry the contract code', async () => {
    try { await api.availability('nope'); } catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).code).toBe('UNKNOWN'); }
  });
});

describe('holdings carry the card behind them (contract addition for the binder, F3.2)', () => {
  test('a rare holding reports its card and rarity; an album common reports common', async () => {
    api.dev.deposit(5);
    api.dev.forceTier('holo');
    const rare = await pull();
    const h = (await api.holdings()).find((x) => x.cardId === rare.outcomes[0].cardId);
    expect(h?.rarity).toBe('holo');
    expect(h?.card?.name).toBe(rare.outcomes[0].card.name);
    api.dev.forceTier('common');
    const common = await pull();
    const hc = (await api.holdings()).find((x) => x.cardId === common.outcomes[0].cardId);
    expect(hc?.rarity).toBe('common');
    expect(hc?.card?.imgSmall).toBe(common.outcomes[0].card.imgSmall);
  });
});

describe('holdings are one line per (cardId, rarity); dev.withdraw is idempotent', () => {
  test('a rare line carries its own rarity and serials, separate from any common line', async () => {
    api.dev.deposit(5);
    api.dev.forceTier('ultra');
    const r = await pull();
    api.dev.forceTier('graded');
    const g = await pull();
    const lines = await api.holdings();
    expect(lines.filter((h) => h.rarity === 'ultra')).toHaveLength(1);
    expect(lines.filter((h) => h.rarity === 'graded')).toHaveLength(1);
    expect(lines.find((h) => h.rarity === 'graded')?.serials?.[0]).toBe(g.outcomes[0].serial);
    expect(lines.find((h) => h.rarity === 'ultra')?.serials?.[0]).toBe(r.outcomes[0].serial);
    expect(lines.every((h) => h.card && h.rarity)).toBe(true);
  });

  test('the same withdraw intent debits once', async () => {
    api.dev.deposit(10);
    api.dev.withdraw(2.5, 'wd-1');
    api.dev.withdraw(2.5, 'wd-1');
    expect((await api.balance()).usdc).toBe(7_500_000);
    api.dev.withdraw(2.5, 'wd-2');
    expect((await api.balance()).usdc).toBe(5_000_000);
    expect(() => api.dev.withdraw(50, 'wd-3')).toThrow(ApiError);
  });
});

describe('season raffle tickets', () => {
  test('a paid slot earns one ticket; a free pull, a burn and a partner claim earn none', async () => {
    expect((await api.season()).myTickets).toBe(0);
    api.dev.forceTier('common');
    for (const album of ALBUMS) for (const card of album.cards) api.dev.setStock(card.id, 0);
    api.dev.setStock(ALBUMS[0].cards[0].id, 80);
    api.dev.deposit(40);

    // Targeted is one paid slot ($1.50) and one ticket, before any free pull is involved.
    const targeted = await pull(1, { targeted: true, albumId: ALBUMS[0].id });
    expect(targeted).toMatchObject({ ticketsEarned: 1, myTickets: 1 });

    api.dev.creditFree(1);
    expect(await pull(1)).toMatchObject({ ticketsEarned: 0, myTickets: 1 });
    expect(await pull(1)).toMatchObject({ ticketsEarned: 1, myTickets: 2 });
    expect(await pull(5)).toMatchObject({ ticketsEarned: 5, myTickets: 7 });
    const ten = await pull(10);
    expect(ten).toMatchObject({ ticketsEarned: 10, myTickets: 17 });
    // The same pull again is the stored grant, not a second one.
    const replayPrep = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    const replay = await api.commitPull({ pullId: replayPrep.pullId, txSignature: `mock:${replayPrep.pullId}` });
    expect(replay.ticketsEarned).toBe(1);
    expect(await api.commitPull({ pullId: replayPrep.pullId, txSignature: `mock:${replayPrep.pullId}` })).toMatchObject({ ticketsEarned: 1, myTickets: replay.myTickets });

    api.dev.creditFree(2);
    const mixed = await preparePull({ count: 5, targeted: false, asset: 'USDC', idem: idem() });
    expect(mixed).toMatchObject({ useFreePulls: 2, costUsd: 3 });
    expect(await api.commitPull({ pullId: mixed.pullId, txSignature: `mock:${mixed.pullId}` })).toMatchObject({ ticketsEarned: 3, myTickets: replay.myTickets + 3 });

    const beforeBurn = (await api.season()).myTickets;
    expect((await api.burn({ idem: idem() })).freePulls).toBeGreaterThan(0);
    expect((await api.season()).myTickets).toBe(beforeBurn);
    expect(await pull(1)).toMatchObject({ ticketsEarned: 0, myTickets: beforeBurn });

    await expectCode(api.claimCompletion({ albumId: ALBUMS[0].id, idem: idem() }), 'UNKNOWN');
    expect((await api.season()).myTickets).toBe(beforeBurn);
  });
});

describe('paid streak', () => {
  test('one paid pull a day advances by one; a later pull the same day, and ×5 or ×10, do not', async () => {
    api.dev.deposit(40);
    expect((await api.season()).streak).toEqual({ count: 0, countedToday: false });
    expect(await pull(1)).toMatchObject({ ticketsEarned: 1, myTickets: 1 });
    expect((await api.season()).streak).toEqual({ count: 1, countedToday: true });
    expect(await pull(1)).toMatchObject({ ticketsEarned: 1, myTickets: 2 });
    expect((await api.season()).streak).toEqual({ count: 1, countedToday: true });
    clock += 24 * 3.6e6;
    expect(await pull(5)).toMatchObject({ ticketsEarned: 5, myTickets: 7 });
    expect((await api.season()).streak).toEqual({ count: 2, countedToday: true });
    expect(await pull(10)).toMatchObject({ ticketsEarned: 10, myTickets: 17 });
    expect((await api.season()).streak).toEqual({ count: 2, countedToday: true });
  });

  test('a missed day reads as 0 and the next paid pull starts at 1', async () => {
    api.dev.deposit(5);
    await pull(1);
    clock += 48 * 3.6e6;
    expect((await api.season()).streak).toEqual({ count: 0, countedToday: false });
    expect(await pull(1)).toMatchObject({ ticketsEarned: 1, myTickets: 2 });
    expect((await api.season()).streak).toEqual({ count: 1, countedToday: true });
  });

  test('day 5 grants two tickets once, stores 0, and a replay does not grant again', async () => {
    api.dev.deposit(10);
    for (let day = 1; day <= 4; day++) {
      expect(await pull(1)).toMatchObject({ ticketsEarned: 1, myTickets: day });
      expect((await api.season()).streak).toEqual({ count: day, countedToday: true });
      clock += 24 * 3.6e6;
    }
    const prep = await preparePull({ count: 1, targeted: false, asset: 'USDC', idem: idem() });
    const hit = await api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` });
    expect(hit).toMatchObject({ ticketsEarned: 1, streakBonus: 2, myTickets: 7, streak: { count: 0, countedToday: true } });
    expect((await api.season()).streak).toEqual({ count: 0, countedToday: true });
    expect(await api.streak()).toMatchObject({ count: 0, countedToday: true, bonusJustEarned: true });
    expect(await api.commitPull({ pullId: prep.pullId, txSignature: `mock:${prep.pullId}` })).toEqual(hit);
    expect(await pull(1)).toMatchObject({ ticketsEarned: 1, streakBonus: 0, myTickets: 8 });
    expect((await api.season()).streak).toEqual({ count: 0, countedToday: true });
    expect(await api.streak()).toMatchObject({ bonusJustEarned: true, count: 0, countedToday: true });
  });

  test('four $1 days then a ×10 on day 5 grants +2 once', async () => {
    api.dev.deposit(40);
    for (let day = 1; day <= 4; day++) {
      await pull(1);
      clock += 24 * 3.6e6;
    }
    expect(await pull(10)).toMatchObject({ ticketsEarned: 10, streakBonus: 2, myTickets: 16 });
    expect(await pull(10)).toMatchObject({ ticketsEarned: 10, streakBonus: 0, myTickets: 26 });
    expect(await api.streak()).toMatchObject({ count: 0, countedToday: true, bonusJustEarned: true });
  });

  test('a free pull, a burn, and a completion claim do not advance the streak', async () => {
    api.dev.deposit(50);
    api.dev.forceTier('common');
    for (const album of ALBUMS) for (const card of album.cards) api.dev.setStock(card.id, 0);
    const held = ALBUMS[0].cards[0].id;
    api.dev.setStock(held, 20);

    api.dev.creditFree(1);
    expect(await pull(1)).toMatchObject({ ticketsEarned: 0, myTickets: 0 });
    expect((await api.season()).streak).toEqual({ count: 0, countedToday: false });

    for (let i = 0; i < 6; i++) await pull(1);
    expect((await api.season()).myTickets).toBe(6);
    expect((await api.season()).streak).toEqual({ count: 1, countedToday: true });
    expect((await api.burn({ idem: idem() })).freePulls).toBeGreaterThan(0);
    expect(await pull(1)).toMatchObject({ ticketsEarned: 0, myTickets: 6 });
    expect((await api.season()).streak).toEqual({ count: 1, countedToday: true });

    api.dev.setStock(held, 0);
    for (const card of ALBUMS[0].cards) if (card.id !== held) api.dev.setStock(card.id, 1);
    let completed = false;
    for (let i = 0; i < ALBUM_SIZE && !completed; i++) {
      const res = await pull(1);
      if (res.albumCompleted === 'A') completed = true;
    }
    expect(completed).toBe(true);
    const beforeClaim = (await api.season()).myTickets;
    expect((await api.claimCompletion({ albumId: 'A', idem: idem() })).gift).toMatchObject({ status: 'confirmed', packType: 'degen_100' });
    expect((await api.season()).myTickets).toBe(beforeClaim);
    expect((await api.season()).streak).toEqual({ count: 1, countedToday: true });
  });
});
