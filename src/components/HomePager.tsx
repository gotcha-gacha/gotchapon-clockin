// The three-page horizontal track (Albums · Pull · Wallet). Odds is a sleeve on Pull, not a page.
// Native pager; the platform owns the swipe curve and the end-of-track bounce (design: 380 ms
// cubic-bezier(.25,.8,.3,1), overscroll ×0.3).
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import PagerView, { type PagerViewProps } from 'react-native-pager-view';
import { useSession, type PageIndex } from '@/state/session';
import { RitualProvider } from '@/ritual/useRitual';
import { AlbumsPage } from '@/screens/AlbumsPage';
import { PullPage } from '@/screens/PullPage';
import { WalletPage } from '@/screens/WalletPage';

export function HomePager() {
  const { page, setPage, pagerLocked, oddsOpen } = useSession();
  const ref = useRef<PagerView>(null);
  const lastNative = useRef<PageIndex>(page);
  // PagerView reads `initialPage` once, at mount: the session's page at that moment (the landing page, #210; or wherever a
  // remount finds it). Every later change goes through the effect below. State, not a ref: the compiler lint forbids a
  // ref read in render, and a state initialiser is the same one-time read.
  const [initialPage] = useState(page);

  // Dots (or anything else) changed the page in state → move the pager.
  useEffect(() => {
    if (lastNative.current !== page) ref.current?.setPage(page);
  }, [page]);

  const onPageSelected: PagerViewProps['onPageSelected'] = (e) => {
    const p = e.nativeEvent.position as PageIndex;
    lastNative.current = p;
    setPage(p);
  };

  return (
    <RitualProvider>
      {/* oddsOpen is the design's data-noswipe: the sleeve is a Pull overlay, so the track must not move under it. */}
      <PagerView ref={ref} style={s.pager} initialPage={initialPage} overdrag scrollEnabled={!pagerLocked && !oddsOpen} onPageSelected={onPageSelected}>
        <AlbumsPage key="albums" />
        <PullPage key="pull" />
        <WalletPage key="wallet" />
      </PagerView>
    </RitualProvider>
  );
}

const s = StyleSheet.create({ pager: { flex: 1 } });
