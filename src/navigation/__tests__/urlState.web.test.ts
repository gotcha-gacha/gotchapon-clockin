// The address ↔ state arithmetic of W2.1 (#128): what an address names, what a state is written as, which addresses are a
// sheet's. Pure functions; the router itself is proven in a browser (the PR).
import { expect, test } from '@jest/globals';
import { cardOf, isSheetRoute, pathForState, stateFromPath } from '../useUrlState.web';
import { PAGE } from '@/state/session';

const albums = [{ id: 'A', cards: [{ id: 'sv1-1' }, { id: 'sv1-2' }] }, { id: 'B', cards: [{ id: 'sv2-9' }] }];

test('page paths: /, /pull, unknown → Pull; /binder and /binder/:id → Albums, the binder open only for an album that exists; /wallet and /wallet/deposit → Wallet', () => {
  for (const p of ['/pull', '/pull/', '/odds']) expect(stateFromPath({ pathname: p }, albums)).toEqual({ page: PAGE.pull, album: null });
  for (const p of ['/', '/nope', '/nope/deeper']) expect(stateFromPath({ pathname: p }, albums)).toEqual({ page: PAGE.albums, album: null }); // the landing page is the Binder (#210)
  expect(stateFromPath({ pathname: '/binder' }, albums)).toEqual({ page: PAGE.albums, album: null });
  expect(stateFromPath({ pathname: '/binder/B' }, albums)).toEqual({ page: PAGE.albums, album: 'B' });
  expect(stateFromPath({ pathname: '/binder/nope' }, albums)).toEqual({ page: PAGE.albums, album: null });
  expect(stateFromPath({ pathname: '/binder/B/' }, albums)).toEqual({ page: PAGE.albums, album: 'B' }); // a trailing slash is nothing
  for (const p of ['/wallet', '/wallet/deposit']) expect(stateFromPath({ pathname: p }, albums)).toEqual({ page: PAGE.wallet, album: null });
});

test('a card address names the binder that holds the card, and waits for the albums to be known', () => {
  expect(stateFromPath({ pathname: '/card/sv2-9' }, [])).toBeNull(); // not yet: the albums come after sign-in
  expect(stateFromPath({ pathname: '/card/sv2-9' }, albums)).toEqual({ page: PAGE.albums, album: 'B' });
  expect(stateFromPath({ pathname: '/card/sv1-2', tier: 'holo' }, albums)).toEqual({ page: PAGE.albums, album: 'A' }); // a rare on the shelf: still its album
  expect(stateFromPath({ pathname: '/card/nope' }, albums)).toEqual({ page: PAGE.albums, album: null }); // a card nobody has: the grid
  // A rebuilt page (browser Forward) lands the app's route on `/?cardId=…`: the same card.
  expect(stateFromPath({ pathname: '/', cardId: 'sv2-9' }, albums)).toEqual({ page: PAGE.albums, album: 'B' });
  expect(cardOf({ pathname: '/card/sv2-9', tier: 'ultra' })).toEqual({ cardId: 'sv2-9', tier: 'ultra' });
  expect(cardOf({ pathname: '/binder', cardId: 'sv2-9' })).toEqual({ cardId: 'sv2-9', tier: undefined });
  expect(cardOf({ pathname: '/binder/A' })).toBeNull();
});

test('state is written as /pull, /binder, /binder/:id, /wallet', () => {
  expect(pathForState({ page: PAGE.pull, album: null })).toEqual(['pull']);
  expect(pathForState({ page: PAGE.albums, album: null })).toEqual(['binder']);
  expect(pathForState({ page: PAGE.albums, album: 'A' })).toEqual(['binder', 'A']);
  expect(pathForState({ page: PAGE.wallet, album: 'A' })).toEqual(['wallet']); // an open binder is not on the Wallet page's address
});

test('a sheet is on top when the router\'s focused route is one of the two sheet routes, and only then', () => {
  expect(isSheetRoute(['odds'])).toBe(true);
  expect(isSheetRoute(['card', '[cardId]'])).toBe(true);
  // The catch-all answers every page address, `/card`, `/odds/x` and `/%6Fdds` included; and a route nobody is on is no sheet.
  for (const seg of [['[...path]'], ['+not-found'], ['_sitemap'], []]) expect([seg, isSheetRoute(seg)]).toEqual([seg, false]);
});

// PR #165's third review: the sheet addresses are exactly `/card/:id` and `/odds`, everywhere they are read.
test('a card address is exactly /card/:id: deeper paths are not a card', () => {
  expect(cardOf({ pathname: '/card/sv2-9/extra' })).toBeNull();
  expect(cardOf({ pathname: '/card' })).toBeNull();
  expect(stateFromPath({ pathname: '/card/sv2-9/extra' }, albums)).toEqual({ page: PAGE.albums, album: null }); // not a card address: the landing page
});
