// Batch spread (F2.7): the pile opens into a 5-wide deal (.45 s, 55 ms stagger). Commons land face
// up; rares face down on the card back and flip on tap (.55 s) or "Flip all" (lowest rarity first,
// 260 ms apart). New = tier ring + pulse; extra = dimmed. Every flip plays its tier's haptic; holo+
// shakes the stage, ultra+ turns the night on, graded flashes.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, type AnimatedStyle, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { Outcome, Tier } from '@/api/contract';
import { TIER, hexGlow, playPattern } from './tiers';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { playSfx, tierSfx } from '@/audio/sfx';

const DEAL = Easing.bezier(0.2, 0.9, 0.2, 1);
const FLIP = Easing.bezier(0.3, 0.9, 0.3, 1);
const SPREAD_TOP = 96;

/** "N new · N extra(s) · N rare(s)" — the spread's hint and the Pull page's result bar share it. */
export function spreadSummary(outcomes: Outcome[]) {
  const fresh = outcomes.filter((o) => !o.isDupe && o.rarity === 'common').length;
  const dupes = outcomes.filter((o) => o.isDupe).length;
  const rares = outcomes.filter((o) => o.rarity !== 'common').length;
  const text = `${fresh} new${dupes ? ` · ${dupes} extra${dupes > 1 ? 's' : ''}` : ''}${rares ? ` · ${rares} rare${rares > 1 ? 's' : ''}` : ''}`;
  return { fresh, dupes, rares, text };
}

