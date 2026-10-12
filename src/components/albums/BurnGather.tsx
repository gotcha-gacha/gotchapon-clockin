// The burn's first second and a half (F4.2, design doBurn steps 1–2), over the Albums page: five extras lift out of the
// shelf, gather in the middle of the screen, turn mint and shrink into an ignition flash with 22 embers. The ritual host
// slides to the machine at 1.5 s, where the embers stream into the dome.
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAppFrame, useGestureScale } from '@/state/appFrame';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import type { BurnStep } from '@/ritual/reducer';
import { Burst, Ignite } from '@/components/reveal/effects';
import { playPattern } from '@/components/reveal/tiers';
import { color } from '@/theme/tokens';
import { THUMB_GAP, THUMB_H, THUMB_W, type ExtraRef, type Rect } from './ExtrasCard';
import { playSfx } from '@/audio/sfx';

const THUMB_STEP = THUMB_W + THUMB_GAP;

/** The five copies the hand-off lifts: the design takes the first five thumbnails; a card with several extras fills in. */
export function burnCopies(extras: ExtraRef[]): { ref: ExtraRef; slot: number }[] {
  const out: { ref: ExtraRef; slot: number }[] = [];
  extras.forEach((ref, slot) => { for (let k = 0; k < ref.count && out.length < 5; k++) out.push({ ref, slot }); });
  return out;
}

function GatherCopy({ i, uri, x0, y0, cx, cy }: { i: number; uri: string; x0: number; y0: number; cx: number; cy: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.set(withDelay(i * 60, withTiming(1, { duration: 1000, easing: Easing.bezier(0.3, 0.8, 0.3, 1) }))); }, [p, i]);
  const ang = (i - 2) * 0.22;
  const dx = cx - x0 - THUMB_W / 2;
  const dy = cy - y0 - THUMB_H / 2;
  const move = useAnimatedStyle(() => {
    const t = p.get();
    return {
      opacity: interpolate(t, [0, 0.85, 1], [1, 1, 0]),
      transform: [
        { translateX: interpolate(t, [0, 0.55, 0.85, 1], [0, dx + (i - 2) * 14, dx + (i - 2) * 4, dx]) },
        { translateY: interpolate(t, [0, 0.55, 1], [0, dy, dy]) },
        { scale: interpolate(t, [0, 0.55, 0.85, 1], [1, 1.9, 1.7, 0.2]) },
        { rotate: `${interpolate(t, [0, 0.55, 0.85, 1], [0, ang, ang * 0.3, 0])}rad` },
      ],
    };
  });
  const tint = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0, 0.55, 0.85, 1], [0, 0, 0.7, 0.9]) }));
  return (
    <Animated.View testID="burn-copy" style={[s.copy, { left: x0, top: y0 }, move]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <Animated.View style={[StyleSheet.absoluteFill, s.tint, tint]} />
    </Animated.View>
  );
}

export function BurnGather({ step, extras, from }: { step: BurnStep; extras: ExtraRef[]; from: Rect | null }) {
  const { width, height } = useAppFrame();
  const root = useRef<View>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  // The shelf is measured when Burn is pressed; if that never answers, lift the copies from the bottom of the screen.
  const [fallback, setFallback] = useState(false);
  useEffect(() => { const t = setTimeout(() => setFallback(true), 80); return () => clearTimeout(t); }, []);
  const copies = burnCopies(extras);
  const count = copies.length;
  const k = useGestureScale(); // glass pixels → app points: 1 on a phone
  const cx = width / 2;
  const cy = height * 0.42;
  // A light tick as each copy lifts (design: 12 ms × 5), then the ignition's double beat.
  useEffect(() => {
    const ticks = Array.from({ length: count }, (_, i) => setTimeout(() => { playPattern([12]); playSfx('tick'); }, i * 60 + 200));
    return () => ticks.forEach(clearTimeout);
  }, [count]);
  const ignited = step !== 'gather';
  useEffect(() => { if (ignited) { playPattern([30, 20, 60]); playSfx('shimmer'); } }, [ignited]);
  return (
    <View ref={root} style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={() => root.current?.measureInWindow((x, y) => setOrigin({ x, y }))}>
      {from || fallback ? copies.map((c, i) => (
        <GatherCopy
          key={i}
          i={i}
          uri={c.ref.imgSmall}
          // `measureInWindow` answers in glass pixels (getBoundingClientRect), and these are offsets in the app's own points:
          // inside the web's scaled cabinet the copies lifted from a point compressed by the cabinet's scale (PR #157's review).
          x0={from ? (from.x - origin.x) * k + Math.min(c.slot, 4) * THUMB_STEP : cx - 2.5 * THUMB_STEP + i * THUMB_STEP}
          y0={from ? (from.y - origin.y) * k : height * 0.78}
          cx={cx}
          cy={cy}
        />
      )) : null}
      {ignited ? <Ignite x={cx} y={cy} /> : null}
      {ignited ? <Burst x={cx} y={cy} color={color.mint} alt="#FFE9A3" altEvery={3} count={22} dist={[40, 130]} dur={[600, 1000]} size={[4, 11]} rise={30} seed={7} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  copy: { position: 'absolute', width: THUMB_W, height: THUMB_H, borderRadius: 4, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 10 } },
  tint: { backgroundColor: color.mint },
});
