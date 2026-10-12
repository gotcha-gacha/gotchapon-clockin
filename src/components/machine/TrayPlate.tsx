// Cream plate under the dispense tray (#359). One fixed box: the label and dot
// swap inside it, so a new message never moves the tray or anything under it.
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { Phase } from '@/ritual/reducer';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { plateFlickerSteps, trayPlateState } from './trayPlateState';

const FLICKER = plateFlickerSteps();
const POINTER = Platform.OS === 'web' ? { cursor: 'pointer' as const } : null;
// RN's View types omit `dataSet`; react-native-web turns it into `data-noswipe`. Native never receives it.
const NOSWIPE = (Platform.OS === 'web' ? { dataSet: { noswipe: '1' } } : null) as ViewProps | null;

function StatusDot({ tint }: { tint: string }) {
  const reduced = useReducedMotion() === true;
  const op = useSharedValue(1);
  useEffect(() => {
    if (reduced) { op.set(1); return; }
    op.set(withRepeat(
      withSequence(...FLICKER.map((step) => withTiming(step.opacity, { duration: step.duration, easing: Easing.linear }))),
      -1,
    ));
  }, [reduced, op]);
  const fade = useAnimatedStyle(() => ({ opacity: op.get() }));
  // Web takes `boxShadow` only (`shadow*` is deprecated there). Native keeps the shadow props beside it.
  const glow = Platform.OS === 'web'
    ? { backgroundColor: tint, boxShadow: `0 0 8px ${tint}` }
    : { backgroundColor: tint, shadowColor: tint, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, boxShadow: `0 0 8px ${tint}` };
  return (
    <Animated.View style={[fade, s.noHit]}>
      <View testID="tray-plate-dot" style={[s.dot, glow]} />
    </Animated.View>
  );
}

function PlateBody({ label, dot }: { label: string; dot: string }) {
  return (
    <>
      <LinearGradient testID="tray-plate-fill" colors={[color.cream, color.creamDeep]} style={s.fill}>
        <View style={s.hiTop} />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.2)']} style={s.hiBottom} />
      </LinearGradient>
      <View testID="tray-plate-row" style={s.row}>
        <StatusDot tint={dot} />
        <Text testID="tray-plate-label" numberOfLines={1} style={s.label}>{label}</Text>
      </View>
    </>
  );
}

export function TrayPlate({ phase, balanceUsd, freePulls, onTopUp, balanceKnown = true, targeted = false }: {
  phase: Phase;
  balanceUsd: number;
  freePulls: number;
  onTopUp: () => void;
  /** False while the session is still loading the wallet. A default 0 is not "top up". */
  balanceKnown?: boolean;
  /** Chase: the plate counts $1.50 pulls, the same number as the dial. */
  targeted?: boolean;
}) {
  const status = trayPlateState(phase, balanceUsd, freePulls, balanceKnown, targeted);
  const body = <PlateBody label={status.label} dot={status.dot} />;
  // data-noswipe: a drag that starts on the plate is not a page swipe (the design's attribute).
  if (status.topUp) {
    return (
      <Pressable
        testID="tray-plate"
        {...NOSWIPE}
        accessibilityRole="button"
        accessibilityLabel={status.label}
        onPress={onTopUp}
        style={[s.plate, POINTER]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View testID="tray-plate" {...NOSWIPE} style={s.plate}>
      {body}
    </View>
  );
}

const RADIUS = {
  borderTopLeftRadius: 8,
  borderTopRightRadius: 8,
  borderBottomLeftRadius: 22,
  borderBottomRightRadius: 22,
} as const;

const s = StyleSheet.create({
  plate: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 8,
    height: 36,
    ...RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { ...StyleSheet.absoluteFill, ...RADIUS, overflow: 'hidden', pointerEvents: 'none' },
  hiTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.7)' },
  hiBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, maxWidth: '100%', pointerEvents: 'none' },
  noHit: { pointerEvents: 'none' },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: {
    fontFamily: font.black,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.6,
    color: '#2A2F45',
    includeFontPadding: false,
    flexShrink: 1,
  },
});
