// Header streak pill (header_streak_tickets.md). The five dots are Pull-only so the other pages stay inside 430pt.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { playSfx } from '@/audio/sfx';
import { displayStreakDay } from '@/season/streak';
import { font } from '@/theme/fonts';
import { color } from '@/theme/tokens';
import { streakA11y, streakDots, type StreakFace } from './streakCopy';

const ease = Easing.inOut(Easing.ease);

export function StreakPill({ streak, showDots, open, onPress, live = true }: { streak: StreakFace; showDots: boolean; open: boolean; onPress: () => void; live?: boolean }) {
  const reduced = useReducedMotion() === true;
  const day = displayStreakDay(streak);
  const bob = useSharedValue(0);
  const chevron = useSharedValue(open ? 180 : 0);
  // While the balance is unread the whole frame is one blurred bitmap. A bob under that blur repaints the viewport.
  const bobbing = live && !streak.countedToday && !reduced;
  useEffect(() => {
    if (!bobbing) { bob.set(0); return; }
    bob.set(withRepeat(withSequence(
      withTiming(-2, { duration: 800, easing: ease }),
      withTiming(0, { duration: 800, easing: ease }),
    ), -1));
  }, [bob, bobbing]);
  useEffect(() => {
    if (reduced) { chevron.set(open ? 180 : 0); return; }
    chevron.set(withTiming(open ? 180 : 0, { duration: 200 }));
  }, [chevron, open, reduced]);
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.get() }] }));
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${chevron.get()}deg` }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={streakA11y(day)}
      accessibilityState={{ expanded: open }}
      onPress={() => { playSfx('tick'); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={({ pressed }) => [s.pill, pressed && s.pressed]}
    >
      <LinearGradient colors={['rgba(255,154,91,0.2)', 'rgba(255,107,91,0.1)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Animated.View style={bobbing ? bobStyle : undefined} testID={bobbing ? 'streak-capsule-bob' : 'streak-capsule'}>
        <LinearGradient colors={['#FF9A5B', '#FF9A5B', '#F4F6FB', '#F4F6FB']} locations={[0, 0.5, 0.5, 1]} style={s.capsule}>
          <View style={s.capsuleShade} />
        </LinearGradient>
      </Animated.View>
      <Text style={s.label}>{day}/5</Text>
      {showDots ? (
        <View style={s.dots}>
          {streakDots(streak).map((dot, i) => <Dot key={i} kind={dot} reduced={reduced || !live} />)}
        </View>
      ) : null}
      <Animated.Text style={[s.chevron, chevronStyle]}>▾</Animated.Text>
    </Pressable>
  );
}

function Dot({ kind, reduced }: { kind: 'done' | 'next' | 'future'; reduced: boolean }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (kind !== 'next' || reduced) { pulse.set(1); return; }
    pulse.set(withRepeat(withSequence(
      withTiming(0.35, { duration: 700, easing: ease }),
      withTiming(1, { duration: 700, easing: ease }),
    ), -1));
  }, [kind, pulse, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return <Animated.View testID={`streak-dot-${kind}`} style={[s.dot, kind === 'done' ? s.dotDone : kind === 'next' ? s.dotNext : s.dotFuture, style]} />;
}

const s = StyleSheet.create({
  pill: {
    flexGrow: 0, flexShrink: 0, height: 32, borderRadius: 99, paddingLeft: 5, paddingRight: 10, gap: 7,
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,138,91,0.6)',
    overflow: 'hidden',
    shadowColor: '#FF6B5B', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
  },
  pressed: { transform: [{ scale: 0.97 }] },
  capsule: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden', shadowColor: '#FF6B5B', shadowOpacity: 0.7, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  capsuleShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 11, backgroundColor: 'rgba(6,8,18,0.12)' },
  label: { fontFamily: font.black, fontSize: 12, color: color.text },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
  dotDone: { backgroundColor: '#FF9A5B', borderColor: '#FF9A5B' },
  dotNext: { borderColor: '#FFD23F', backgroundColor: 'transparent' },
  dotFuture: { borderColor: 'rgba(255,176,138,0.45)', backgroundColor: 'transparent' },
  chevron: { fontSize: 9, color: '#FFB08A', lineHeight: 12 },
});
