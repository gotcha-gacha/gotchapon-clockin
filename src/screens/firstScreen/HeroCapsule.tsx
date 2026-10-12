// The hero of the first screen (#211, branded #345): the open-ring G at 170 pt, a foil sheen only on that ring,
// two rings breathing out of it, and the sway. The red/white capsule and the ghost card are gone (Poké Ball).
//
// `arming` plays the CTA's beat, the brief's "anticipation morph": the rings stop, a gold flare blooms, the machine's mouth
// opens below, and the mark lifts 26 pt before dropping into it at .42 scale — the design's `pbArm` keyframes at 0 / 35% /
// 100% of 780 ms. FirstScreen owns that clock, so the sound and the auth sheet that follows stay in one place.
//
// Reduced motion keeps the mark still and the rings off, and still plays the arming beat: the brief allows it, because it
// is short and the user asked for it by pressing.
import React, { useEffect, useId } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { HeroG } from '@/brand/HeroG';
import { annulus, SHEEN_INSET, sheenLayer } from '@/screens/firstScreen/sheenRing';

export const CAPSULE = 170;
/** The arming beat, from the design's `pbArm .78s` (FirstScreen waits the same time before the sheet). */
export const ARM_MS = 780;
const RING_MS = 2800;
const NUDGE_RING_MS = 1100;
/** The design's `pbRattle`: six throws, ending where it started. */
export const RATTLE_MS = 600;
const SWAY_HALF = 2100; // pbSway is 4.2 s there and back
const SHEEN_MS = 3400;

type Props = {
  arming: boolean;
  reduced: boolean;
  /** How far the mark falls into the mouth, and where the mouth sits under it: measured from the stage (`FirstScreen`). */
  drop: number;
  mouthTop: number;
  /** The rattle of a tapped mark (#211 slice C); it plays under reduced motion too, being short and asked for. */
  rattling: boolean;
  /** The idle nudge: the rings quicken from 2.8 s to 1.1 s until the next touch. */
  nudge: boolean;
  /** Where the pointer is, as −0.5…0.5 of the window. The mark leans towards it and the sheen follows. */
  tilt: { x: SharedValue<number>; y: SharedValue<number> };
};

