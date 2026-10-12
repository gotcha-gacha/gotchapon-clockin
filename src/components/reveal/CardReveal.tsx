// The reveal (F2.5): the card fills the stage where the capsule was; entrance, haptics, bloom and
// screen shake scale with rarity; below it the album strip shows the slot it fills (commons) and the
// progress line; "Into binder" (F2.6) shrinks the card into its slot over 560 ms.
import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, runOnJS } from 'react-native-reanimated';
import { PRODUCT_NAME } from '@/brand/name';
import type { Album, Holding, Outcome } from '@/api/contract';
import { TIER, playPattern } from './tiers';
import { albumProgress } from '@/components/albums/AlbumsGrid';
import { Foil } from './Foil';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { playSfx, tierSfx } from '@/audio/sfx';

const CARD_W = 200, CARD_H = 280, CARD_TOP = 106, STRIP_TOP = 398, SLOT_W = 44, SLOT_H = 62;
const ENTER = Easing.bezier(0.2, 0.9, 0.2, 1);
const SETTLE = Easing.bezier(0.4, 0, 0.6, 1);

type RevealProps = {
  outcome: Outcome;
  album: Album | null;
  holdings: Record<string, Holding>;
  /** Increment to start the Into-binder shrink; `onSettled` fires when it lands. */
  settle: number;
  onSettled: () => void;
  onShake: () => void;
  onFlash: () => void;
  stageWidth: number;
};

