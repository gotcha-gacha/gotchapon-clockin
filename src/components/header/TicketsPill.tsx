// Header raffle-ticket pill. Pops once when a revealed pull adds tickets (paid slots or the streak bonus).
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { font } from '@/theme/fonts';
import { color } from '@/theme/tokens';
import { ticketsA11y } from './streakCopy';
import { TicketMark } from './TicketMark';

const spring = Easing.bezier(0.3, 1.6, 0.5, 1);

export function TicketsPill({ count, popToken, onPress }: { count: number; popToken: number; onPress: () => void }) {
  const reduced = useReducedMotion() === true;
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!popToken || reduced) return;
    glow.set(1);
    scale.set(1);
    scale.set(withTiming(1.15, { duration: 300, easing: spring }));
    const back = setTimeout(() => { scale.set(withTiming(1, { duration: 180 })); glow.set(0); }, 450);
    return () => clearTimeout(back);
  }, [glow, popToken, reduced, scale]);
  const pop = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
    shadowOpacity: 0.15 + glow.get() * 0.65,
    shadowRadius: 10 + glow.get() * 8,
  }));
  return (
    <Animated.View style={[s.wrap, pop]}>
      <Pressable accessibilityRole="button" accessibilityLabel={ticketsA11y(count)} onPress={onPress} style={s.pill}>
        <LinearGradient colors={['rgba(255,230,128,0.18)', 'rgba(255,210,63,0.08)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <TicketMark width={20} height={14} notch={4} />
        <Text style={s.count}>{count}</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexGrow: 0, flexShrink: 0, borderRadius: 99,
    shadowColor: '#FFD23F', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },
  pill: {
    height: 32, borderRadius: 99, paddingLeft: 6, paddingRight: 10, gap: 6, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,210,63,0.55)', overflow: 'hidden',
  },
  count: { fontFamily: font.black, fontSize: 12, color: color.marqueeInk },
});
