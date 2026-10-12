/**
 * The URL hook itself (W2.1, #128; PR #165's review found the boot latching on an empty album list, and a malformed escape
 * throwing). The session is a real React state standing in for the provider, so the boot's setPage / openAlbum land and
 * re-render as they do in the app; the router stands in with a pathname that `setParams` really moves. What is read: the
 * state the address boots into, and every address the hook writes.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as router from 'expo-router';
import * as session from '@/state/session';
import { setAppGate } from '../appGate';
import { takeDeferredSheet } from '../sheetRoutes';
import { useUrlState } from '../useUrlState.web';

jest.mock('expo-router', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  // The route on top is what the real router decides from the address: the two sheet routes for their literal paths, the
  // catch-all for everything else. `__setRoute` covers what a literal path cannot say (an encoded `/%6Fdds` is routed to the
  // catch-all while `usePathname()` reports it decoded, `/odds`).
  const routeOf = (p: string) => (/^\/odds\/?$/.test(p) ? ['odds'] : /^\/card\/[^/]+\/?$/.test(p) ? ['card', '[cardId]'] : ['[...path]']);
  let path = '/'; let route = routeOf(path); let query: Record<string, string> = {}; const ls = new Set<() => void>();
  const setRoute = (p: string, r: string[]) => { path = p; route = r; ls.forEach((l) => l()); };
  const setPath = (p: string) => setRoute(p, routeOf(p));
  const sub = (l: () => void) => { ls.add(l); return () => { ls.delete(l); }; };
  const setParams = jest.fn((q: { path?: string[] }) => { if (q.path) setPath('/' + q.path.join('/')); });
  const routerObj = { setParams };
  return {
    __setPath: setPath,
    __setRoute: setRoute,
    __setQuery: (q: Record<string, string>) => { query = q; },
    usePathname: () => R.useSyncExternalStore(sub, () => path),
    useSegments: () => R.useSyncExternalStore(sub, () => route),
    // ONE router object, as the real hook's is stable: a new one per render re-ran the writer effect every render and hid its
    // dependency list from every test (PR #165's third review).
    useRouter: () => routerObj,
    useNavigationContainerRef: () => ({ isReady: () => true }),
    useGlobalSearchParams: () => query,
    router: { push: jest.fn(), back: jest.fn(), setParams },
  };
});
jest.mock('@/state/session', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const Ctx = R.createContext<unknown>(null);
  return { PAGE: { albums: 0, pull: 1, wallet: 2 }, LANDING_PAGE: 0, useSession: () => R.useContext(Ctx), __Ctx: Ctx };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const R = router as unknown as { __setPath: (p: string) => void; __setRoute: (p: string, r: string[]) => void; __setQuery: (q: Record<string, string>) => void; router: { push: jest.Mock; setParams: jest.Mock } };
const Ctx = (session as unknown as { __Ctx: React.Context<unknown> }).__Ctx;
const { PAGE } = session;
const ALBUMS = [{ id: 'A', title: 'Little Lanterns', cards: [{ id: 'sv1-1' }] }, { id: 'B', title: 'Tidepool', cards: [{ id: 'sv2-9' }] }];
type S = { page: number; albumOpen: string | null; ready: boolean; setPage: (p: number) => void; openAlbum: (id: string) => void };
const live: { s: S | null; load: () => void; fail: () => void } = { s: null, load: () => {}, fail: () => {} };

function Probe() { useUrlState(); return null; }
function Harness() {
  const [page, setPage] = useState<number>(PAGE.albums); // the session's landing page (#210)
  const [albumOpen, openAlbum] = useState<string | null>(null);
  const [load, setLoad] = useState<'none' | 'failed' | 'in'>('none');
  const value = { page, setPage, albumOpen, openAlbum, albums: load === 'in' ? ALBUMS : [], ready: load !== 'none' }; // a failed first load is `ready` with no albums (session.tsx)
  useEffect(() => { live.s = value as S; live.load = () => setLoad('in'); live.fail = () => setLoad('failed'); });
  return <Ctx.Provider value={value}><Probe /></Ctx.Provider>;
}

let root: Root; let host: HTMLElement;
/** A cold load of `path`: the address bar and the router both say it; the session has not loaded yet. */
const open = async (path: string) => {
  const u = new URL(path, 'http://x');
  window.history.replaceState(null, '', path); R.__setPath(u.pathname); R.__setQuery(Object.fromEntries(u.searchParams)); R.router.setParams.mockClear(); R.router.push.mockClear();
  await act(async () => { root.render(<Harness />); });
};
const load = async () => { await act(async () => { live.load(); }); await settle(); };
/** The writer runs a macrotask after the change (never inside the router's popstate handling): let it. */
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const writes = () => R.router.setParams.mock.calls.map((c) => (c[0] as { path?: string[] }).path).filter(Boolean).map((p) => '/' + p!.join('/'));

