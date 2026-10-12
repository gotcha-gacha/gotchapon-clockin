// Dome orbit rings and tray reels for the pull wait. Presentational: the host advances `reelStop` and `flash`.
// Roulette, hash and gold-sweep are not built. Reels sit in the tray mouth; rings stay on the dome.
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { REEL_COLORS, RING_FLASH_MS } from '@/ritual/rollTiming';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

const PITCH = 36;
const STRIP = 12;
const REEL_MS = [260, 320, 380] as const;
const POP = Easing.out(Easing.back(1.6));

function MiniCap({ tint }: { tint: string }) {
  return (
    <View style={s.mini}>
      <View style={[s.miniHalf, { backgroundColor: tint }]} />
      <View style={[s.miniHalf, { backgroundColor: '#E9ECF5' }]} />
    </View>
  );
}

function Reel({ index, locked }: { index: number; locked: boolean }) {
  const reduced = useReducedMotion();
  const y = useSharedValue(0);
  const pop = useSharedValue(locked ? 1 : 0);
  useEffect(() => {
    if (locked || reduced) { y.set(0); return; }
    y.set(0);
    y.set(withRepeat(withTiming(-PITCH * 10, { duration: REEL_MS[index], easing: Easing.linear }), -1));
  }, [locked, reduced, index, y]);
  useEffect(() => { if (locked) pop.set(withTiming(1, { duration: 300, easing: POP })); }, [locked, pop]);
  const spin = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const star = useAnimatedStyle(() => ({ opacity: pop.get(), transform: [{ scale: pop.get() }] }));
  const blur = Platform.OS === 'web' && !reduced && !locked ? ({ filter: 'blur(1px)' } as object) : null;
  return (
    <View testID="roll-reel" style={[s.reel, locked && s.reelLocked]}>
      {locked ? (
        <Animated.Text testID="roll-star" style={[s.star, star]}>✦</Animated.Text>
      ) : (
        <Animated.View style={[s.strip, spin, blur]}>
          {Array.from({ length: STRIP }, (_, i) => <View key={i} style={s.cell}><MiniCap tint={REEL_COLORS[(i + index) % REEL_COLORS.length]} /></View>)}
        </Animated.View>
      )}
    </View>
  );
}

function Dot() {
  const op = useSharedValue(0.35);
  useEffect(() => {
    op.set(withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [op]);
  const st = useAnimatedStyle(() => ({ opacity: op.get() }));
  return <Animated.View testID="roll-dot" style={[s.dot, st]} />;
}

/** Three reels inside the tray mouth. Reduced motion: three pulsing dots until the stop sequence locks stars. */
export function RollTray({ reelStop }: { reelStop: number }) {
  const reduced = useReducedMotion();
  return (
    <View style={s.tray} pointerEvents="none">
      {reduced && reelStop === 0 ? (
        <View style={s.dots}>{[0, 1, 2].map((i) => <Dot key={i} />)}</View>
      ) : (
        <View style={s.reels}>
          {[0, 1, 2].map((i) => <Reel key={i} index={i} locked={i < reelStop} />)}
        </View>
      )}
      <LinearGradient colors={['rgba(2,3,10,0.9)', 'rgba(2,3,10,0)', 'rgba(2,3,10,0)', 'rgba(2,3,10,0.9)']} locations={[0, 0.34, 0.66, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
    </View>
  );
}

function Ring({ inset, color: border, duration, reverse, comet, flash, flashMs }: { inset: `${number}%`; color: string; duration: number; reverse?: boolean; comet: string; flash: boolean; flashMs: number }) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduced) { turn.set(0); return; }
    turn.set(0);
    turn.set(withRepeat(withTiming(reverse ? -360 : 360, { duration, easing: Easing.linear }), -1));
  }, [reduced, reverse, duration, turn]);
  useEffect(() => {
    if (!flash) return;
    // Same half-scale as the stop phase, so a short ×1 lock does not unmount the rings mid-fade.
    const dur = Math.round(flashMs * (reduced === true ? 0.5 : 1));
    scale.set(withTiming(1.35, { duration: dur, easing: Easing.out(Easing.ease) }));
    opacity.set(withTiming(0, { duration: dur, easing: Easing.out(Easing.ease) }));
  }, [flash, flashMs, reduced, scale, opacity]);
  const st = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ rotate: `${turn.get()}deg` }, { scale: scale.get() }] }));
  return (
    <Animated.View style={[s.ring, { top: inset, left: inset, right: inset, bottom: inset, borderColor: border }, st]} pointerEvents="none">
      <View style={[s.comet, { backgroundColor: comet, shadowColor: comet }]} />
    </Animated.View>
  );
}

/** Dashed orbit rings over the dome. Buttons sit at the bottom when the wait has run long. */
export function RollDome({ flash, flashMs = RING_FLASH_MS, actions, onKeep, onNotify }: { flash: boolean; flashMs?: number; actions: boolean; onKeep?: () => void; onNotify?: () => void }) {
  const rise = useSharedValue(0);
  useEffect(() => { if (actions) rise.set(withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) })); }, [actions, rise]);
  const up = useAnimatedStyle(() => ({ opacity: rise.get(), transform: [{ translateY: (1 - rise.get()) * 8 }] }));
  return (
    <View testID="roll-churn" style={s.dome} pointerEvents="box-none">
      <View style={s.veil} pointerEvents="none" />
      <Ring inset="6%" color="rgba(255,210,63,0.55)" duration={1400} comet="#FFD23F" flash={flash} flashMs={flashMs} />
      <Ring inset="18%" color="rgba(143,227,197,0.5)" duration={1900} reverse comet="#8FE3C5" flash={flash} flashMs={flashMs} />
      {actions ? (
        <Animated.View style={[s.actions, up]} pointerEvents="box-none">
          <Pressable testID="roll-keep" onPress={onKeep} style={s.keep} accessibilityRole="button" accessibilityLabel="Keep waiting">
            <Text style={s.keepText}>Keep waiting</Text>
          </Pressable>
          <Pressable testID="roll-notify" onPress={onNotify} style={s.notify} accessibilityRole="button" accessibilityLabel="Notify me">
            <Text style={s.notifyText}>Notify me</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  tray: { position: 'absolute', left: 2, right: 2, top: 2, height: 50, zIndex: 3 },
  reels: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  reel: { width: 42, height: 40, borderRadius: 7, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: '#02030A' },
  reelLocked: { borderColor: '#FFD23F', alignItems: 'center', justifyContent: 'center', shadowColor: '#FFD23F', shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  strip: { width: 42 },
  cell: { height: PITCH, alignItems: 'center', justifyContent: 'center' },
  mini: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden' },
  miniHalf: { flex: 1 },
  star: { fontSize: 20, color: '#FFD23F', lineHeight: 24 },
  dots: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFD23F' },
  dome: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 6 },
  veil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5,7,15,0.25)' },
  ring: { position: 'absolute', borderWidth: 2, borderStyle: 'dashed', borderRadius: 999 },
  comet: { position: 'absolute', top: -5, left: '50%', marginLeft: -5, width: 10, height: 10, borderRadius: 5, shadowOpacity: 1, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  actions: { position: 'absolute', left: 10, right: 10, bottom: '14%', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  keep: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: color.yellow },
  keepText: { fontFamily: font.extrabold, fontSize: 12.5, color: color.inkOnYellow },
  notify: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: 'rgba(5,7,15,0.88)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' },
  notifyText: { fontFamily: font.extrabold, fontSize: 12.5, color: color.text },
});
