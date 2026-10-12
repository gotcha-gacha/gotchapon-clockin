/**
 * The web pager (W0.2a, #120), rendered by react-dom through react-native-web in jsdom. jsdom lays nothing out and never
 * scrolls by itself, so a "swipe" here is what a browser does to the node: move scrollLeft and fire `scroll`. The pages, the
 * ritual and the session are stand-ins; the pager, react-native-web's ScrollView and the timers' arithmetic are real.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useReducedMotion } from 'react-native-reanimated';
import { HomePager, pageAt, RNW_END_MS, SETTLE_MS, SWIPE_MS } from '@/components/HomePager.web'; // by name: tsc resolves the bare path to the native file
import { useSession } from '@/state/session';

/** Stillness before a swipe counts as landed: react-native-web's own end-of-scroll tick, then the pager's wait after it. */
const LANDED = RNW_END_MS + SETTLE_MS;

jest.mock('@/state/session', () => ({ PAGES: ['Albums', 'Pull', 'Wallet'], PAGE: { albums: 0, pull: 1, wallet: 2 }, useSession: jest.fn() }));
jest.mock('@/ritual/useRitual', () => ({ RitualProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/screens/AlbumsPage', () => ({ AlbumsPage: () => null }));
jest.mock('@/screens/PullPage', () => ({ PullPage: () => null }));
jest.mock('@/screens/WalletPage', () => ({ WalletPage: () => null }));
jest.mock('react-native-reanimated', () => ({ ...(jest.requireActual('react-native-reanimated') as object), useReducedMotion: jest.fn(() => false) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const W = 1024; // jsdom's window.innerWidth: the pager's first guess at its width, and with no layout events its only one
let root: Root; let host: HTMLElement;
const setPage = jest.fn();
type Sess = { page: 0 | 1 | 2; pagerLocked?: boolean; oddsOpen?: boolean };
const session = (s: Sess) => jest.mocked(useSession).mockReturnValue({ pagerLocked: false, oddsOpen: false, ...s, setPage } as unknown as ReturnType<typeof useSession>);
const render = async () => { await act(async () => { root.render(<HomePager />); }); };
const scroller = () => host.querySelector('[data-testid="home-pager"]') as HTMLElement;
/** What a browser does when a finger moves the track: scrollLeft changes and `scroll` fires. */
const swipeTo = async (x: number) => { await act(async () => { scroller().scrollLeft = x; scroller().dispatchEvent(new Event('scroll')); }); };
const pass = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };

beforeEach(() => {
  jest.useFakeTimers();
  setPage.mockClear();
  jest.mocked(useReducedMotion).mockReturnValue(false);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); jest.useRealTimers(); });

test('it opens on the page state names, without telling state anything', async () => {
  session({ page: 1 });
  await render();
  // Each page fills the pager's height and no more (flex: 1), so its own ScrollView scrolls. Left to its content's height, a page
  // taller than the window (iPhone Safari with its toolbars) was clipped at the bottom with nothing to scroll: W0.3, #121.
  const pages = [...scroller().firstElementChild!.children].map((c) => c.firstElementChild as HTMLElement);
  expect(pages.map((p) => getComputedStyle(p).flexGrow)).toEqual(['1', '1', '1']); // all jsdom resolves of `flex: 1`; the browser runs at 677 pt are the proof it scrolls
  expect(scroller().scrollLeft).toBe(W); // react-native-web ignores contentOffset: the pager has to put it there
  await pass(1000);
  expect(setPage).not.toHaveBeenCalled();
});

test('state → scroll: a rail press glides there in 380 ms with snapping off, and its own scroll events are not a swipe', async () => {
  expect(SWIPE_MS).toBe(380); // design/README.md's timing sheet: every wait below is written in SWIPE_MS, so nothing else pins the number
  session({ page: 1 });
  await render();
  session({ page: 0 });
  await render();
  await pass(SWIPE_MS / 2);
  const mid = scroller().scrollLeft;
  expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(W); // on its way, not jumped
  expect(mid).toBeLessThan(W / 2); // cubic-bezier(.25,.8,.3,1) is most of the way there at half time; a linear tween is at W/2
  expect(scroller().style.scrollSnapType).toBe('none'); // or the snap container would pull every frame back to a page
  scroller().dispatchEvent(new Event('scroll'));
  await pass(SWIPE_MS / 2 + 50);
  expect(scroller().scrollLeft).toBe(0);
  expect(scroller().style.scrollSnapType).toBe('');
  scroller().dispatchEvent(new Event('scroll')); // the echo of the last frame
  await pass(LANDED + 50);
  expect(setPage).not.toHaveBeenCalled();
});

test('scroll → state: a swipe that comes to rest on another page is told to state once, and only once it has come to rest', async () => {
  session({ page: 1 });
  await render();
  await swipeTo(W * 1.4); await pass(40);
  await swipeTo(W * 1.8); await pass(40);
  expect(setPage).not.toHaveBeenCalled(); // mid-swipe: still moving
  await swipeTo(W * 2); await pass(LANDED - 20);
  expect(setPage).not.toHaveBeenCalled();
  await pass(40);
  expect(setPage).toHaveBeenCalledTimes(1);
  expect(setPage).toHaveBeenCalledWith(2);
  session({ page: 2 }); // state caught up: the pager is already there and must not move again
  await render();
  await pass(SWIPE_MS + LANDED);
  expect(scroller().scrollLeft).toBe(W * 2);
  expect(setPage).toHaveBeenCalledTimes(1);
  await swipeTo(0); await pass(LANDED + 20); // and back the other way
  expect(setPage).toHaveBeenLastCalledWith(0);
});

test('a swipe that snaps back to the page it left says nothing; a width that is not a whole number still lands', async () => {
  session({ page: 1 });
  await render();
  await swipeTo(W * 1.3); await pass(30);
  await swipeTo(W); await pass(LANDED + 20);
  expect(setPage).not.toHaveBeenCalled();
  await swipeTo(W * 1.6); await pass(LANDED + 200); // a finger resting mid-swipe: still, but on no page. Nearest is Wallet; nothing is said
  expect(setPage).not.toHaveBeenCalled();
  await swipeTo(W * 2 - 1.4); await pass(LANDED + 20); // browser zoom: at rest a fraction of a pixel off the snap point still lands
  expect(setPage).toHaveBeenCalledTimes(1);
  expect(setPage).toHaveBeenCalledWith(2);
  expect(pageAt(803.6, 401.5)).toBe(2); // browser zoom: scrollLeft never equals page × width exactly
  expect(pageAt(12, 0)).toBe(0); // no width yet (the first frame): no NaN page
  expect(pageAt(99999, 400)).toBe(2); expect(pageAt(-50, 400)).toBe(0);
});

test('a hand on the crank, or the odds sleeve open: the track cannot be scrolled, and a scroll that happens anyway moves no page', async () => {
  session({ page: 1, pagerLocked: true });
  await render();
  expect(getComputedStyle(scroller()).overflowX).toBe('hidden'); // react-native-web's scrollEnabled={false}
  await swipeTo(W * 2); await pass(LANDED + 20);
  expect(setPage).not.toHaveBeenCalled();
  session({ page: 1, oddsOpen: true });
  await render();
  expect(getComputedStyle(scroller()).overflowX).toBe('hidden');
  session({ page: 1 });
  await render();
  expect(getComputedStyle(scroller()).overflowX).not.toBe('hidden');
});

test('reduced motion: a page change jumps', async () => {
  jest.mocked(useReducedMotion).mockReturnValue(true);
  session({ page: 1 });
  await render();
  session({ page: 2 });
  await render();
  expect(scroller().scrollLeft).toBe(W * 2); // already there, no frames needed
  expect(scroller().style.scrollSnapType).toBe('');
});

/**
 * The one thing a browser's snap container does that jsdom does not, and the pager has to be written around (PR #150's review,
 * measured in Chromium and WebKit): with snapping on, reading scrollLeft commits the pending re-snap, so the read answers the
 * nearest page, not where the track is. With snapping off ('none') the read is the true position.
 */
const snapsOnRead = (el: HTMLElement) => {
  let x = el.scrollLeft;
  Object.defineProperty(el, 'scrollLeft', { configurable: true, set: (v: number) => { x = v; },
    get: () => (el.style.scrollSnapType === 'none' ? x : (x = Math.round(x / W) * W)) });
};

test('a second page change in mid-glide starts from where the track is, and the first glide stops writing', async () => {
  session({ page: 1 });
  await render();
  snapsOnRead(scroller());
  session({ page: 0 });
  await render();
  await pass(100);
  const at = scroller().scrollLeft;
  expect(at).toBeGreaterThan(0); expect(at).toBeLessThan(W / 2); // nearer Albums than Pull: a re-snap would put it on 0
  session({ page: 2 });
  await render();
  await pass(16);
  expect(scroller().scrollLeft).toBeGreaterThanOrEqual(at); // heading right now, from where it was, not from the page a re-snap would have put it on
  expect(scroller().scrollLeft).toBeLessThan(at + W / 4); // and one frame in, not a jump
  await pass(SWIPE_MS - 100); // the first glide's 380 ms are up, the second's are not: a first glide left running would switch snapping back on here
  expect(scroller().style.scrollSnapType).toBe('none');
  expect(scroller().scrollLeft).toBeLessThan(W * 2);
  await pass(150);
  expect(scroller().scrollLeft).toBe(W * 2);
  expect(scroller().style.scrollSnapType).toBe('');
});

test('a glide from Albums to Wallet passes Pull on the way: passing a snap point is not landing on it', async () => {
  session({ page: 0 });
  await render();
  const frames: FrameRequestCallback[] = [];
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; }); // freeze the glide mid-flight
  session({ page: 2 });
  await render();
  expect(frames).toHaveLength(1); // the glide is under way and waiting for its first frame
  await swipeTo(W); // where the glide is as it crosses Pull: exactly on a snap point, and still for as long as we like
  await pass(LANDED + 200);
  expect(setPage).not.toHaveBeenCalled();
  raf.mockRestore();
});

test('a swipe that rests a fraction of a pixel off the snap point is where the track stays: state catching up starts no glide', async () => {
  session({ page: 1 });
  await render();
  await swipeTo(W * 2 - 1.4); await pass(LANDED + 20);
  expect(setPage).toHaveBeenCalledWith(2);
  session({ page: 2 });
  await render();
  await pass(16);
  expect(scroller().style.scrollSnapType).toBe(''); // no glide over 1.4 px with snapping off, during which a real swipe would be ignored
  expect(scroller().scrollLeft).toBe(W * 2 - 1.4);
});

// jsdom has no ResizeObserver, so react-native-web never fires onLayout here. It parks the handler on the node it would
// observe: calling that is the pager's real onLayout, with the event a ResizeObserver tick would have produced.
type Laid = HTMLElement & { __reactLayoutHandler?: (e: { nativeEvent: { layout: { width: number } } }) => void };
const resizeBoxTo = async (width: number) => {
  const box = [...host.querySelectorAll<Laid>('*')].find((n) => typeof n.__reactLayoutHandler === 'function' && n.contains(scroller()) && n !== scroller())!;
  await act(async () => { box.__reactLayoutHandler!({ nativeEvent: { layout: { width } } }); });
};

test('a resize in mid-glide: the glide is dropped for a jump at the new width, and snapping comes back on', async () => {
  session({ page: 1 });
  await render();
  session({ page: 0 });
  await render();
  await pass(100);
  expect(scroller().style.scrollSnapType).toBe('none');
  session({ page: 2 }); // and the page changes with it, or the jump would be to where the glide was already going
  await resizeBoxTo(600);
  expect(scroller().scrollLeft).toBe(1200);
  expect(scroller().style.scrollSnapType).toBe(''); // left at 'none' the track would never snap to a page again
  await pass(SWIPE_MS + 50); // the dropped glide writes nothing more
  expect(scroller().scrollLeft).toBe(1200);
});

test('inside a box narrower than the window (the desktop cabinet, W1.1) the pages are the box wide, not the window', async () => {
  session({ page: 1 });
  await render();
  await resizeBoxTo(600);
  expect(scroller().scrollLeft).toBe(600); // still on Pull, at the new width, by a jump
  // react-native-web wraps each page in a snap-align div: the pager's own page View is that wrapper's child
  expect([...scroller().firstElementChild!.children].map((c) => (c.firstElementChild as HTMLElement).style.width)).toEqual(['600px', '600px', '600px']);
  await swipeTo(1200); await pass(LANDED + 20);
  expect(setPage).toHaveBeenCalledWith(2); // 1200 is Wallet in a 600-wide box; by the window's 1024 it would be nearest Pull and off-page
});

test('a pager with no width yet (a zero-wide window) tells state nothing, whatever the scroller reports', async () => {
  const width = jest.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(0); // what react-native-web's Dimensions reads
  window.dispatchEvent(new Event('resize'));
  session({ page: 1 });
  await render();
  await swipeTo(0); await pass(LANDED + 50); // at rest on "page 0" of a 0-wide track: PR #147's review walked NaN through this into setPage
  expect(setPage).not.toHaveBeenCalled();
  width.mockRestore();
  window.dispatchEvent(new Event('resize'));
});

// W1.6 (#139). Tab used to walk into the two pages beside the one on screen (and the browser scrolls the track to whatever
// takes focus). `inert` takes them out of the tab order, and out of reach of a press: so not while the track is moving, or a
// tap landing just as a swipe comes to rest would be lost.
const inert = () => [...scroller().firstElementChild!.children].map((c) => (c.firstElementChild as HTMLElement).hasAttribute('inert'));

test('at rest only the page on screen can take focus; while the track moves all three are live; then the new page alone', async () => {
  session({ page: 1 });
  await render();
  expect(inert()).toEqual([true, false, true]);
  await swipeTo(W * 1.4); // a finger is moving the track
  expect(inert()).toEqual([false, false, false]);
  await swipeTo(W * 2);
  await pass(LANDED + 50);
  expect(setPage.mock.calls).toEqual([[2]]);
  session({ page: 2 }); // state heard, and says so
  await render();
  expect(inert()).toEqual([true, true, false]);
});

test('a rail press: the page it names is live at once, the one left behind goes inert when the glide is over', async () => {
  session({ page: 1 });
  await render();
  session({ page: 0 });
  await render();
  expect(inert()[0]).toBe(false); // Albums can be tabbed into while it glides in
  scroller().dispatchEvent(new Event('scroll'));
  await pass(SWIPE_MS + LANDED + 50);
  expect(inert()).toEqual([false, true, true]);
});
