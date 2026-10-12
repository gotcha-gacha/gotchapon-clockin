// URL ↔ state on the web (W2.1, #128; plan §4.4). The URL is a PROJECTION of session state, never the pager's source of
// truth: the three pages and the open binder are one catch-all route (`src/app/[...path].tsx`), and a change of page or
// binder is `router.setParams`, which moves the address without a history entry and without remounting anything (measured,
// W0.2c #137). The URL is read ONCE, at boot: `/wallet` boots to the Wallet page, `/binder/little-lanterns` to that binder,
// `/card/:id` to the binder that holds the card (with the card sheet, a route of its own, over it). After that the URL
// follows state; it never drives it. Sheets (`/card/:id`, `/odds`) are routes pushed over this one, so while one is on top
// the address is theirs and this hook writes nothing.
//
// What a cold load lands on:  `/pull` → Pull · `/odds` → Pull (the sleeve is a Pull overlay) · `/binder` → Albums ·
// `/binder/:id` → that binder · `/wallet`, `/wallet/deposit` → Wallet (there is no deposit sheet: deposit is the Wallet page's
// own card, no onramp) · `/card/:id` → the binder of that card · `/` and anything unknown → the landing page, the Binder
// (`LANDING_PAGE`, #210; before 21 Sept the machine). A query (`?ref=x`) is ignored (AC-4).
import { useEffect, useRef } from 'react';
import { useGlobalSearchParams, useNavigationContainerRef, usePathname, useRouter, useSegments } from 'expo-router';
import { cardHref, deferSheet, pushSheet, setSheetsRouted, takeDeferredSheet } from './sheetRoutes';
import { useAppGate } from './appGate';
import type { Tier } from '@/api/contract';
import { LANDING_PAGE, PAGE, useSession, type PageIndex } from '@/state/session';

export type UrlState = { page: PageIndex; album: string | null };
type Album = { id: string; cards: { id: string }[] };
const TIERS: Tier[] = ['common', 'reverse', 'holo', 'ultra', 'graded'];

/** An address: the path, and the sheet params the router leaves on the app's route when a sheet route is rebuilt away
 *  (browser Forward onto a `/card/:id` entry from before a reload lands the router on `/?cardId=:id`: seen). */
export type Address = { pathname: string; cardId?: string; tier?: string };
/** The card a sheet address names, if any: `/card/:id` (`?tier=`), or the app's route carrying `cardId`. */
/** Path segments, decoded where they can be: a malformed escape (`/binder/%`) is kept as typed, never thrown. It threw
 *  once, and the whole app became the error card, whose Reload landed on the same card (PR #165's review). */
const segs = (pathname: string) => pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });

export function cardOf(a: Address): { cardId: string; tier?: string } | null {
  const seg = segs(a.pathname);
  if (seg[0] === 'card' && seg[1] && seg.length === 2) return { cardId: seg[1], tier: a.tier }; // exactly /card/:id, the card route's own shape
  if (a.cardId) return { cardId: a.cardId, tier: a.tier };
  return null;
}
/** What state an address names, or null when it needs data that is not there yet (a card's album before the albums are known). */
export function stateFromPath(a: Address, albums: readonly Album[]): UrlState | null {
  const seg = segs(a.pathname);
  const card = cardOf(a);
  if (card) {
    if (!albums.length) return null;
    return { page: PAGE.albums, album: albums.find((x) => x.cards.some((c) => c.id === card.cardId))?.id ?? null };
  }
  if (seg[0] === 'binder') {
    // An album id waits for the albums, as a card does: a first load that FAILED is `ready` with none, and a boot that
    // resolved then opened the grid for good (PR #165's second review).
    if (seg[1] && !albums.length) return null;
    return { page: PAGE.albums, album: seg[1] && albums.some((x) => x.id === seg[1]) ? seg[1] : null };
  }
  if (seg[0] === 'wallet') return { page: PAGE.wallet, album: null };
  if (seg[0] === 'pull' || seg[0] === 'odds') return { page: PAGE.pull, album: null };
  return { page: LANDING_PAGE, album: null };
}
/** The path a state is written to. */
export function pathForState(s: UrlState): string[] {
  if (s.page === PAGE.albums) return s.album ? ['binder', s.album] : ['binder'];
  if (s.page === PAGE.wallet) return ['wallet'];
  return ['pull'];
}
/** A sheet route on top, read from the router's own route (`useSegments()`), never from the address text: the pathname
 *  `usePathname()` reports is DECODED, so `/%6Fdds` read as the odds sheet while the router had routed it to the catch-all,
 *  and the address froze for the session (#169; PR #165's fourth review). `/card`, `/odds/x`, `/card/x/extra` are page
 *  addresses the catch-all answers, and the address keeps following the app there (PR #165's third review). */
export const isSheetRoute = (segments: readonly string[]) => segments[0] === 'odds' || segments[0] === 'card';
/** `/` and `/wallet/deposit` are spellings of a page, kept as typed: only a CHANGE of state rewrites the address. */
const namesState = (pathname: string, s: UrlState, albums: readonly Album[]) => {
  const named = stateFromPath({ pathname }, albums);
  return !!named && named.page === s.page && named.album === s.album;
};

/** The address bar, as an Address. */
function readAddress(): Address {
  if (typeof window === 'undefined') return { pathname: '/' };
  const q = new URLSearchParams(window.location.search);
  return { pathname: window.location.pathname, cardId: q.get('cardId') ?? undefined, tier: q.get('tier') ?? undefined };
}

