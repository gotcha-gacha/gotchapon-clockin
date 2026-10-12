// The signed-in app while the wallet has not been read. `session.ready` is the wrong gate: a dropped pre-sign-in 401
// sets `ready` with `balanceUsd` still at its initial 0. `balanceKnown` flips in the same commit as that balance.
//
// The frost is the whole app frame, not a blur on the machine. A `filter` on the machine rasterizes that box only,
// so the bowl goes soft and the header, the daily pill, the red casing, the room and the rail stay sharp.
//
// `backdrop-filter` on a veil over that frame is not enough either. The rail is its own layer (absolute, z-index,
// shadow). Hit-testing puts the veil above it, and the header behind the veil goes soft, but Chrome still composites
// the rail sharp. The blur has to be on the frame that *contains* the header, the pages and the rail, so they are
// one bitmap. The veil is only the dim, and it fades with that blur.
// Native has no backdrop blur without a new package; the veil is a full-screen dim there, and the frame is not blurred.
// The machine still withholds 0 / TOP UP / OUT OF PULLS (`balanceKnown` on Machine).
import React, { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/** How long the frost takes to lift once the balance is known. Web only; native and reduced motion drop it at once. */
export const HYDRATION_FADE_MS = 280;
/** Above the header (3) and the rail (8), under onboarding (12) and the session error card (20). */
export const HYDRATION_VEIL_Z = 10;
const BLUR = 'blur(18px)';

/** Blur the app frame (header, pages, rail, its own background) while `hydrating`, then ease it off.
 *  `ref` is the view that contains those, not the dim veil. */
export function useHydrationFrost(hydrating: boolean, ref: RefObject<View | null>) {
  const reduced = useReducedMotion() === true;
  const fade = Platform.OS === 'web' && !reduced;
  // idle → on (blur held) → lifting (blur easing to 0) → done (styles cleared). A known wallet stays idle.
  const phase = useRef<'idle' | 'on' | 'lifting' | 'done'>('idle');

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.style) return;
    if (hydrating) {
      phase.current = 'on';
      // No fade-in: the frost is there on the first paint of the signed-in app.
      // The attribute is what pageCss uses to flatten transformed layers under this blur.
      document.documentElement.setAttribute('data-balance-pending', '');
      el.style.transitionProperty = 'filter';
      el.style.transitionDuration = '0ms';
      el.style.transitionTimingFunction = 'ease-out';
      el.style.filter = BLUR;
      el.setAttribute('data-frost', BLUR);
      return;
    }
    if (phase.current !== 'on' && phase.current !== 'lifting') return;
    el.style.transitionProperty = 'filter';
    el.style.transitionDuration = fade ? `${HYDRATION_FADE_MS}ms` : '0ms';
    el.style.transitionTimingFunction = 'ease-out';
    if (phase.current === 'on') {
      // The duration has to be in effect before the value changes, or the same frame snaps.
      void el.offsetWidth;
      phase.current = 'lifting';
    }
    el.style.filter = 'blur(0px)';
    el.setAttribute('data-frost', 'blur(0px)');
  });

  useEffect(() => {
    if (hydrating || Platform.OS !== 'web') return;
    if (phase.current === 'idle') return;
    const el = ref.current as unknown as HTMLElement | null;
    const id = setTimeout(() => {
      phase.current = 'done';
      if (!el?.style) return;
      el.style.filter = '';
      el.style.transitionProperty = '';
      el.style.transitionDuration = '';
      el.removeAttribute('data-frost');
      document.documentElement.removeAttribute('data-balance-pending');
    }, fade ? HYDRATION_FADE_MS : 0);
    return () => clearTimeout(id);
  }, [hydrating, fade, ref]);

}

export function PullHydration({ hydrating }: { hydrating: boolean }) {
  const reduced = useReducedMotion() === true;
  const fade = Platform.OS === 'web' && !reduced;
  const ref = useRef<View>(null);
  // Stays up through the fade after `hydrating` drops. A wallet that is already known never mounts it.
  const [present, setPresent] = useState(hydrating);
  if (hydrating && !present) setPresent(true);

  useEffect(() => {
    if (hydrating) return;
    // Native, and web with reduced motion, have no opacity transition: drop it on the next turn.
    const id = setTimeout(() => setPresent(false), fade ? HYDRATION_FADE_MS : 0);
    return () => clearTimeout(id);
  }, [hydrating, fade]);

  // Opacity is applied here, after the transition, so the lift eases. A re-render writes the style
  // object without opacity; this puts the transition back and then the opacity.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.style) return;
    el.style.transitionProperty = 'opacity';
    el.style.transitionDuration = fade ? `${HYDRATION_FADE_MS}ms` : '0ms';
    el.style.transitionTimingFunction = 'ease-out';
    if (!hydrating) void el.offsetWidth;
    el.style.opacity = hydrating ? '1' : '0';
  });

  if (!present) return null;
  return (
    <View
      ref={ref}
      testID="pull-hydrating"
      accessible={hydrating ? true : undefined}
      accessibilityLabel={hydrating ? 'Loading pulls' : undefined}
      accessibilityState={hydrating ? { busy: true } : undefined}
      aria-busy={hydrating ? true : undefined}
      // Opacity stays off this object. RN writes the style, then the layout effect sets the transition
      // and only then the opacity, so the lift eases instead of snapping in the same assignment.
      style={[s.veil, { pointerEvents: hydrating ? 'auto' : 'none' }]}
    />
  );
}

const s = StyleSheet.create({
  veil: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: HYDRATION_VEIL_Z,
    // roomDeep at 42%. With the blur this is the glass; on native it is the whole dim.
    backgroundColor: 'rgba(6,8,18,0.42)',
  },
});
