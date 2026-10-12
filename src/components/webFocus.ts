// Keyboard focus is a web matter (W1.6, #139): on a phone these do nothing. The web versions are in webFocus.web.ts.
import { useCallback, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

/** While `on`, nothing inside the view can take focus, be pressed, or be read out: it is behind something. */
export function useInert(on: boolean): RefObject<View | null> {
  void on;
  return useRef<View>(null);
}
/** A ref for a view that takes keyboard focus each time it appears. */
export function useFocusWhenShown(): (el: View | null) => void {
  return useCallback(() => {}, []);
}