export function useUrlState(): void {
  const pathname = usePathname();
  const sheetOnTop = isSheetRoute(useSegments());
  const router = useRouter();
  const nav = useNavigationContainerRef() as ReturnType<typeof useNavigationContainerRef> | undefined; // undefined with no router at all (a bare render in a test)
  const inRouter = !!nav && nav.isReady();
  const { page, setPage, albumOpen, openAlbum, albums, ready } = useSession();
  const gate = useAppGate();
  const params = useGlobalSearchParams<{ cardId?: string; tier?: string }>();
  const booted = useRef(false);
  const deferChecked = useRef(false);
  // The address the page was OPENED on, from the browser itself: a sheet cold-loaded before sign-in steps back to `/` at
  // once (sheetRoutes.ts), and on a browser Forward onto an entry from before a reload the router rebuilds, lands the app's
  // route on `/?cardId=…` (a sheet route rebuilt away, its params left) and its own route info is a tick behind the address bar. What the boot resolves
  // is what the address bar said when Home first drew.
  const opened = useRef<Address>(readAddress());

  // Sheets are routes only inside the router: never in a test that renders Home bare, never on a phone (this file is web).
  useEffect(() => {
    if (!inRouter) return;
    setSheetsRouted(true);
    return () => setSheetsRouted(false);
  }, [inRouter]);

  // A sheet address opened while the app cannot show a sheet yet (signed out, onboarding): the sheet comes back once it can.
  // The sheet route defers itself when it mounts; this covers a rebuilt page, where the router may never mount it.
  useEffect(() => {
    if (!inRouter || deferChecked.current) return;
    deferChecked.current = true;
    if (gate === 'show') return;
    const card = cardOf(opened.current);
    if (card) deferSheet(cardHref(card.cardId, TIERS.find((t) => t === card.tier)));
    // /odds is not deferred (#332): v0 has no sleeve, so a cold /odds must not come back as a sheet after sign-in.
  }, [inRouter, gate]);

  // After boot: state → the URL, while this route is on top. `setParams` on the catch-all: no history entry, no remount.
  // DECLARED BEFORE THE BOOT, and that order is load-bearing: effects run in declaration order within one commit. In the
  // commit where the boot runs, this one runs first and sees `booted` false; had it run after, it would see `booted` true and
  // the page from BEFORE the boot's setPage (Pull), and write `/pull` over the address being read (PR #165's review measured
  // `/wallet/deposit` → `/wallet` and `/binder/nope` → `/binder` that way).
  useEffect(() => {
    if (!booted.current || sheetOnTop) return;
    const now = { page, album: page === PAGE.albums ? albumOpen : null };
    if (namesState(pathname, now, albums)) return;
    // One macrotask later, never in the same task as the change. After browser Back from a sheet the router is still inside
    // its own popstate handling when this runs, and a setParams there made it read the new path as another step back and
    // leave the site (PR #165's second review: Account → Odds disclosure from Wallet, then Back, landed on about:blank).
    // Now a precaution: a synchronous writer no longer reproduces that on this code (PR #171's second review, Chromium and
    // WebKit 3/3), and why it stopped is not known (the history patch landed in between; that it is the reason is a guess).
    // Kept: it costs one macrotask.
    // A sheet pushed before it fires (the disclosure changes page AND opens the sleeve) changes the pathname, which re-runs
    // this effect, whose cleanup cancels the write: it never lands on the sheet.
    const t = setTimeout(() => router.setParams({ path: pathForState(now) }), 0);
    return () => clearTimeout(t);
  }, [pathname, sheetOnTop, page, albumOpen, albums, router]);

  // Boot: the URL → state, once, when the session's first load is in. Not before: whether `/binder/A` names an album is only
  // known once the albums are, and a boot that ran on an empty list opened the grid for good (PR #165's review: a cold load
  // of the app's own `/binder/A` landed on `/binder`, 4 runs of 4).
  useEffect(() => {
    if (booted.current || !inRouter || !ready) return;
    const want = stateFromPath(opened.current, albums);
    if (!want) return;
    booted.current = true;
    if (want.page !== page) setPage(want.page);
    if (want.album) openAlbum(want.album);
  }, [albums, inRouter, ready, page, setPage, openAlbum]);

  // A sheet route stepped back from (before sign-in, or a card not held) leaves its own params on the app's route, as
  // `/?cardId=…` (seen). Asked for while the app's route is on top, so that a Forward-rebuilt page and a reload of the same
  // address read the same (AC-5). Two ways it stuck before #169 (PR #171's review logged every call against the focused route):
  // on a cold `/card/x%2Fy` the clear went to the CARD route while it was still on top, its decoded pathname `/card/x/y` not
  // reading as a sheet, and `?cardId=x%2Fy` then rode on every later address (the route check above fixes that); and a clear
  // sent before the stack exists (a cold `/?cardId=…`) went nowhere until sign-in. So it is asked again at every address
  // change while the params are still there. What that leaves: a stray on an address that already names its page (a cold
  // `/wallet?tier=holo`) stays until the first page change (harmless: AC-4 ignores the query, a reload reads the same).
  const stray = !sheetOnTop && (params.cardId !== undefined || params.tier !== undefined);
  useEffect(() => {
    if (!inRouter || !stray) return;
    router.setParams({ cardId: undefined, tier: undefined });
  }, [inRouter, stray, router, pathname]);

  // A sheet that was deferred comes back once the app can show it (appGate.ts: signed in, this tab active, country open).
  useEffect(() => {
    if (!inRouter || gate !== 'show') return;
    const href = takeDeferredSheet();
    if (href) pushSheet(href);
  }, [inRouter, gate]);
}
