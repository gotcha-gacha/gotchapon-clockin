// The in-app mock draws paid and free pulls from the locked 75, and album stock does not move (#313).
import { beforeEach, describe, expect, test } from '@jest/globals';
import { createMockApi, type MockApi } from './index';
import { ALBUMS, INFINITE_ALBUM_COPIES, POOLS } from './fixtures';
import { INVENTORY_GACHA_ID, type PullCommitResponse, type PullPrepareRequest } from '../contract';

let api: MockApi;
const idem = (() => { let n = 0; return () => `v0-${++n}`; })();
const live = ALBUMS.filter((album) => album.status === 'live');
const albumIds = new Set(live.flatMap((album) => album.cards.map((card) => card.id)));
const rarePoolIds = new Set([...POOLS.reverse, ...POOLS.holo, ...POOLS.ultra].map((card) => card.id));

function preparePull(req: Omit<PullPrepareRequest, 'gachaId'> & { gachaId?: string }) {
  const gachaId = req.gachaId ?? (req.albumId ? `album:${req.albumId}` : INVENTORY_GACHA_ID);
  return api.preparePull({ ...req, gachaId });
}

async function pull(count: 1 | 5 | 10 = 1): Promise<PullCommitResponse> {
  const prep = await preparePull({ count, targeted: false, asset: 'USDC', idem: idem() });
  return api.commitPull({ pullId: prep.pullId, txSignature: prep.transfer ? `mock:${prep.pullId}` : undefined });
}

beforeEach(() => { api = createMockApi({ latencyMs: 0, now: () => Date.parse('2026-09-10T04:00:00Z'), seed: 'v0-catalog' }); });

test('the mock albums are the locked 75, with C5 Rolycoly and C15 Wimpod, and exclusive names', () => {
  expect(live.map((album) => album.id)).toEqual(['A', 'B', 'C']);
  expect(albumIds.size).toBe(75);
  expect(live.reduce((sum, album) => sum + album.cards.length, 0)).toBe(75);
  const names = live.flatMap((album) => album.cards.map((card) => card.name));
  expect(new Set(names).size).toBe(75);
  const card = (albumId: string, slot: number) => live.find((album) => album.id === albumId)!.cards.find((row) => row.slot === slot)!;
  expect(card('C', 5)).toMatchObject({ id: 'sv5-93', name: 'Rolycoly' });
  expect(card('C', 15)).toMatchObject({ id: 'sv4-47', name: 'Wimpod' });
  expect(card('A', 20)).toMatchObject({ id: 'sv6-83', name: 'Girafarig' });
  expect(card('B', 7)).toMatchObject({ id: 'sv3-9', name: 'Foongus' });
  expect(albumIds.has('sv5-66')).toBe(false);
  expect(albumIds.has('sv9-10')).toBe(false);
});

describe('pulls stay on the 75 and album stock does not move', () => {
  test('paid pulls and a credited free pull never leave the album table', async () => {
    api.dev.deposit(30);
    const before = {
      A: await api.availability('A'),
      B: await api.availability('B'),
      C: await api.availability('C'),
    };
    for (const albumId of ['A', 'B', 'C'] as const) {
      expect(Object.values(before[albumId]).every((copies) => copies === INFINITE_ALBUM_COPIES)).toBe(true);
    }
    const outcomes = [];
    for (let i = 0; i < 8; i++) outcomes.push(...(await pull()).outcomes);
    api.dev.creditFree(1);
    outcomes.push(...(await pull()).outcomes);
    expect(outcomes.length).toBeGreaterThan(8);
    for (const outcome of outcomes) {
      expect(outcome.rarity).toBe('common');
      expect(albumIds.has(outcome.cardId)).toBe(true);
      expect(rarePoolIds.has(outcome.cardId)).toBe(false);
    }
    expect(await api.availability('A')).toEqual(before.A);
    expect(await api.availability('B')).toEqual(before.B);
    expect(await api.availability('C')).toEqual(before.C);
    const stock = (await api.odds(INVENTORY_GACHA_ID)).stock.perAlbum;
    for (const album of live) expect(stock[album.id]).toEqual({ live: album.cards.length, total: album.cards.length });
  });

  test('a burn of album extras credits a free pull and does not create a vault count', async () => {
    api.dev.deposit(20);
    const only = live[0].cards[0].id;
    // Pin the card with a finite override, then drop every override and prove the infinite path.
    api.dev.setStock(only, 20);
    for (const album of live) for (const card of album.cards) if (card.id !== only) api.dev.setStock(card.id, 0);
    for (let i = 0; i < 6; i++) await pull();
    for (const album of live) for (const card of album.cards) api.dev.setStock(card.id, null);
    const before = await api.availability('A');
    const beforeFree = (await api.me()).freePulls;
    const burn = await api.burn({ idem: idem() });
    expect(burn.freePulls).toBe(beforeFree + 1);
    expect(burn).not.toHaveProperty('outcomes');
    expect(await api.availability('A')).toEqual(before);
  });
});
