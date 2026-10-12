// Keyboard focus on the web (W1.6, #139). react-native-web has no prop for either of these, and a ref to a View IS its element.
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

/** While `on`, nothing inside the view can take focus, be pressed, or be read out (the `inert` attribute). For what is drawn
 *  but is not the thing in front: a page beside the one on screen, the app under the onboarding sheet. Without it Tab walks
 *  into them: the first keyboard run pressed the Albums tab *through* the onboarding sheet. */
export function useInert(on: boolean): RefObject<View | null> {
  const ref = useRef<View>(null);
  // Every commit, not only when the flag changes: the view can arrive after the flag did (Home draws nothing while it asks
  // whether another tab is active, and onboarding may already be up when it answers).
  useEffect(() => { (ref.current as unknown as HTMLElement | null)?.toggleAttribute('inert', on); });
  return ref;
}
/** A ref for a view that takes keyboard focus each time it APPEARS, without scrolling to it (`ScrollHere` owns what is in
 *  view). A callback ref, not an effect on the owner's mount: the first version only worked when the view was there on its
 *  owner's first commit, which the ×1 card's Into binder is and the ×5 / ×10 spread's is not (it waits for every card to be
 *  flipped), so after a batch the keyboard was left on the body with the bridge inert (PR #162's review, seen in Chromium).
 *  The callback is stable, so a re-render is not an appearance: focus the user has moved stays moved. A pointer user sees
 *  nothing: the ring is `:focus-visible` only. */
export function useFocusWhenShown(): (el: View | null) => void {
  return useCallback((el: View | null) => { (el as unknown as HTMLElement | null)?.focus({ preventScroll: true }); }, []);
}
