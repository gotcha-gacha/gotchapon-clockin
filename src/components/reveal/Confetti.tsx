// Confetti (design confetti(): album milestones, the daily capsule claim, the holo slide-out): 26 pieces of 7×11 in five
// colours, scattered across the stage width, each falling 380–560 pt with 360–780° of spin over 1.3–2.1 s after up to
// 250 ms, fading out. Each new `trigger` value plays a fresh burst; the pieces are seeded by it so render stays pure.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

export const CONFETTI_COLORS = ['#FF6B5B', '#FFD23F', '#8FE3C5', '#5BB8FF', '#C9A7FF'] as const;

export type ConfettiPiece = { left: number; fall: number; spin: number; dur: number; delay: number; color: string };

/** The design's 26 pieces across `width`, reproducible for a seed. */
export function confettiPieces(width: number, seed: number): ConfettiPiece[] {
  return Array.from({ length: 26 }, (_, i) => {
    const r = (k: number) => (((Math.sin(seed * 12.9898 + i * 78.233 + k * 37.719) * 43758.5453) % 1) + 1) % 1;
    return { left: r(1) * width, fall: 380 + r(2) * 180, spin: 360 + r(3) * 420, dur: 1300 + r(4) * 800, delay: r(5) * 250, color: CONFETTI_COLORS[i % 5] };
  });
}

function Piece({ p }: { p: ConfettiPiece }) {
  const t = useSharedValue(0);
  useEffect(() => { t.set(withDelay(p.delay, withTiming(1, { duration: p.dur, easing: Easing.bezier(0.2, 0.6, 0.6, 1) }))); }, [t, p.delay, p.dur]);
  const st = useAnimatedStyle(() => ({ opacity: 1 - t.get(), transform: [{ translateY: t.get() * p.fall }, { rotate: `${t.get() * p.spin}deg` }] }));
  return <Animated.View testID="confetti-piece" style={[s.piece, { left: p.left, backgroundColor: p.color }, st]} />;
}

export function Confetti({ trigger, width }: { trigger: number; width: number }) {
  const pieces = useMemo(() => confettiPieces(width, trigger), [width, trigger]);
  if (!trigger) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => <Piece key={`${trigger}-${i}`} p={p} />)}
    </View>
  );
}

const s = StyleSheet.create({ piece: { position: 'absolute', top: -10, width: 7, height: 11, borderRadius: 2, zIndex: 9 } });
