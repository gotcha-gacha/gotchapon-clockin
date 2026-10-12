// The capsule without Skia (W0.2d, #138; Ben, 17 Sept: "tap / space to open"). Same drop, landing and pulse as the scratch
// capsule (SkiaScratchCapsule.tsx: the numbers are the design's and are repeated here, not shared, so the native capsule stays
// untouched), and one press opens it: a tap, a click, or space / enter on the focused button. It is the web's capsule whenever
// CanvasKit is not ready, and the keyboard's way in. No imitation of the scratch: the outcome was decided when the commit
// returned, so opening it this way is exactly as faithful.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { Tier } from '@/api/contract';
import { TIER, hexGlow } from './tiers';
import { font } from '@/theme/fonts';
import { playSfx } from '@/audio/sfx';

const SIZE = 88;
const DROP = Easing.bezier(0.3, 1.35, 0.5, 1);
const hapticTap = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

export function TapCapsule({ tier, shellColor, interactive, onCrack }: { tier: Tier | null; shellColor?: string; interactive: boolean; onCrack: () => void; onActive?: (active: boolean) => void }) {
  const y = useSharedValue(-300);
  const scale = useSharedValue(0.45);
  const pulse = useSharedValue(1);
  const opened = useRef(false);
  const spec = tier ? TIER[tier] : TIER.common;
  // Chosen once, at mount. A later tier must not repaint the shell between the drop and the rub.
  const [glow] = useState(() => shellColor ?? spec.glow);

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

  // Only once the commit has returned (`interactive`), and only once: a second press while the card is on its way changes nothing.
  const open = () => {
    if (!interactive || opened.current) return;
    opened.current = true;
    hapticTap();
    onCrack();
  };

  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }, { scale: scale.get() * pulse.get() }] }));

  return (
    <Animated.View style={[s.wrap, st]}>
      <Pressable onPress={open} disabled={!interactive} style={[s.cap, { shadowColor: glow }]} accessibilityRole="button" accessibilityLabel="Open the capsule" accessibilityState={{ disabled: !interactive }} testID="tap-capsule">
        <View testID="capsule-top" style={[s.half, { top: 0, backgroundColor: glow }]} />
        <View style={[s.half, { bottom: 0, backgroundColor: '#E8ECF6' }]} />
        <View style={[s.seam, { backgroundColor: hexGlow(glow) }]} />
        <View style={s.shine} pointerEvents="none" />
        <Text style={s.hint}>{interactive ? 'tap' : '…'}</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: '50%', top: 516, marginLeft: -SIZE / 2, width: SIZE, height: SIZE, zIndex: 5 },
  cap: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', shadowOpacity: 0.7, shadowRadius: 30, shadowOffset: { width: 0, height: 14 } },
  half: { position: 'absolute', left: 0, right: 0, height: SIZE / 2 },
  seam: { position: 'absolute', left: 0, right: 0, top: SIZE / 2 - 1, height: 2, opacity: 0.6 },
  shine: { position: 'absolute', left: 15, top: 9, width: 28, height: 19, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: '-18deg' }] },
  hint: { position: 'absolute', left: 0, right: 0, top: SIZE / 2 - 8, textAlign: 'center', fontFamily: font.extrabold, fontSize: 12, color: 'rgba(10,14,31,0.55)' },
});