function CardBack({ glow, style, active }: { glow: string; style: StyleProp<AnimatedStyle<ViewStyle>>; active: boolean }) {
  const pulse = useSharedValue(1);
  // The medallion pulses only while the back is the visible face; a flipped card's back would animate unseen.
  useEffect(() => {
    if (!active) { cancelAnimation(pulse); pulse.set(1); return; }
    pulse.set(withRepeat(withSequence(withTiming(1.06, { duration: 700, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) })), -1));
  }, [active, pulse]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  return (
    <Animated.View style={[s.face, s.back, { shadowColor: glow }, style]}>
      <LinearGradient colors={['#1B2A6B', '#4A2C8F', '#2A5AC9', '#5A2E9E', '#1B2A6B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={s.backHalo} />
      <View style={s.backFrame} />
      <Animated.View style={[s.medallionRing, st]} />
      <Animated.View style={[s.medallion, st]}><Text style={s.medallionText}>GC</Text></Animated.View>
    </Animated.View>
  );
}

function SpreadCard({ o, i, flipped, onFlip, w }: { o: Outcome; i: number; flipped: boolean; onFlip: (i: number) => void; w: number }) {
  const spec = TIER[o.rarity];
  const rot = useSharedValue(180); // deal-in starts flipped
  const dy = useSharedValue(48);
  const op = useSharedValue(0);
  const face = useSharedValue(flipped ? 0 : 180); // 0 = front up
  const pulse = useSharedValue(1);
  const isNew = !o.isDupe && spec.lvl < 1;
  const isDupe = o.isDupe && spec.lvl < 1;
  useEffect(() => {
    const d = i * 55;
    rot.set(withDelay(d, withTiming(0, { duration: 450, easing: DEAL })));
    dy.set(withDelay(d, withTiming(0, { duration: 450, easing: DEAL })));
    op.set(withDelay(d, withTiming(1, { duration: 200 })));
    if (isNew) pulse.set(withDelay(d + 450, withRepeat(withSequence(withTiming(1.04, { duration: 800 }), withTiming(1, { duration: 800 })), 3)));
  }, [i, rot, dy, op, pulse, isNew]);
  useEffect(() => { face.set(withTiming(flipped ? 0 : 180, { duration: 550, easing: FLIP })); }, [flipped, face]);
  const wrap = useAnimatedStyle(() => ({ opacity: op.get(), transform: [{ translateY: dy.get() }, { scale: pulse.get() }] }));
  // Each face carries its own rotateY: iOS flattens a view's children into its plane, so a rotation
  // on the shared wrapper would show the front mirrored instead of hiding it (backfaceVisibility
  // only honours the rotated view's own transform).
  const frontFace = useAnimatedStyle(() => ({ transform: [{ perspective: 900 }, { rotateY: `${rot.get() + face.get()}deg` }] }));
  const backFace = useAnimatedStyle(() => ({ transform: [{ perspective: 900 }, { rotateY: `${rot.get() + face.get() + 180}deg` }] }));
  const h = (w * 7) / 5;
  return (
    <Pressable onPress={() => onFlip(i)} disabled={flipped} style={{ width: w, height: h }} accessibilityRole="button" accessibilityLabel={flipped ? o.card.name : 'Flip card'}>
      <Animated.View style={[{ width: w, height: h }, wrap]}>
        {/* front */}
        {/* The design's frontVis: an unflipped rare's front stays invisible — during the first frames of
            the deal the wrapper angle passes 360°, where backfaceVisibility alone would show the art. */}
        <Animated.View testID={`card-front-${i}`} style={[s.face, { borderColor: isNew ? spec.glow : spec.lvl >= 1 ? spec.glow : 'rgba(255,255,255,0.25)', shadowColor: spec.lvl >= 1 ? spec.glow : '#000', opacity: !flipped ? 0 : isDupe ? 0.55 : 1 }, frontFace]}>
          <Image source={{ uri: o.card.imgSmall }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={o.card.name} />
          {isDupe ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,14,26,0.35)' }]} /> : null}
          {isNew ? <View style={s.newDot} /> : null}
          {isDupe ? <View style={s.extraChip}><Text style={s.extraText}>extra</Text></View> : null}
        </Animated.View>
        {/* back */}
        <CardBack glow={spec.lvl >= 1 ? hexGlow(spec.glow) : 'rgba(0,0,0,0)'} style={backFace} active={!flipped} />
      </Animated.View>
    </Pressable>
  );
}

type SpreadProps = {
  outcomes: Outcome[];
  width: number;
  onFlipped: (rarity: Tier) => void;
  onShake: () => void;
  onFlash: () => void;
  onAllFlipped: () => void;
};

export function Spread({ outcomes, width, onFlipped, onShake, onFlash, onAllFlipped }: SpreadProps) {
  const [flipped, setFlipped] = useState<boolean[]>(() => outcomes.map((o) => TIER[o.rarity].lvl < 1));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { playSfx('pop2'); }, []); // the pile opens into the deal
  const cardW = (width - 8 * 4) / 5;
  const rows = Math.ceil(outcomes.length / 5);

  // Side effects stay outside the state updater (an updater may run twice under StrictMode).
  const flippedRef = useRef(flipped); // flip() is the only writer and updates the ref before the state
  const flip = useCallback((i: number) => {
    if (flippedRef.current[i]) return;
    const n = flippedRef.current.slice(); n[i] = true;
    flippedRef.current = n;
    setFlipped(n);
    const spec = TIER[outcomes[i].rarity];
    playPattern(spec.buzz);
    playSfx(tierSfx(outcomes[i].rarity));
    if (spec.lvl >= 2) onShake();
    if (spec.lvl === 4) onFlash();
    onFlipped(outcomes[i].rarity);
  }, [outcomes, onShake, onFlash, onFlipped]);

  const remaining = flipped.filter((x) => !x).length;
  useEffect(() => { if (remaining === 0) onAllFlipped(); }, [remaining, onAllFlipped]);

  const flipAll = () => {
    const idx = outcomes.map((o, i) => (flipped[i] ? -1 : i)).filter((i) => i >= 0).sort((a, b) => TIER[outcomes[a].rarity].lvl - TIER[outcomes[b].rarity].lvl);
    idx.forEach((i, k) => timers.current.push(setTimeout(() => flip(i), k * 260)));
  };

  const summary = spreadSummary(outcomes);
  const hintText = summary.rares ? `${summary.text} — tap to flip` : summary.text;
  const hintTop = SPREAD_TOP + rows * ((cardW * 7) / 5 + 8) + 6;

  return (
    <View style={[StyleSheet.absoluteFill]} pointerEvents="box-none">
      <View style={[s.grid, { top: SPREAD_TOP, width }]}>
        {outcomes.map((o, i) => <SpreadCard key={i} o={o} i={i} flipped={flipped[i]} onFlip={flip} w={cardW} />)}
      </View>
      {remaining > 0 ? (
        <View style={[s.hintWrap, { top: hintTop }]}>
          <Text style={s.hintText}>{hintText}</Text>
          <Pressable onPress={flipAll} style={({ pressed }) => [s.flipAll, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button"><Text style={s.flipAllText}>Flip all</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { position: 'absolute', left: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 8, zIndex: 6 },
  face: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 7, overflow: 'hidden', borderWidth: 2, backgroundColor: '#F7F8FC', backfaceVisibility: 'hidden', shadowOpacity: 0.55, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  back: { borderColor: color.goldTrim, alignItems: 'center', justifyContent: 'center' },
  backHalo: { position: 'absolute', left: '15%', right: '15%', top: '20%', height: '45%', borderRadius: 999, backgroundColor: 'rgba(120,180,255,0.3)' },
  backFrame: { position: 'absolute', left: 4, right: 4, top: 4, bottom: 4, borderRadius: 4, borderWidth: 2, borderColor: '#E0B84A' },
  medallion: { width: 34, height: 34, borderRadius: 17, backgroundColor: color.yellow, borderWidth: 2, borderColor: '#7A5A12', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 8 },
  medallionText: { fontFamily: font.black, fontSize: 13, color: '#3A2A0A', letterSpacing: -0.5 },
  medallionRing: { position: 'absolute', width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(255,210,63,0.5)' },
  newDot: { position: 'absolute', top: 3, left: 3, width: 8, height: 8, borderRadius: 4, backgroundColor: color.mint, shadowColor: color.mint, shadowOpacity: 1, shadowRadius: 6 },
  extraChip: { position: 'absolute', top: 2, left: 2, borderRadius: 99, paddingVertical: 1, paddingHorizontal: 5, backgroundColor: 'rgba(10,14,31,0.85)' },
  extraText: { fontFamily: font.black, fontSize: 7.5, color: color.text2 },
  hintWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8, zIndex: 6 },
  hintText: { fontFamily: font.bold, fontSize: 12, color: color.marqueeInk, textShadowColor: 'rgba(255,210,63,0.6)', textShadowRadius: 10 },
  flipAll: { borderWidth: 1, borderColor: 'rgba(255,233,163,0.5)', backgroundColor: 'rgba(255,210,63,0.14)', borderRadius: 99, paddingVertical: 8, paddingHorizontal: 16 },
  flipAllText: { fontFamily: font.black, fontSize: 12.5, color: color.marqueeInk },
});
