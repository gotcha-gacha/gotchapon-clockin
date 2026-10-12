/**
 * "Get it on your phone" (W1.4, #126): the QR is of the page the visitor is on, query included, and it follows the URL when
 * the app changes it without a page load. The QR library is stood in for by something that shows the value it was given:
 * that value is what a phone reads. (A real scan of the real pixels is in the PR.)
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { PhoneCard, QR } from '../PhoneCard.web';
import { showNotFound } from '@/navigation/notFoundShown';
import { resetOAuthHandoffForTests } from '@/auth/oauthHandoff';

// One params object, as the real hook returns one per navigation state: a fresh object per call re-ran the card's effect on every
// render and hid a race (PR #179's review).
const mockParams = {};
jest.mock('expo-router', () => ({ usePathname: jest.fn(() => '/'), useGlobalSearchParams: jest.fn(() => mockParams) }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: ({ value, size }: { value: string; size: number }) => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'qr', 'data-size': size, 'data-value': value }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const qr = () => (host.querySelector('[data-testid="qr"]') as HTMLElement).dataset.value;
/** A macrotask: the card re-reads the address one after the router's change (PhoneCard.web.tsx). */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** The router, in the order the real one works (#169): its state changes and its hooks re-render the card FIRST; it writes the
 *  address afterwards (the real one queues the write in a promise series; an ancestor's effect is late enough to model it). */
function Router({ url, children }: { url: string; children: React.ReactNode }) {
  React.useEffect(() => { window.history.replaceState(null, '', url); }, [url]);
  return <>{children}</>;
}
/** What the router does on a swipe (W2.1): the address changes with no page load, and its hooks re-render whoever reads them. */
const routeTo = async (url: string) => {
  const u = new URL(url, window.location.origin);
  // The router's params: one object per navigation, a new one when the query changes (PR #179's second review: with the query
  // folded into the one stand-in object, a query-only change moved neither dependency and a test passed on a leftover timer).
  await act(async () => { jest.mocked(usePathname).mockReturnValue(u.pathname); jest.mocked(useGlobalSearchParams).mockReturnValue((u.search ? Object.fromEntries(u.searchParams) : mockParams) as never); root.render(<Router url={url}><PhoneCard /></Router>); });
  await settle();
};

beforeEach(async () => { resetOAuthHandoffForTests(); window.history.replaceState(null, '', '/'); jest.mocked(usePathname).mockReturnValue('/'); jest.mocked(useGlobalSearchParams).mockReturnValue(mockParams as never); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); await act(async () => { root.render(<Router url="/"><PhoneCard /></Router>); }); await settle(); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); resetOAuthHandoffForTests(); window.history.replaceState(null, '', '/'); });

test('the QR is the address in the address bar, query and all', async () => {
  expect(qr()).toBe(window.location.href);
  await routeTo('/binder/little-lanterns?ref=mei&replay=holo');
  expect(qr()).toBe(`${window.location.origin}/binder/little-lanterns?ref=mei&replay=holo`);
  expect(qr()).toBe(window.location.href);
});

test('the QR never carries Privy\'s OAuth return, and the bar is cleaned before it can be scanned', async () => {
  await routeTo('/pull?ref=mei&replay=holo&privy_oauth_code=abc&privy_oauth_state=s&privy_oauth_provider=google');
  expect(qr()).toBe(`${window.location.origin}/pull?ref=mei&replay=holo`);
  expect(window.location.href).not.toContain('privy_oauth');
  expect(window.location.href).toContain('ref=mei');
});

test('it follows the URL as the app changes it', async () => {
  await routeTo('/wallet');
  expect(qr()).toBe(`${window.location.origin}/wallet`);
  await routeTo('/pull');
  expect(qr()).toBe(`${window.location.origin}/pull`);
});

test('the store rows say soon and go nowhere; the scan line is Option A, with no install or starter free pull', () => {
  const card = host.querySelector('[data-testid="phone-card"]') as HTMLElement;
  expect(card.textContent).toContain('Get it on your phone');
  expect(card.textContent).toContain('Scan to play on your phone. \u00B7 App Store & Google Play \u00B7 soon');
  expect(card.textContent).not.toContain('Scan to open it there');
  const rows = [...card.querySelectorAll('[aria-disabled]')].map((el) => el.textContent);
  expect(rows).toEqual(['App Store \u00B7 soon', 'Google Play \u00B7 soon']);
  expect(card.querySelector('[role="img"]')).not.toBeNull();
  expect(card.querySelectorAll('a, [role="link"], [role="button"], button')).toHaveLength(0);
  expect(card.textContent).not.toMatch(/install|download/i);
  expect(card.textContent).not.toMatch(/free pulls?|\bdupes?\b|\bduplicates?\b/i);
});