export function CardReveal({ outcome, album, holdings, settle, onSettled, onShake, onFlash, stageWidth }: RevealProps) {
  const spec = TIER[outcome.rarity];
  const dur = spec.dur * 1000;
  const ty = useSharedValue(160), tx = useSharedValue(0), sc = useSharedValue(0.3), ry = useSharedValue(180), op = useSharedValue(0), bloom = useSharedValue(0);
  const centerX = stageWidth / 2;

  // Strip: five album slots around the new card's slot (commons only).
  const slot = album?.cards.find((c) => c.id === outcome.cardId)?.slot ?? null;
  const start = slot !== null ? Math.min(Math.max(slot - 3, 0), 20) : 0;
  const strip = album && slot !== null ? album.cards.slice(start, start + 5) : [];
  const newIdx = strip.findIndex((c) => c.id === outcome.cardId);
  const held = album ? albumProgress(album, holdings).have : 0;
  const progress = spec.lvl >= 1 ? `${spec.tag} · ${outcome.card.set} ${outcome.card.number} · kept in your rares` : album ? `${album.title} · ${held}/25 collected` : '';

  useEffect(() => {
    ty.set(withTiming(0, { duration: dur, easing: ENTER })); sc.set(withTiming(1, { duration: dur, easing: ENTER })); ry.set(withTiming(0, { duration: dur, easing: ENTER })); op.set(withTiming(1, { duration: dur * 0.6 }));
    playPattern(spec.buzz);
    playSfx(tierSfx(outcome.rarity));
    if (spec.lvl >= 2) { bloom.set(withDelay(60, withSequence(withTiming(1, { duration: dur * 0.75 }), withTiming(0, { duration: dur * 0.75 })))); onShake(); }
    if (spec.lvl === 4) onFlash();
  }, [dur, spec, ty, sc, ry, op, bloom, onShake, onFlash, outcome.rarity]);

  useEffect(() => {
    if (!settle) return;
    // Target: the highlighted strip slot (commons) or the binder off-stage (rares).
    const target = newIdx >= 0
      ? { dx: (newIdx - 2) * (SLOT_W + 7), dy: STRIP_TOP + 9 + SLOT_H / 2 - (CARD_TOP + CARD_H / 2), sc: SLOT_W / CARD_W }
      : { dx: -30, dy: 300, sc: 0.22 };
    tx.set(withTiming(target.dx, { duration: 560, easing: SETTLE }));
    ty.set(withTiming(target.dy, { duration: 560, easing: SETTLE }));
    sc.set(withTiming(target.sc, { duration: 560, easing: SETTLE }));
    op.set(withSequence(withTiming(0.9, { duration: 400 }), withTiming(0, { duration: 160 }, (done) => { if (done) runOnJS(onSettled)(); })));
  }, [settle, newIdx, tx, ty, sc, op, onSettled]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: op.get(), transform: [{ perspective: 900 }, { translateX: tx.get() }, { translateY: ty.get() }, { scale: sc.get() }, { rotateY: `${ry.get()}deg` }] }));
  const bloomStyle = useAnimatedStyle(() => ({ opacity: bloom.get() }));
  const graded = outcome.rarity === 'graded';
  const border = spec.lvl >= 2 ? '#F2B8D0' : color.goldTrim;
  const tagBg = spec.lvl >= 2 ? spec.glow : '#D6E8FF';
  const tagInk = spec.lvl >= 3 ? '#FFFFFF' : color.inkOnYellow;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[s.wrap, { left: centerX - CARD_W / 2 }, cardStyle]}>
        {graded ? (
          <>
            <View style={s.case} />
            <View style={s.plate}><Text style={s.plateText}>{PRODUCT_NAME} grade 9.5</Text><Text style={s.plateCert}>cert {outcome.serial?.split('-').pop() ?? ''}</Text></View>
          </>
        ) : null}
        <View style={s.tags} pointerEvents="none">
          <View style={[s.tag, { backgroundColor: tagBg, shadowColor: spec.glow }]}><Text style={[s.tagText, { color: tagInk }]}>{spec.tag.toUpperCase()}</Text></View>
          {outcome.isDupe ? <View style={[s.tag, { backgroundColor: color.mint }]}><Text style={[s.tagText, { color: color.inkOnMint }]}>EXTRA</Text></View> : null}
        </View>
        <View style={[s.card, { borderColor: border, shadowColor: spec.glow }]}>
          <Image source={{ uri: outcome.card.imgLarge }} style={s.img} resizeMode="cover" accessibilityLabel={outcome.card.name} />
          {spec.foil > 0 ? <Foil width={CARD_W - 12} height={CARD_H - 12} intensity={spec.foil} radius={10} /> : null}
          <Animated.View pointerEvents="none" style={[s.bloom, bloomStyle]} />
        </View>
      </Animated.View>

      {strip.length ? (
        <View style={[s.strip, { left: centerX - (5 * SLOT_W + 4 * 7 + 18) / 2 }]}>
          {strip.map((c, i) => {
            const isNew = i === newIdx;
            const have = !isNew && (holdings[c.id]?.qty ?? 0) > 0;
            return (
              <View key={c.id} style={[s.slot, isNew ? s.slotNew : have ? s.slotHave : s.slotEmpty]}>
                {have ? <Image source={{ uri: c.imgSmall }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={s.slotNo}>{isNew ? '' : c.slot}</Text>}
              </View>
            );
          })}
        </View>
      ) : null}
      <Text style={s.progress}>{progress}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', top: CARD_TOP, width: CARD_W, height: CARD_H, zIndex: 6 },
  case: { position: 'absolute', left: -12, right: -12, top: -38, bottom: -12, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(255,255,255,0.05)', shadowColor: color.rimCoral, shadowOpacity: 0.35, shadowRadius: 44 },
  plate: { position: 'absolute', left: -12, right: -12, top: -38, height: 30, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: '#E8ECF6', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 },
  plateText: { fontFamily: font.black, fontSize: 10, color: color.inkOnYellow },
  plateCert: { fontFamily: font.mono, fontWeight: '700', fontSize: 10, color: color.inkOnYellow },
  tags: { position: 'absolute', left: 0, right: 0, top: -34, flexDirection: 'row', gap: 6, justifyContent: 'center', zIndex: 7 },
  tag: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 99, shadowOpacity: 0.6, shadowRadius: 16 },
  tagText: { fontFamily: font.black, fontSize: 11, letterSpacing: 0.6 },
  card: { width: CARD_W, height: CARD_H, borderRadius: 16, backgroundColor: '#F7F8FC', borderWidth: 6, overflow: 'hidden', shadowOpacity: 0.6, shadowRadius: 40, shadowOffset: { width: 0, height: 24 } },
  img: { position: 'absolute', left: -6, top: -6, width: CARD_W, height: CARD_H, borderRadius: 16 },
  bloom: { position: 'absolute', left: -40, right: -40, top: -40, bottom: -40, borderRadius: 200, backgroundColor: 'rgba(255,230,140,0.75)' },
  strip: { position: 'absolute', top: STRIP_TOP, flexDirection: 'row', gap: 7, padding: 9, borderRadius: 14, backgroundColor: 'rgba(10,14,30,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', zIndex: 6 },
  slot: { width: SLOT_W, height: SLOT_H, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  slotNew: { backgroundColor: 'rgba(143,227,197,0.12)', borderWidth: 1.5, borderColor: color.mint, shadowColor: color.mint, shadowOpacity: 0.6, shadowRadius: 14 },
  slotHave: { backgroundColor: '#F7F8FC', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  slotEmpty: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)' },
  slotNo: { fontFamily: font.bold, fontSize: 10, color: color.text3 },
  progress: { position: 'absolute', left: 0, right: 0, top: 488, textAlign: 'center', fontFamily: font.bold, fontSize: 11.5, color: color.text2, zIndex: 6 },
});
