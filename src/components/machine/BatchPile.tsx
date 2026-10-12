// ×5/×10: capsules pile in the tray (design batchCaps). The whole pile drops as one settle from
// −300 px with a spin over 650 ms cubic-bezier(.3,1.3,.5,1), then a haptic on landing. Rare capsules
// show their tier colour, commons a palette colour; tap the pile to open all.
//
// One settle (Ben, 1 Oct 2026, #389). A 90 ms stagger kept every capsule but the first invisible, so
// the chute read as a single drop and the rest popped in after the plate had already switched. They
// share the drop a ×1 uses, in the same chute, and they move together.
//
// The pile mounts when the roll hands off to the drop (#335). The wait itself is the tray reels, not
// this pile. Outcomes only recolour a capsule: the drop effect does not list `outcome`, and the caller
// keeps this component mounted from the drop through the tap, so the landing does not replay.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { Outcome } from '@/api/contract';
import { ScrollHere } from '@/components/ScrollHere';
import { color, tierColor } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { CAPSULE_COLORS } from './CapsuleGlobe';
import { dropSfx, playSfx } from '@/audio/sfx';

const DROP = Easing.bezier(0.3, 1.3, 0.5, 1);

/** What the line under the pile says. `none` is a sealed pull: the page already says what happened. */
export type BatchPileLabel = 'opening' | 'tap' | 'none';

function PileCapsule({ i, n, outcome }: { i: number; n: number; outcome?: Outcome }) {
  const y = useSharedValue(-300);
  const sc = useSharedValue(0.5);
  const op = useSharedValue(0);
  const rot = useSharedValue(i * 57);
  const rare = outcome != null && outcome.rarity !== 'common';
  const capColor = outcome != null && outcome.rarity !== 'common' ? tierColor[outcome.rarity] : CAPSULE_COLORS[(i * 3 + n) % CAPSULE_COLORS.length];
  const size = n > 5 ? 42 : 52;
  const col = i % 5, row = Math.floor(i / 5);
  const x = col * (size + 4) + (row ? size / 2 : 0) + (n > 5 ? 6 : 16);
  const top = row * (size * 0.62) + (n > 5 ? 20 : 40);
  const restRot = ((i * 37) % 40) - 20;

  // `outcome` is not a dependency: it arrives when the pull lands, and the colour updates in render.
  // No per-capsule delay: a stagger left one capsule in the chute and popped the rest in later (#389).
  useEffect(() => {
    y.set(withTiming(0, { duration: 650, easing: DROP }));
    sc.set(withTiming(1, { duration: 650, easing: DROP }));
    op.set(withTiming(1, { duration: 120 }));
    rot.set(withTiming(restRot, { duration: 650, easing: DROP }));
    const t = setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); playSfx(dropSfx(i)); }, 560);
    return () => clearTimeout(t);
  }, [i, y, sc, op, rot, restRot]);

  const st = useAnimatedStyle(() => ({ opacity: op.get(), transform: [{ translateY: y.get() }, { rotate: `${rot.get()}deg` }, { scale: sc.get() }] }));
  return (
    <Animated.View testID="pile-capsule" style={[s.cap, { left: x, top, width: size, height: size, borderRadius: size / 2, shadowColor: rare ? capColor : '#000', shadowOpacity: rare ? 0.7 : 0.6 }, st]}>
      <View testID="pile-cap-top" style={[s.half, { top: 0, height: size / 2, backgroundColor: capColor, borderTopLeftRadius: size / 2, borderTopRightRadius: size / 2 }]} />
      <View style={[s.half, { bottom: 0, height: size / 2, backgroundColor: '#E8ECF6', borderBottomLeftRadius: size / 2, borderBottomRightRadius: size / 2 }]} />
      <View style={[s.shine, { left: size * 0.22, top: size * 0.12, width: size * 0.3, height: size * 0.2, borderRadius: size * 0.15 }]} />
    </Animated.View>
  );
}

export function BatchPile({ count = 0, outcomes, onOpen, label }: { count?: number; outcomes?: readonly Outcome[]; onOpen: () => void; label?: BatchPileLabel }) {
  const n = outcomes?.length ? outcomes.length : count;
  const mode: BatchPileLabel = label ?? (outcomes?.length ? 'tap' : 'opening');
  const pulse = useSharedValue(1);
  useEffect(() => { pulse.set(withRepeat(withSequence(withTiming(1.06, { duration: 700, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) })), -1)); }, [pulse]);
  const hint = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  if (n < 1) return null;
  // One Pressable, and one host element, for the whole life of the pile. On the web a `button` role is a
  // `<button>` and `text` is a `<div>`; swapping them when the pile becomes tappable remounts every capsule
  // and plays the drop again under the tap line (#389). The role stays `button`. A tap before `tap` is a no-op.
  const open = () => { if (mode === 'tap') onOpen(); };
  return (
    <>
      {/* Where the pile rests, so a short browser scrolls to the tray while the capsules are still falling (web only). */}
      <ScrollHere top={480} height={160} testID="batch-rest" />
      <Pressable
        onPress={open}
        disabled={mode !== 'tap'}
        style={s.wrap}
        accessibilityRole="button"
        accessibilityLabel={mode === 'tap' ? `Open all ${n} capsules` : mode === 'opening' ? `Opening ${n}…` : `${n} capsules`}
        accessibilityState={{ disabled: mode !== 'tap' }}
        testID="batch-pile"
      >
        {Array.from({ length: n }, (_, i) => <PileCapsule key={i} i={i} n={n} outcome={outcomes?.[i]} />)}
        {mode === 'tap' ? <Animated.Text testID="batch-pile-status" style={[s.hint, hint]}>Tap the pile to open all {n}</Animated.Text> : null}
        {mode === 'opening' ? <Text testID="batch-pile-status" style={s.quiet}>Opening {n}…</Text> : null}
      </Pressable>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: '50%', top: 480, marginLeft: -120, width: 240, height: 130, zIndex: 5 },
  cap: { position: 'absolute', overflow: 'hidden', shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  half: { position: 'absolute', left: 0, right: 0 },
  shine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: '-18deg' }] },
  hint: { position: 'absolute', left: 0, right: 0, bottom: -26, textAlign: 'center', fontFamily: font.extrabold, fontSize: 12, color: '#FFE9A3', textShadowColor: 'rgba(255,210,63,0.5)', textShadowRadius: 10 },
  quiet: { position: 'absolute', left: 0, right: 0, bottom: -26, textAlign: 'center', fontFamily: font.semibold, fontSize: 12, color: color.text2 },
});