// PR #159's review: a decoder fed clean pixels forgives a thin margin, a camera may not. ISO 18004 asks for 4 modules of quiet
// zone. The module count comes from the same encoder the component draws with, over every address length from a bare
// localhost to a long deep link; the widest module (the shortest address) is the binding case.
test('the light margin round the code is at least 4 modules at every address length, inside the canvas\'s 84 px box', () => {
  Object.assign(globalThis, { TextEncoder: jest.requireActual<typeof import('node:util')>('node:util').TextEncoder }); // jsdom has none; the encoder wants one
  const { create } = jest.requireActual<{ create: (text: string, o: { errorCorrectionLevel: string }) => { modules: { size: number } } }>('qrcode');
  const box = host.querySelector('[role="img"]') as HTMLElement;
  const drawn = Number((host.querySelector('[data-testid="qr"]') as HTMLElement).dataset.size);
  expect([box.style.width, box.style.padding, drawn]).toEqual([`${QR.box}px`, `${QR.pad}px`, QR.size]);
  expect(QR.size + 2 * QR.pad).toBe(QR.box);
  const thinnest = { modules: Infinity, at: 0 };
  for (let len = 8; len <= 400; len++) {
    const across = create('https://'.padEnd(len, 'a'), { errorCorrectionLevel: 'M' }).modules.size;
    const quiet = QR.pad / (QR.size / across);
    if (quiet < thinnest.modules) Object.assign(thinnest, { modules: quiet, at: len });
  }
  expect(thinnest.modules).toBeGreaterThanOrEqual(4);
  expect(QR.pad / (QR.size / 21)).toBeGreaterThanOrEqual(4); // and for the smallest code there is, whatever the address
});

// W2.2's review, then #169: on the not-found page the QR sends the phone to the machine, and it knows it is the not-found page
// because that page says so, not by classifying the address itself. It used to, splitting before decoding while the router
// decodes first: `/binder/a%2Fb` drew not-found and its QR encoded the dead address (reproduced on main, 19 Sept).
test('while the not-found page is showing, the QR is the machine, whatever the address; after, the address again', async () => {
  await routeTo('/binder/a%2Fb?ref=mei'); // an address a split-then-decode reads as the app's
  let hide = () => {};
  try {
    await act(async () => { hide = showNotFound(); });
    expect(qr()).toBe(`${window.location.origin}/`);
  } finally { await act(async () => { hide(); }); } // never leak the mark into later tests
  expect(qr()).toBe(`${window.location.origin}/binder/a%2Fb?ref=mei`);
});

test('every other address is kept as it is, query and all: pages, binders and the sheets', async () => {
  for (const p of ['/odds', '/card/sv1-1?tier=holo', '/binder/A?ref=mei', '/wallet/deposit', '/nope/deeper']) {
    await routeTo(p);
    expect([p, qr()]).toEqual([p, `${window.location.origin}${p}`]);
  }
});

// #169: the QR trailed the address bar by one change on every page, sheet and binder, because it read the bar during the
// router's render and the router writes the bar after it (measured on main: `/` while the bar said `/odds`).
test('it is never a change behind: the router writes the address after re-rendering the card, and the QR still has it', async () => {
  for (const p of ['/odds', '/pull', '/binder/B', '/wallet']) {
    await routeTo(p);
    expect([p, qr(), window.location.href]).toEqual([p, `${window.location.origin}${p}`, `${window.location.origin}${p}`]);
  }
});

// A sheet closed with esc or ✕ is `router.back()`: the router's state goes first, and the browser moves on its popstate, later.
test('a sheet closed by the router going back: the QR follows the browser when it gets there (popstate)', async () => {
  await routeTo('/odds');
  await act(async () => { jest.mocked(usePathname).mockReturnValue('/pull'); root.render(<Router url="/odds"><PhoneCard /></Router>); }); // the router's state is back; the bar is not yet
  await settle();
  expect(qr()).toBe(`${window.location.origin}/odds`); // the bar still says /odds, and so does the QR
  await act(async () => { window.history.replaceState(null, '', '/pull'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(qr()).toBe(`${window.location.origin}/pull`);
});

// PR #179's review: when the app closes a sheet itself, the router's linking waits on `history.go(-1)`, and a write queued
// meanwhile (Account → Odds disclosure from Wallet: the page changed under the sleeve) lands in a microtask right after the
// popstate. Nothing re-renders after it, so the card has to look again one macrotask after the popstate.
test('a write the router queues right after a popstate is still caught', async () => {
  await routeTo('/odds');
  const queued = () => { queueMicrotask(() => window.history.replaceState(null, '', '/pull')); };
  window.addEventListener('popstate', queued); // registered after the card's own listener, as the router's is
  try {
    await act(async () => { window.history.replaceState(null, '', '/wallet'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await settle();
    expect([qr(), window.location.href]).toEqual([`${window.location.origin}/pull`, `${window.location.origin}/pull`]);
  } finally { window.removeEventListener('popstate', queued); }
});

// A change of the query alone, same pathname (the stray `?cardId=` the URL hook clears, W2.1): the router's params change, and the
// card has to look again for that too.
test('a change of the query alone is followed', async () => {
  await routeTo('/?cardId=sv1-1');
  expect(qr()).toBe(`${window.location.origin}/?cardId=sv1-1`);
  await act(async () => { jest.mocked(useGlobalSearchParams).mockReturnValue({} as never); root.render(<Router url="/"><PhoneCard /></Router>); }); // new params object, pathname still '/'
  await settle();
  expect(qr()).toBe(`${window.location.origin}/`);
});