beforeEach(() => { setAppGate('show'); takeDeferredSheet(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
// Real timers first: a test that faked them may have failed before putting them back, and every later `settle()` needs them.
afterEach(async () => { jest.useRealTimers(); await act(async () => { root.unmount(); }); host.remove(); setAppGate('wait'); window.history.replaceState(null, '', '/'); });

test('a cold /binder/A waits for the first load, then opens THAT binder, and writes nothing over the address', async () => {
  await open('/binder/A');
  expect([live.s!.page, live.s!.albumOpen, writes()]).toEqual([PAGE.albums, null, []]); // nothing decided on an empty album list: still the landing page, no binder open
  await load();
  expect([live.s!.page, live.s!.albumOpen, writes()]).toEqual([PAGE.albums, 'A', []]);
});

test('a cold /wallet/deposit and /binder/nope boot to their page and keep the address as typed', async () => {
  await open('/wallet/deposit'); await load();
  expect([live.s!.page, writes()]).toEqual([PAGE.wallet, []]);
  await act(async () => { root.unmount(); }); root = createRoot(host);
  await open('/binder/nope'); await load();
  expect([live.s!.page, live.s!.albumOpen, writes()]).toEqual([PAGE.albums, null, []]);
});

test('a malformed escape boots instead of throwing (it took the whole app down to the error card)', async () => {
  for (const p of ['/binder/%25zz', '/binder/%E0%A4%A', '/%25zz']) {
    await act(async () => { root.unmount(); }); root = createRoot(host);
    await open(p);
    await load();
    expect(live.s!.page).toBe(PAGE.albums); // `/binder/…` names the Albums page; `/%25zz` is unknown and lands on the Binder too (#210)
  }
});

test('after the boot the address follows the app: page, binder, back to the grid; nothing while a sheet route is on top', async () => {
  await open('/'); await load();
  expect(writes()).toEqual([]); // `/` names Pull already
  await act(async () => { live.s!.setPage(PAGE.wallet); }); await settle();
  await act(async () => { live.s!.setPage(PAGE.albums); }); await settle();
  await act(async () => { live.s!.openAlbum('B'); }); await settle();
  expect(writes()).toEqual(['/wallet', '/binder', '/binder/B']);
  await act(async () => { R.__setPath('/odds'); });
  await act(async () => { live.s!.setPage(PAGE.pull); }); await settle();
  expect(writes()).toEqual(['/wallet', '/binder', '/binder/B']);
});

test('a cold /odds does not come back as a sleeve once the app is up (#332)', async () => {
  setAppGate('wait');
  await open('/odds');
  expect(R.router.push).not.toHaveBeenCalled();
  await act(async () => { setAppGate('show'); });
  expect(R.router.push).not.toHaveBeenCalled();
  await act(async () => { root.unmount(); }); root = createRoot(host);
  setAppGate('show');
  await open('/odds');
  expect(R.router.push).not.toHaveBeenCalled();
});

// PR #165's second review. Account → "Odds disclosure" from Wallet changes the page AND pushes the sleeve in one press, so the
// app's address is still `/wallet` under `/odds`. Browser Back then lands on `/wallet` with the page on Pull, and a write made
// inside that popstate made the router step back again, off the site. The write comes a macrotask later, and a write that
// finds a sheet on top when it fires is dropped (it would land on the sheet).
test('under a sheet the stale address waits; after Back it is corrected a macrotask later, never in the same task', async () => {
  await open('/wallet'); await load();
  expect([live.s!.page, writes()]).toEqual([PAGE.wallet, []]);
  await act(async () => { live.s!.setPage(PAGE.pull); R.__setPath('/odds'); }); // one press: page and sleeve
  await settle();
  expect(writes()).toEqual([]); // nothing written onto the sheet
  // setTimeout alone is faked, so the async act below runs every microtask the Back queues, and crosses a macrotask of its
  // own, while the writer's timer is held. On real timers that act raced the timer and lost under load (PR #171's review);
  // a synchronous act reads before any microtask, so a write moved into one, the same task, passed. `doNotFake` is
  // load-bearing: a bare useFakeTimers() fakes queueMicrotask and nextTick too, and such a write passes again (measured).
  // It pins the writer to setTimeout: a write on another macrotask (setImmediate) lands inside the act and fails here.
  jest.useFakeTimers({ doNotFake: ['Date', 'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval'] });
  await act(async () => { R.__setPath('/wallet'); }); // browser Back: the router is on the stale app address
  expect(writes()).toEqual([]); // not inside the popstate, microtasks included
  act(() => { jest.advanceTimersByTime(0); }); // the next macrotask: the writer's 0 ms timer, and only a 0 ms one
  expect(writes()).toEqual(['/pull']);
});

test('a write scheduled just before a sheet is pushed is dropped when it fires', async () => {
  await open('/'); await load();
  act(() => { live.s!.setPage(PAGE.wallet); }); // synchronous acts: no macrotask between the change and the push (above)
  act(() => { R.__setPath('/odds'); }); // pushed before the macrotask
  await settle();
  expect(writes()).toEqual([]);
});

test('a first load that failed (ready, no albums): /binder/A waits, and opens A when the albums arrive (Retry)', async () => {
  await open('/binder/A');
  await act(async () => { live.fail(); }); await settle();
  expect([live.s!.page, live.s!.albumOpen, writes()]).toEqual([PAGE.albums, null, []]); // still the landing page, no binder open
  await load();
  expect([live.s!.page, live.s!.albumOpen, writes()]).toEqual([PAGE.albums, 'A', []]);
});

// AC-5's pieces, which only the browser saw (the reviewer's 0 of 7).
test('a rebuilt page lands the app on `/?cardId=…`: the stray sheet params are cleared, on the app\u2019s address only', async () => {
  await open('/?cardId=sv1-1&tier=holo'); await load();
  // Both keys present and undefined (toEqual would count a missing `tier` as undefined and see nothing).
  const clears = (c: unknown[]) => { const q = c[0] as Record<string, unknown>; return 'cardId' in q && 'tier' in q && q.cardId === undefined && q.tier === undefined; };
  expect(R.router.setParams.mock.calls.some(clears)).toBe(true);
  await act(async () => { root.unmount(); }); root = createRoot(host);
  await open('/card/sv1-1?tier=holo'); await load();
  expect(R.router.setParams.mock.calls.some(clears)).toBe(false); // the card route's own
});

// #169: a clear sent while a stepped-back sheet was still the focused route never took, and nothing asked again: a cold
// `/card/x%2Fy` carried `?cardId=x%2Fy` on every later address for the session (seen on the 18 Sept demo).
test('a stray clear that did not take is asked for again at the next address change', async () => {
  await open('/?cardId=sv1-1'); await load(); // the stand-in's setParams moves the path only: a clear here never takes
  const clears = () => R.router.setParams.mock.calls.filter((c) => 'cardId' in (c[0] as object)).length;
  const first = clears();
  expect(first).toBeGreaterThan(0);
  await act(async () => { live.s!.setPage(PAGE.wallet); }); await settle(); // the address moves to /wallet
  expect(writes()).toContain('/wallet');
  expect(clears()).toBeGreaterThan(first);
});

// #169, PR #165's fourth review: `/%6Fdds` is routed to the catch-all, but `usePathname()` reports it decoded (`/odds`). Read
// from the text, it was the odds sheet, the writer returned early for good and the address froze for the session.
test('an encoded sheet word is a page address: the router has the catch-all on top, and the address follows the app', async () => {
  window.history.replaceState(null, '', '/%6Fdds');
  R.__setRoute('/odds', ['[...path]']); R.__setQuery({}); R.router.setParams.mockClear(); R.router.push.mockClear();
  await act(async () => { root.render(<Harness />); });
  await load();
  await act(async () => { live.s!.setPage(PAGE.wallet); }); await settle();
  expect(writes()).toEqual(['/wallet']);
  expect(R.router.push).not.toHaveBeenCalled(); // and no sleeve was opened for it
});

// PR #171's review: on a cold `/card/x%2Fy` the card route is on top with a decoded pathname (`/card/x/y`) that no text check
// reads as a sheet, and main's stray clear went to the card route itself.
test('the card route on top, whatever its decoded pathname: its own card param is never cleared as a stray', async () => {
  window.history.replaceState(null, '', '/card/x%2Fy');
  R.__setRoute('/card/x/y', ['card', '[cardId]']); R.__setQuery({ cardId: 'x/y' }); R.router.setParams.mockClear(); R.router.push.mockClear();
  await act(async () => { root.render(<Harness />); });
  await load();
  await act(async () => { live.s!.setPage(PAGE.wallet); }); await settle(); // an address change: the retry would ask again
  expect(R.router.setParams.mock.calls.filter((c) => 'cardId' in (c[0] as object))).toEqual([]);
});

// The sleeve opened over that page reports the same pathname (`/odds`) as the page beneath it: only the route changes. A page
// change made under the sleeve is written when the sleeve goes, though the pathname never moved.
test('a sheet that leaves without the pathname moving still lets the address catch up', async () => {
  window.history.replaceState(null, '', '/%6Fdds');
  R.__setRoute('/odds', ['[...path]']); R.__setQuery({}); R.router.setParams.mockClear(); R.router.push.mockClear();
  await act(async () => { root.render(<Harness />); });
  await load();
  await act(async () => { R.__setRoute('/odds', ['odds']); }); // the sleeve, over the page
  await act(async () => { live.s!.setPage(PAGE.wallet); }); await settle();
  expect(writes()).toEqual([]); // nothing onto the sheet
  await act(async () => { R.__setRoute('/odds', ['[...path]']); }); // the sleeve goes; the pathname is what it was
  await settle();
  expect(writes()).toEqual(['/wallet']);
});

test('a card address opened before the app is up comes back with its tier; an odd tier comes back as a common', async () => {
  setAppGate('wait');
  await open('/card/sv1-1?tier=holo');
  await act(async () => { setAppGate('show'); });
  expect(R.router.push.mock.calls).toEqual([[{ pathname: '/card/[cardId]', params: { cardId: 'sv1-1', tier: 'holo' } }, { dangerouslySingular: true }]]);
  await act(async () => { root.unmount(); }); root = createRoot(host);
  setAppGate('wait');
  await open('/card/sv1-1?tier=shiny');
  await act(async () => { setAppGate('show'); });
  expect(R.router.push.mock.calls).toEqual([[{ pathname: '/card/[cardId]', params: { cardId: 'sv1-1' } }, { dangerouslySingular: true }]]);
});

test('a deferral is decided once, at the first commit in the router: a later wait does not defer the address again', async () => {
  setAppGate('show');
  await open('/odds');
  await act(async () => { setAppGate('wait'); });
  await act(async () => { setAppGate('show'); });
  expect(R.router.push).not.toHaveBeenCalled();
});

test('a failed first load: a bare /binder needs no albums and boots at once; the address then follows the app', async () => {
  await open('/binder');
  await act(async () => { live.fail(); }); await settle();
  expect([live.s!.page, writes()]).toEqual([PAGE.albums, []]);
  await act(async () => { live.s!.setPage(PAGE.wallet); }); await settle();
  expect(writes()).toEqual(['/wallet']);
});

test('an address that only starts like a sheet is not left for later: /odds/x and /card/x/extra open no sheet', async () => {
  for (const addr of ['/odds/x', '/card/sv1-1/extra']) {
    await act(async () => { root.unmount(); }); root = createRoot(host);
    setAppGate('wait');
    await open(addr);
    await act(async () => { setAppGate('show'); });
    expect([addr, R.router.push.mock.calls.length]).toEqual([addr, 0]);
  }
});
