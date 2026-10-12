// One-shot stage effects from the timing sheet: 12-dot particle burst, the white flash (graded),
// the persistent night sky (vignette 1.2 s fade + 55 falling stars, 2–5 s each), and the burn's ignition flash and
// the embers that stream into the dome (F4.2).
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { color as palette } from '@/theme/tokens';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

function Dot({ color, x, y, dist, ang, dur, size, rise = 40 }: { color: string; x: number; y: number; dist: number; ang: number; dur: number; size: number; rise?: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.set(withTiming(1, { duration: dur, easing: Easing.bezier(0.2, 0.8, 0.4, 1) })); }, [p, dur]);
  const st = useAnimatedStyle(() => ({
    opacity: 1 - p.get(),
    transform: [{ translateX: x + Math.cos(ang) * dist * p.get() }, { translateY: y + (Math.sin(ang) * dist - rise) * p.get() }, { scale: 1 - 0.8 * p.get() }],
  }));
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: color, shadowColor: color, shadowOpacity: 1, shadowRadius: 10 }, st]} />;
}

type Range = readonly [number, number];

/** Dots bursting from (x, y): by default 12, alternating the tier colour with white, 550–900 ms. The burn's ignition
 *  (F4.2) passes 22 embers in mint and pale gold that rise less. */
export function Burst({ x, y, color, seed = 1, count = 12, alt = '#fff', altEvery = 2, dist = [60, 150], dur = [550, 900], size = [6, 14], rise = 40 }: {
  x: number; y: number; color: string; seed?: number; count?: number; alt?: string; altEvery?: number; dist?: Range; dur?: Range; size?: Range; rise?: number;
}) {
  const [d0, d1] = dist;
  const [t0, t1] = dur;
  const [s0, s1] = size;
  const dots = useMemo(() => Array.from({ length: count }, (_, i) => {
    const r = (k: number) => ((Math.sin(seed * 9301 + i * 49297 + k * 233280) + 1) / 2);
    return { ang: r(1) * 6.28, dist: d0 + r(2) * (d1 - d0), dur: t0 + r(3) * (t1 - t0), size: s0 + r(4) * (s1 - s0), color: i % altEvery ? color : alt };
  }), [seed, color, count, alt, altEvery, d0, d1, t0, t1, s0, s1]);
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">{dots.map((d, i) => <Dot key={i} x={x} y={y} rise={rise} {...d} />)}</View>;
}

/** White flash, .85 → 0 over 420 ms (graded slab). */
export function Flash({ trigger }: { trigger: number }) {
  const op = useSharedValue(0);
  useEffect(() => { if (trigger) { op.set(0.85); op.set(withTiming(0, { duration: 420, easing: Easing.out(Easing.ease) })); } }, [trigger, op]);
  const st = useAnimatedStyle(() => ({ opacity: op.get() }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', zIndex: 9 }, st]} />;
}

function Star({ i, seed, height }: { i: number; seed: number; height: number }) {
  const r = (k: number) => ((Math.sin(seed * 7919 + i * 104729 + k * 1301) + 1) / 2);
  const left: `${number}%` = `${Math.round(r(1) * 100)}%`; const start = -10 - r(2) * 220; const dur = 2000 + r(3) * 3000; const delay = r(4) * 2000;
  const p = useSharedValue(0);
  useEffect(() => { p.set(withDelay(delay, withTiming(1, { duration: dur, easing: Easing.linear }))); }, [p, delay, dur]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: start + (height + 40 - start) * p.get() }], opacity: p.get() < 0.9 ? 1 : 1 - (p.get() - 0.9) * 10 }));
  return <Animated.View style={[{ position: 'absolute', left, top: 0, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fff', shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 6 }, st]} />;
}

/** Night sky, part 1: the vignette, fading in over 1.2 s. The parent renders it behind the stage (the design's
 *  z-index 0 layer) so it darkens the room, not the machine. Stays until the parent unmounts it (next pull). */
export function NightVignette() {
  const op = useSharedValue(0);
  useEffect(() => { op.set(withTiming(0.8, { duration: 1200 })); }, [op]);
  const st = useAnimatedStyle(() => ({ opacity: op.get() }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, st]} pointerEvents="none">
      <LinearGradient colors={['rgba(3,4,10,0)', 'rgba(3,4,10,0)', '#03040A']} locations={[0, 0.3, 0.9]} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/** Night sky, part 2: 55 falling stars, rendered above the stage. */
export function NightStars({ height, seed }: { height: number; seed: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: 55 }, (_, i) => <Star key={`${seed}-${i}`} i={i} seed={seed} height={height} />)}
    </View>
  );
}

/** The burn's ignition (F4.2, design doBurn step 2): a white-cored mint flash at (x, y), scale .2 → 1.4 and gone in 520 ms. */
export function Ignite({ x, y }: { x: number; y: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.set(withTiming(1, { duration: 520, easing: Easing.out(Easing.ease) })); }, [p]);
  const st = useAnimatedStyle(() => ({ opacity: 1 - p.get(), transform: [{ scale: 0.2 + 1.2 * p.get() }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - 90, top: y - 90, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(143,227,197,0.45)', alignItems: 'center', justifyContent: 'center' }, st]}>
      <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(143,227,197,0.85)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff' }} />
      </View>
    </Animated.View>
  );
}

function StreamEmber({ i, seed, height, to }: { i: number; seed: number; height: number; to: { x: number; y: number } }) {
  const r = (k: number) => ((Math.sin(seed * 6151 + i * 7727 + k * 911) + 1) / 2);
  const x0 = -40;
  const y0 = height * (0.3 + r(1) * 0.4);
  const mx = x0 + (to.x - x0) * 0.45;
  const my = y0 + (to.y - y0) * 0.5 + (r(2) * 80 - 40);
  const ex = to.x + (r(3) * 40 - 20);
  const ey = to.y + (r(4) * 30 - 15);
  const p = useSharedValue(0);
  useEffect(() => { p.set(withDelay(i * 35, withTiming(1, { duration: 820 + i * 40, easing: Easing.bezier(0.25, 0.7, 0.35, 1) }))); }, [p, i]);
  const st = useAnimatedStyle(() => {
    const t = p.get();
    return {
      // Gone on arrival: the design removes each ember at .2; one left at .2 would stay parked in the dome while armed.
      opacity: interpolate(t, [0, 0.5, 0.97, 1], [0, 1, 0.2, 0]),
      transform: [{ translateX: interpolate(t, [0, 0.5, 1], [x0, mx, ex]) }, { translateY: interpolate(t, [0, 0.5, 1], [y0, my, ey]) }, { scale: interpolate(t, [0, 1], [1, 0.3]) }],
    };
  });
  return <Animated.View style={[{ position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.mint, shadowColor: palette.mint, shadowOpacity: 0.95, shadowRadius: 10 }, st]} />;
}

/** The burn's embers streaming into the dome (F4.2, design doBurn step 3): 16 mint dots from off the left edge of a box
 *  `height` tall to (to.x, to.y), 820 ms plus 40 ms each, 35 ms apart. */
export function EmberStream({ to, height, seed = 1 }: { to: { x: number; y: number }; height: number; seed?: number }) {
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">{Array.from({ length: 16 }, (_, i) => <StreamEmber key={i} i={i} seed={seed} height={height} to={to} />)}</View>;
}
