// Which addresses are the app's, and the tab's titles (W2.2, #129).
import { expect, test } from '@jest/globals';
import { isAppPath, ownSegments, pageTitle, segmentsOf, SITE, SITE_DESCRIPTION, titled } from '../appPaths';
import { PAGE } from '@/state/session';

const known = (p: string) => isAppPath(segmentsOf(p));

test('the app answers its own page addresses, trailing slash, encoding and any album id included', () => {
  for (const p of ['/', '', '/pull', '/pull/', '/binder', '/binder/A', '/binder/little-lanterns', '/binder/Little%20Lanterns', '/wallet', '/wallet/deposit', '/wallet/deposit/']) expect([p, known(p)]).toEqual([p, true]);
});

test('anything else is not found: a deeper path, a sibling that is not a page, the wrong case, the sheet routes spelled wrong', () => {
  for (const p of ['/nope', '/nope/deeper', '/pull/extra', '/binder/A/x', '/wallet/withdraw', '/wallet/deposit/x', '/Pull', '/CARD/x', '/card', '/odds/x', '/_sitemap', '/index']) expect([p, known(p)]).toEqual([p, false]);
});

test('the route param arrives as an array, a string or nothing; a malformed escape does not throw', () => {
  expect(segmentsOf(undefined)).toEqual([]);
  expect(segmentsOf(['binder', 'A'])).toEqual(['binder', 'A']);
  expect(segmentsOf('binder/A')).toEqual(['binder', 'A']);
  expect(segmentsOf(['binder', 'Little%20Lanterns'])).toEqual(['binder', 'Little Lanterns']);
  expect(segmentsOf(['binder', '%E0%A4%A'])).toEqual(['binder', '%E0%A4%A']);
});

test('titles: the site alone before sign-in; then the page, or the open album; the site name last', () => {
  expect(titled()).toBe(SITE);
  expect(titled('Odds')).toBe('Odds · Gotchapon');
  for (const page of [PAGE.albums, PAGE.pull, PAGE.wallet]) expect(pageTitle({ signedIn: false, page, albumTitle: 'Little Lanterns' })).toBe('Gotchapon');
  expect(pageTitle({ signedIn: true, page: PAGE.pull })).toBe('Pull · Gotchapon');
  expect(pageTitle({ signedIn: true, page: PAGE.wallet, albumTitle: 'Little Lanterns' })).toBe('Wallet · Gotchapon');
  expect(pageTitle({ signedIn: true, page: PAGE.albums })).toBe('Albums · Gotchapon');
  expect(pageTitle({ signedIn: true, page: PAGE.albums, albumTitle: 'Little Lanterns' })).toBe('Little Lanterns · Gotchapon');
});

test('the description is the shell headline and makes no claim the copy rules forbid', () => {
  expect(SITE_DESCRIPTION).toBe('Everyone\u2019s chasing grails. Finish a binder instead.');
  expect(SITE_DESCRIPTION).not.toMatch(/audit|counted|weekly|quarterly|ship home|18\+|nft|token|mint|on-chain|solana|crypto|pocket ?binder|free pull|dupes?|duplicates/i);
});

// W2.2's review: expo-router copies a query key into the route's params when the route has none of that name.
test('the catch-all\'s own path: an array, and nothing at the site root, whatever a query named path says', () => {
  expect(ownSegments(['binder', 'A'], '/binder/A')).toEqual(['binder', 'A']);
  expect(ownSegments(['nope'], '/nope')).toEqual(['nope']);
  expect(ownSegments('nope', '/')).toEqual([]); // `/?path=nope`: a string is never the route's own
  expect(ownSegments(['binder', 'A', 'x'], '/')).toEqual([]); // `/?path=binder&path=A&path=x`: at the root it has none
  expect(ownSegments(undefined, '/odds')).toEqual([]); // the app beneath a cold `/odds`
  expect(ownSegments('pull', '/nope')).toEqual([]); // cannot happen (the route's own wins); a string is still not trusted
});
