// Ticker content (F5.5): the design's interleave, vault facts from the API (never invented), the user's own session.
import { expect, test } from '@jest/globals';
import type { Holding, Odds, Outcome } from '@/api/contract';
import { ALBUMS, PAID_ODDS } from '@/api/mock/fixtures';
import { oddsFacts, TICKER_SEP, sessionFacts, tickerText } from '@/components/machine/ticker';

const card = (id: string, name: string) => ({ id, name, set: 'SV', number: '1', imgSmall: 'u', imgLarge: 'u' });

test('one of each in turn, ending in a separator', () => {
  expect(tickerText(['v1', 'v2', 'v3'], ['y1'], ['s1', 's2'])).toBe(['v1', 'y1', 's1', 'v2', 's2', 'v3'].join(TICKER_SEP) + TICKER_SEP);
  expect(tickerText(['v1'], [])).toBe(`v1${TICKER_SEP}`);
});

test('marquee odds come from the published paid table', () => {
  const odds = { paid: { rows: PAID_ODDS } } as Odds;
  expect(oddsFacts(odds)).toEqual(['Album card: 100.0%']);
  expect(oddsFacts(null)).toEqual([]); // #332: no "tap for pull odds" while the sleeve is hidden
});

test("the user's session: last two pulls, the album closest to complete, cards held", () => {
  const [a, b, c] = ALBUMS[0].cards;
  const recent = [{ cardId: a.id, rarity: 'common', isDupe: false, card: card(a.id, 'Tadbulb') }, { cardId: b.id, rarity: 'common', isDupe: true, card: card(b.id, 'Mareep') }] as Outcome[];
  const holdings: Record<string, Holding> = { [a.id]: { cardId: a.id, qty: 2 }, [b.id]: { cardId: b.id, qty: 1 }, [c.id]: { cardId: c.id, qty: 1 } };
  expect(sessionFacts(recent, holdings, ALBUMS)).toEqual(['you pulled Tadbulb · before that Mareep', `22 missing in ${ALBUMS[0].title}`, '4 cards held by you']);
  expect(sessionFacts([], {}, ALBUMS)).toEqual([]);
  expect(sessionFacts(recent, holdings, ALBUMS, ALBUMS[0].id)).toEqual([
    'you pulled Tadbulb · before that Mareep',
    `3 of ${ALBUMS[0].size} in ${ALBUMS[0].title}`,
    '4 cards held by you',
  ]);
  expect(sessionFacts([], holdings, ALBUMS, ALBUMS[1].id)).toEqual(['4 cards held by you']);
  expect(sessionFacts([], {}, ALBUMS, ALBUMS[1].id)).toEqual([]);
});