/** One of the two rings breathing out of the hero: it fades as it grows, and the arming beat takes both away. */
function Ring({ v, arm, style }: { v: SharedValue<number>; arm: SharedValue<number>; style: ViewStyle }) {
  const st = useAnimatedStyle(() => {
    if (arm.get() > 0) return { opacity: 0, transform: [{ scale: 0.7 }] };
    const k = v.get();
    return { opacity: 0.55 * (1 - k), transform: [{ scale: 0.7 + 1.2 * k }] };
  });
  return <Animated.View style={[s.ring, style, st]} />;
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Sheen clipped to the ring. The mask stays put; the band is what moves. */
function RingSheen({ sheen, tiltX }: { sheen: SharedValue<number>; tiltX: SharedValue<number> }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const mask = `${raw}m`;
  const grad = `${raw}s`;
  const layer = sheenLayer(CAPSULE);
  const band = annulus(layer);
  const props = useAnimatedProps(() => ({
    x: interpolate(sheen.get(), [0, 1], [-CAPSULE, CAPSULE]) + tiltX.get() * 80,
  }));
  return (
    <Svg testID="hero-sheen" width={layer} height={layer} style={s.sheen} pointerEvents="none">
      <Defs>
        <Mask id={mask}>
          <Circle cx={band.cx} cy={band.cy} r={band.r} stroke="#fff" strokeWidth={band.stroke} fill="none" />
        </Mask>
        <SvgLinearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#fff" stopOpacity="0" />
          <Stop offset="0.48" stopColor="#fff" stopOpacity="0.55" />
          <Stop offset="0.52" stopColor="#8FE3C5" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#fff" stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>
      <AnimatedRect animatedProps={props} y={0} width={CAPSULE * 0.8} height={layer} fill={`url(#${grad})`} mask={`url(#${mask})`} />
    </Svg>
  );
}

export function HeroCapsule({ arming, reduced, drop, mouthTop, rattling, nudge, tilt }: Props) {
  const sway = useSharedValue(0);
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);
  const sheen = useSharedValue(0);
  const arm = useSharedValue(0);
  const rattle = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    sway.set(withRepeat(withTiming(1, { duration: SWAY_HALF, easing: Easing.inOut(Easing.ease) }), -1, true));
    sheen.set(withRepeat(withTiming(1, { duration: SHEEN_MS, easing: Easing.inOut(Easing.ease) }), -1));
  }, [reduced, sway, sheen]);

  // The rings restart when the nudge changes their speed, which is the only way to re-time a running repeat.
  useEffect(() => {
    if (reduced) return;
    const ms = nudge ? NUDGE_RING_MS : RING_MS;
    ring1.set(0);
    ring1.set(withRepeat(withTiming(1, { duration: ms, easing: Easing.out(Easing.ease) }), -1));
    ring2.set(0);
    ring2.set(withDelay(ms / 2, withRepeat(withTiming(1, { duration: ms, easing: Easing.out(Easing.ease) }), -1)));
  }, [reduced, nudge, ring1, ring2]);

  // Six throws over 600 ms, ending where it started.
  useEffect(() => {
    if (!rattling) { rattle.set(0); return; }
    rattle.set(0);
    rattle.set(withTiming(1, { duration: RATTLE_MS, easing: Easing.bezier(0.3, 0.7, 0.3, 1) }));
  }, [rattling, rattle]);

  // The beat runs forward only. Coming out of it the mark snaps back to rest rather than rising again, because by then the
  // auth sheet is over it and an animated return would be a bounce nobody asked for, seen for a frame at the sheet's edges.
  useEffect(() => {
    if (arming) arm.set(withTiming(1, { duration: ARM_MS, easing: Easing.bezier(0.4, 0, 0.6, 1) }));
    else arm.set(0);
  }, [arming, arm]);

  // The whole hero leans towards the pointer: the pack's ±11 px, ±7 px and 3° over a window's width and height.
  const lean = useAnimatedStyle(() => ({
    transform: [
      { translateX: tilt.x.get() * 22 },
      { translateY: tilt.y.get() * 14 },
      { rotate: `${tilt.x.get() * 6}deg` },
    ],
  }));

  const hero = useAnimatedStyle(() => {
    const a = arm.get();
    if (a > 0) {
      return {
        transform: [
          { translateY: interpolate(a, [0, 0.35, 1], [0, -26, drop]) },
          { scale: interpolate(a, [0, 0.35, 1], [1, 1.06, 0.42]) },
          { rotate: `${interpolate(a, [0, 0.35, 1], [0, -8, 24])}deg` },
        ],
      };
    }
    const swayK = sway.get();
    const k = rattle.get();
    // `pbRattle`'s six keyframes, decaying; at rest (k = 0 or 1) it contributes nothing.
    const shake = k > 0 && k < 1 ? Math.sin(k * Math.PI * 6) * (1 - k) : 0;
    return {
      transform: [
        { translateX: shake * 7 },
        { translateY: -10 * swayK + shake * 2 },
        { rotate: `${-3 + 6 * swayK + shake * 7}deg` },
      ],
    };
  });
  const flare = useAnimatedStyle(() => {
    const a = arm.get();
    return { opacity: interpolate(a, [0, 0.01, 0.4, 1], [0, 0, 1, 0]), transform: [{ scale: interpolate(a, [0, 1], [0.6, 1.5]) }] };
  });
  const mouth = useAnimatedStyle(() => {
    const a = arm.get();
    return { opacity: interpolate(a, [0, 0.38, 1], [0, 1, 1]), transform: [{ scaleX: interpolate(a, [0, 0.38, 1], [0.6, 1, 1]) }] };
  });

  const webShadow = Platform.OS === 'web'
    ? ({ filter: 'drop-shadow(0 22px 34px rgba(0,0,0,0.65)) drop-shadow(0 0 26px rgba(255,107,91,0.4))' } as object)
    : null;

  return (
    <Animated.View style={[s.stage, lean]} pointerEvents="none" testID="hero-mark">
      <Ring v={ring1} arm={arm} style={s.ringCoral} />
      <Ring v={ring2} arm={arm} style={s.ringGold} />
      {/* The arming flare: gold at the centre falling to nothing at 70%, so it reads as light and not as a yellow disc. */}
      <Animated.View style={[s.flare, flare]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="ga-flare" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFD23F" stopOpacity="0.75" />
              <Stop offset="0.45" stopColor="#FF6B5B" stopOpacity="0.35" />
              <Stop offset="0.7" stopColor="#FF6B5B" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#ga-flare)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[s.mouth, { top: CAPSULE + mouthTop }, mouth]} />
      <Animated.View style={[s.hero, webShadow, hero]}>
        {Platform.OS === 'web' ? null : <View style={s.glow} pointerEvents="none" />}
        <HeroG size={CAPSULE} />
        <RingSheen sheen={sheen} tiltX={tilt.x} />
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  stage: { width: CAPSULE, height: CAPSULE, alignItems: 'center', justifyContent: 'center' },
  hero: { width: CAPSULE, height: CAPSULE },
  glow: {
    position: 'absolute',
    left: 25,
    top: 36,
    width: 120,
    height: 90,
    borderRadius: 60,
    backgroundColor: 'rgba(255,107,91,0.22)',
    shadowColor: '#FF6B5B',
    shadowOpacity: 0.4,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 22 },
  },
  sheen: { position: 'absolute', left: SHEEN_INSET, top: SHEEN_INSET },
  ring: { position: 'absolute', width: CAPSULE + 60, height: CAPSULE + 60, borderRadius: (CAPSULE + 60) / 2, borderWidth: 1.5 },
  ringCoral: { borderColor: 'rgba(255,107,91,0.5)' },
  ringGold: { borderColor: 'rgba(255,210,63,0.45)' },
  flare: { position: 'absolute', width: CAPSULE + 120, height: CAPSULE + 120 },
  mouth: { position: 'absolute', width: 140, height: 34, borderRadius: 70, backgroundColor: '#02030A', borderWidth: 3, borderColor: 'rgba(255,210,63,0.35)' },
});
