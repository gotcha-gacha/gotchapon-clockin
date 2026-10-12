// The dispensed capsule (F2.4 drop + F2.5 scratch-to-crack). Drops 300 px from scale .45 over
// 750 ms cubic-bezier(.3,1.35,.5,1), lands with a 20 ms haptic and pulses. A Skia cover is erased
// 2.8 % per stroke sample until the tier's threshold (.28 / .34 / .42 / .5 / .55); a light haptic
// on about half the strokes; three quick taps also crack it (the design's fallback). Scratchable
// only once the commit has returned (`interactive`). All stroke state lives on the UI thread. A hand on the
// capsule locks the pager (`onActive`), so a horizontal rub is never taken as a page swipe.
//
// This file imports Skia, so on the web it may only be loaded once CanvasKit is (W0.2d, #138): nothing imports it statically
// there. Native reaches it through ScratchCapsule.tsx, the web through ScratchCapsule.web.tsx (which falls back to TapCapsule).
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas, Group, Path, Rect, Skia } from '@shopify/react-native-skia';
import Animated, { Easing, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { Tier } from '@/api/contract';
import { TIER, hexGlow } from './tiers';
import { font } from '@/theme/fonts';
import { playSfx, scratchSfx } from '@/audio/sfx';
import { useGestureScale } from '@/state/appFrame';

const SIZE = 88;
const DROP = Easing.bezier(0.3, 1.35, 0.5, 1);
const hapticRub = () => { void Haptics.selectionAsync(); };
const hapticTap = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

/** Every other scratch stroke: the rub haptic and its tick (design 900–1300 Hz, cycling through the pitches), in one hop to JS. */
const rub = (n: number) => { hapticRub(); playSfx(scratchSfx(n)); };

/** `capProps`: extra props for the capsule's own view. The web passes a key handler (space / enter opens it); native passes nothing. */
export function SkiaScratchCapsule({ tier, shellColor, interactive, onCrack, onActive, capProps }: { tier: Tier | null; shellColor?: string; interactive: boolean; onCrack: () => void; onActive?: (active: boolean) => void; capProps?: object }) {
  const y = useSharedValue(-300);
  const scale = useSharedValue(0.45);
  const pulse = useSharedValue(1);
  const jiggle = useSharedValue(0);
  const builder = useSharedValue(Skia.PathBuilder.Make());
  const path = useDerivedValue(() => builder.get().build());
  const scratched = useSharedValue(0);
  const cracked = useSharedValue(false);
  const strokes = useSharedValue(0);
  const lastX = useSharedValue(0), lastY = useSharedValue(0), hasLast = useSharedValue(false);
  const live = useSharedValue(interactive);
  useEffect(() => { live.set(interactive); }, [interactive, live]);
  // Cracking unmounts the capsule mid-rub, before the gesture finalizes: release the pager on the way out.
  useEffect(() => () => { onActive?.(false); }, [onActive]);
  const spec = tier ? TIER[tier] : TIER.common;
  // Chosen once, at mount. A later tier must not repaint the shell between the drop and the rub.
  const [shell] = useState(() => shellColor ?? spec.glow);
  const need = spec.scratchNeed;

  useEffect(() => {
    y.set(withTiming(0, { duration: 750, easing: DROP }));
    scale.set(withTiming(1, { duration: 750, easing: DROP }));
    const t = setTimeout(() => {
      hapticTap();
      playSfx('land');
      pulse.set(withDelay(200, withRepeat(withSequence(withTiming(1.06, { duration: 650, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) })), -1)));
    }, 760);
    return () => clearTimeout(t);
  }, [y, scale, pulse]);

  const scratchAt = (x: number, yy: number) => {
    'worklet';
    if (!live.get() || cracked.get()) return;
    builder.modify((b) => { b.addCircle(x, yy, 11); return b; });
    scratched.set(scratched.get() + 0.028);
    strokes.set(strokes.get() + 1);
    if (strokes.get() % 2 === 0) { runOnJS(rub)(strokes.get() / 2); } // "about half the strokes" — deterministic, the compiler forbids Math.random here
    if (scratched.get() >= need) { cracked.set(true); runOnJS(onCrack)(); }
  };

  const k = useGestureScale(); // glass pixels → the capsule's own points (see useGestureScale)
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      if (onActive) runOnJS(onActive)(true);
      hasLast.set(true); lastX.set(e.x * k); lastY.set(e.y * k);
      scratchAt(e.x * k, e.y * k);
    })
    .onUpdate((e) => {
      if (!hasLast.get()) return;
      if (Math.hypot(e.x * k - lastX.get(), e.y * k - lastY.get()) < 4) return;
      lastX.set(e.x * k); lastY.set(e.y * k);
      scratchAt(e.x * k, e.y * k);
    })
    .onFinalize(() => { hasLast.set(false); if (onActive) runOnJS(onActive)(false); });

  // The design's fallback: three quick taps crack it. A native tap recogniser keeps timing off the JS side.
  const tap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(180)
    .onEnd((_e, success) => {
      if (!success || !live.get() || cracked.get()) return;
      runOnJS(hapticTap)();
      jiggle.set(withSequence(withTiming(-6, { duration: 90 }), withTiming(0, { duration: 170 })));
    });
  const triple = Gesture.Tap()
    .numberOfTaps(3)
    .maxDuration(200)
    .onEnd((_e, success) => {
      if (!success || !live.get() || cracked.get()) return;
      cracked.set(true);
      runOnJS(onCrack)();
    });
  const gesture = Gesture.Simultaneous(pan, tap, triple);

  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() + jiggle.get() }, { scale: scale.get() * pulse.get() }] }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: scratched.get() > 0 ? 0 : 1 }));

  return (
    <Animated.View style={[s.wrap, st]}>
      <GestureDetector gesture={gesture}>
        <View style={[s.cap, { shadowColor: shell }]} accessible accessibilityRole="button" accessibilityLabel="Scratch the capsule" {...capProps}>
          {/* what the scratch reveals: a glow and a sleeved card */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B0E1A', alignItems: 'center', justifyContent: 'center' }]}>
            <View style={[s.innerGlow, { backgroundColor: hexGlow(spec.glow) }]} />
            <View style={s.innerCard} />
          </View>
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Group layer>
              <Rect x={0} y={0} width={SIZE} height={SIZE / 2} color={shell} />
              <Rect x={0} y={SIZE / 2} width={SIZE} height={SIZE / 2} color="#E8ECF6" />
              <Path path={path} color="black" blendMode="clear" />
            </Group>
          </Canvas>
          <View style={s.shine} pointerEvents="none" />
          <Animated.Text style={[s.hint, hintStyle]} pointerEvents="none">{interactive ? 'rub' : '…'}</Animated.Text>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: '50%', top: 516, marginLeft: -SIZE / 2, width: SIZE, height: SIZE, zIndex: 5 },
  cap: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', shadowOpacity: 0.7, shadowRadius: 30, shadowOffset: { width: 0, height: 14 } },
  innerGlow: { position: 'absolute', width: SIZE * 1.4, height: SIZE * 1.4, borderRadius: SIZE, opacity: 0.8 },
  innerCard: { width: 44, height: 60, borderRadius: 5, backgroundColor: '#F7F8FC', borderWidth: 3, borderColor: '#C9A44C', shadowColor: '#fff', shadowOpacity: 0.5, shadowRadius: 14 },
  shine: { position: 'absolute', left: 15, top: 9, width: 28, height: 19, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: '-18deg' }] },
  hint: { position: 'absolute', left: 0, right: 0, top: SIZE / 2 - 8, textAlign: 'center', fontFamily: font.extrabold, fontSize: 12, color: 'rgba(10,14,31,0.55)' },
});
