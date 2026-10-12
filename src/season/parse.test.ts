import { expect, test } from '@jest/globals';
import { createMockApi } from '@/api/mock';
import { parseSeason } from './parse';

test('the mock season body parses as five slabs and one grand', async () => {
  const body = parseSeason(await createMockApi({ latencyMs: 0 }).season());
  expect(body).toMatchObject({ id: 'season-one', title: 'Season One raffle', drawAt: '2026-11-30T16:00:00.000Z', myTickets: 0, streak: { count: 0, countedToday: false } });
  expect(body.prizes.map((prize) => [prize.slot, prize.cardId, prize.grade, prize.photo])).toEqual([
    ['grand', 'sv8-238', 'PSA 10', 'https://images.pokemontcg.io/sv8/238_hires.png'],
    ['mid', 'sv3-223', 'PSA 10', 'https://images.pokemontcg.io/sv3/223_hires.png'],
    ['mid', 'swsh7-218', 'PSA 10', 'https://images.pokemontcg.io/swsh7/218_hires.png'],
    ['mid', 'sv8-239', 'PSA 10', 'https://images.pokemontcg.io/sv8/239_hires.png'],
    ['mid', 'swsh11-180', 'PSA 10', 'https://images.pokemontcg.io/swsh11/180_hires.png'],
  ]);
  expect(body.prizes.every((prize) => !('valueUsd' in prize))).toBe(true);
  const leaked = parseSeason({
    ...body,
    prizes: body.prizes.map((prize) => ({ ...prize, valueUsd: 900 })),
  });
  expect(leaked.prizes.every((prize) => !('valueUsd' in prize))).toBe(true);
  expect(() => parseSeason({ ...body, prizes: body.prizes.slice(0, 4) })).toThrow(/prizes/);
  expect(() => parseSeason({ ...body, prizes: body.prizes.map((prize) => ({ ...prize, slot: 'mid' })) })).toThrow(/prizes/);
  expect(() => parseSeason({ ...body, myTickets: -1 })).toThrow(/myTickets/);
  expect(() => parseSeason({ ...body, streak: { count: 5, countedToday: true } })).toThrow(/streak/);
  expect(() => parseSeason({ ...body, streak: { count: 1, countedToday: 'yes' } })).toThrow(/streak/);
  expect(() => parseSeason({ ...body, drawAt: 'soon' })).toThrow(/drawAt/);
});
