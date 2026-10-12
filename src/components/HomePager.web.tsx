// The three-page track on the web (W0.2a, #120): Albums · Pull · Wallet. react-native-pager-view has no web build (its
// native-only import stops `expo export --platform web` outright), so the web resolves this file instead of HomePager.tsx.
//
// A swipe is the browser's own: a horizontal scroll-snap container, one page per snap point. A page change that comes from
// state (the rail, the ritual sending you to Pull, later the keyboard) is the design's: 380 ms on cubic-bezier(.25,.8,.3,1),
// tweened here because `scroll-behavior: smooth` has no duration or curve, with snapping switched off for the length of the
// tween (a snap container pulls every intermediate scrollLeft back to a page). Reduced motion jumps instead.
//
// react-native-web's ScrollView is not React Native's (read in its source, run under jsdom, PR #147's review): it ignores
// `contentOffset`, and it never calls `onMomentumScrollEnd`, only `onScroll`. So the first position is set on the node, and
// "the swipe has landed" is "no scroll event for a moment", which also holds for fractional widths and browser zoom where
// scrollLeft never equals page × width exactly.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { Easing, useReducedMotion } from 'react-native-reanimated';
import { PAGE, useSession, type PageIndex } from '@/state/session';
import { useInert } from '@/components/webFocus';
import { RitualProvider } from '@/ritual/useRitual';
import { AlbumsPage } from '@/screens/AlbumsPage';
import { PullPage } from '@/screens/PullPage';
import { WalletPage } from '@/screens/WalletPage';

/** design/README.md "Motion & feedback timing sheet": Page swipe .38s cubic-bezier(.25,.8,.3,1). */
export const SWIPE_MS = 380;
const curve = Easing.bezierFn(0.25, 0.8, 0.3, 1);
/** A swipe has landed once no onScroll tick has come for this long. react-native-web sends its own last tick 100 ms after the
 *  scroller stops (RNW_END_MS), so the track has been still for the sum of the two. */
export const SETTLE_MS = 140;
export const RNW_END_MS = 100;
/** …and it has landed *on a page*: a finger that pauses mid-swipe is still, but not on a snap point. Zoom and fractional widths
 *  put scrollLeft a fraction of a pixel off page × width, never two. */
const ON_PAGE_PX = 2;

const LAST_PAGE = 2;
export const pageAt = (scrollLeft: number, width: number): PageIndex =>
  (width > 0 ? Math.max(0, Math.min(LAST_PAGE, Math.round(scrollLeft / width))) : 0) as PageIndex;

type Scroller = { getScrollableNode?: () => unknown };

export function HomePager() {
  const { page, setPage, pagerLocked, oddsOpen } = useSession();
  const reduced = useReducedMotion();
  // The pager's own box, not the window: inside the desktop cabinet (W1.1) they differ. The window is only the first guess,
  // for the frame before the first layout event.
  const windowWidth = useWindowDimensions().width;
  const [boxWidth, setBoxWidth] = useState(0);
  const width = boxWidth || windowWidth;
  const onLayout = (e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width);

  const ref = useRef<ScrollView>(null);
  /** Where the scroller was last put, by us or by a swipe: nothing yet on mount, so the first placement is a jump. */
  const placed = useRef<{ page: PageIndex; width: number } | null>(null);
  const tween = useRef<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = pagerLocked || oddsOpen;

  // State says which page: put the scroller there. The first placement, a new width and reduced motion jump; the rest glide.
  useEffect(() => {
    const el = (ref.current as Scroller | null)?.getScrollableNode?.() as HTMLElement | undefined;
    if (!el || !width) return;
    const was = placed.current;
    if (was && was.page === page && was.width === width) return;
    placed.current = { page, width };
    if (tween.current != null) { cancelAnimationFrame(tween.current); tween.current = null; }
    // Read where the track is BEFORE snapping comes back: with snapping on, the read itself commits the re-snap and answers the
    // nearest page (Chromium and WebKit, PR #150's review), so a glide interrupted mid-flight would restart from a page away.
    const from = el.scrollLeft, to = page * width;
    if (!was || was.width !== width || reduced || from === to) { el.style.scrollSnapType = ''; el.scrollLeft = to; return; }
    el.style.scrollSnapType = 'none';
    const started = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - started) / SWIPE_MS));
      el.scrollLeft = from + (to - from) * curve(k);
      if (k < 1) { tween.current = requestAnimationFrame(step); return; }
      tween.current = null;
      el.style.scrollSnapType = '';
    };
    tween.current = requestAnimationFrame(step);
  }, [page, width, reduced]);

  useEffect(() => () => {
    if (tween.current != null) cancelAnimationFrame(tween.current);
    if (settle.current) clearTimeout(settle.current);
  }, []);

  // A swipe says which page: tell state once the scroller has come to rest. Our own tween's scroll events, and any while the
  // pager is locked (a hand on the crank, the odds sleeve open), are not swipes. Latest values by ref: the timer outlives a render.
  // At rest, only the page on screen takes focus and presses (W1.6): Tab used to walk into the two beside it, and the browser
  // scrolls the track to whatever takes focus. While the track moves all three are live, so a tap that lands just as a swipe
  // comes to rest, before this component has heard which page it is, is not lost.
  const [moving, setMoving] = useState(false);
  const albums = useInert(!moving && page !== PAGE.albums);
  const pull = useInert(!moving && page !== PAGE.pull);
  const wallet = useInert(!moving && page !== PAGE.wallet);
  const live = useRef({ width, locked, setPage });
  useEffect(() => { live.current = { width, locked, setPage }; });
  const onScroll = () => {
    if (settle.current) clearTimeout(settle.current);
    setMoving(true);
    settle.current = setTimeout(() => {
      settle.current = null;
      setMoving(false);
      const el = (ref.current as Scroller | null)?.getScrollableNode?.() as HTMLElement | undefined;
      if (!el || !live.current.width || tween.current != null || live.current.locked) return; // no width yet: every offset would read as page 0
      const p = pageAt(el.scrollLeft, live.current.width);
      if (p === placed.current?.page || Math.abs(el.scrollLeft - p * live.current.width) > ON_PAGE_PX) return;
      placed.current = { page: p, width: live.current.width };
      live.current.setPage(p);
    }, SETTLE_MS);
  };

  return (
    <RitualProvider>
      <View style={s.pager} onLayout={onLayout}>
        <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.pager}
          scrollEnabled={!locked} onScroll={onScroll} scrollEventThrottle={16} testID="home-pager">
          {/* flex: 1, or a page is as tall as its content and its own ScrollView has nothing to scroll: on any viewport shorter
              than the page (iPhone Safari with its toolbars, 677 pt; an 800 px desktop window) the bottom was clipped for good,
              and a dispensed capsule sat under the rail out of reach (seen in the simulator's Safari, W0.3 #121). */}
          <View ref={albums} style={[s.page, { width }]}><AlbumsPage /></View>
          <View ref={pull} style={[s.page, { width }]}><PullPage /></View>
          <View ref={wallet} style={[s.page, { width }]}><WalletPage /></View>
        </ScrollView>
      </View>
    </RitualProvider>
  );
}

// overflow hidden: a child wider than the page (the spread, an address) used to widen this track, and the
// horizontal scroll then slid the machine off the screen. The page scrolls vertically inside itself.
const s = StyleSheet.create({ pager: { flex: 1 }, page: { flex: 1, overflow: 'hidden' } });
