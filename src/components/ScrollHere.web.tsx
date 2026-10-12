// A still, invisible box in the stage that the page scrolls to when it mounts (W0.3, #121). A browser window is often shorter
// than the machine: iPhone Safari with its toolbars shows 677 pt of an 865 pt page, and what the ritual puts on the stage next
// (the capsule at the bottom of it, then the card at the top) lands outside the window: seen in the simulator's Safari. The
// thing itself is usually mid-animation when it mounts (the capsule is 300 px above where it will land), so the page scrolls to
// where it will rest. A window the page fits in has nothing to scroll.
//
// It must never move the three-page track, and `inline: 'nearest'` does not promise that: `nearest` scrolls the least it can, and
// from another page the least is a whole page (PR #155's review ran it: parked on Albums, the same call took the track to Pull).
// So the box is only scrolled to when it is already on screen sideways; then `nearest` has nothing to do.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { ScrollHereProps } from './ScrollHere';

export function ScrollHere({ top, height, testID }: ScrollHereProps) {
  const ref = useRef<View>(null);
  useEffect(() => {
    const el = ref.current as unknown as (HTMLElement & { scrollIntoView?: (o: object) => void }) | null;
    const box = el?.getBoundingClientRect?.();
    // "On screen" means inside the three-page track's own box, not the window: in the desktop cabinet the track is 300-odd px of
    // a 1440 px window, and a neighbouring page's box is off the track while well inside the window (PR #157's review measured it;
    // the keyboard's arrow keys, W1.2, are what can turn the page while a capsule is on its way).
    const track = el?.closest?.('[data-testid="home-pager"]')?.getBoundingClientRect?.();
    const left = track ? track.left : 0, right = track ? track.right : window.innerWidth;
    if (!box || box.left < left - 1 || box.right > right + 1) return; // on another page of the track: leave everything where it is
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; // an effect only ever runs in a browser
    el?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, []);
  return <View ref={ref} style={{ position: 'absolute', left: '50%', top, height, width: 2, marginLeft: -1 }} pointerEvents="none" testID={testID} />;
}
