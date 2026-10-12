// The shareable pull card (F2.11, #221): what a holo-or-better reveal hands to the share sheet — the card with its foil,
// its tier, where it is kept, and the gachapon mark. Laid out at 4:5 (the pack's share aspect) and captured at
// 1080×1350, which is this frame at 3×, so every device ships the same PNG (`Share Card.dc.html` variant 1a). Variant
// 1b, the gold win, is Season One (#82). It renders off stage and is captured with view-shot, so its foil is `still`:
// a capture freezes one frame.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Outcome } from '@/api/contract';
import { TIER } from './tiers';
import { Foil } from './Foil';
import { BrandLockup } from '@/brand/Wordmark';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

/** Layout points. 360×450 is 4:5; `SHARE_CAPTURE` is that frame at 3×. */
export const SHARE_W = 360;
export const SHARE_H = 450;
/** The PNG `captureRef` is asked for. view-shot resizes the view's bitmap to this, so a @2x phone does not ship 720×900. */
export const SHARE_CAPTURE = { width: 1080, height: 1350 } as const;
const CARD_W = 176, CARD_H = 246;
/** The same band the card detail and the album takeover use. */
const SHEEN = ['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)'] as const;

/** Where the pulled card went. Only holo-and-above is shared, and the contract gives those no album slot, so this is
 *  always the rares line; a card that fills an album slot gets its album's progress when sharing reaches commons. */
export const shareLine = (outcome: Outcome) => `${TIER[outcome.rarity].tag} · kept in my rares`;

export function ShareCard({ outcome }: { outcome: Outcome }) {
  const spec = TIER[outcome.rarity];
  return (
    <View testID="share-poster" style={s.poster}>
      <LinearGradient colors={[color.roomMid, color.roomDeep]} style={StyleSheet.absoluteFill} />
      <View style={[s.tag, { backgroundColor: spec.glow }]}><Text style={s.tagText}>{spec.tag.toUpperCase()}</Text></View>
      <View style={[s.card, { shadowColor: spec.glow }]}>
        <Image source={{ uri: outcome.card.imgLarge }} style={s.img} resizeMode="cover" accessibilityLabel={outcome.card.name} />
        {/* Under the foil, so a foil that draws simply covers it. It is what the picture shows when the shader does not
            compile (CLAUDE.md: Skia's Make throws on device) or if a capture ever loses the Skia layer — F2.11's fallback. */}
        {spec.foil > 0 ? (
          <View testID="share-sheen" pointerEvents="none" style={s.sheen}>
            <LinearGradient colors={SHEEN} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </View>
        ) : null}
        <Foil width={CARD_W - 12} height={CARD_H - 12} intensity={spec.foil} radius={10} still />
      </View>
      <Text style={s.name} numberOfLines={1}>{outcome.card.name}</Text>
      <Text style={s.line} numberOfLines={1}>{shareLine(outcome)}</Text>
      <View style={s.mark}><BrandLockup variant="lockup" size={18} mark={48} /></View>
    </View>
  );
}

const s = StyleSheet.create({
  poster: { width: SHARE_W, height: SHARE_H, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, backgroundColor: color.roomDeep, overflow: 'hidden' },
  tag: { paddingVertical: 5, paddingHorizontal: 13, borderRadius: 99, marginBottom: 12 },
  tagText: { fontFamily: font.black, fontSize: 11.5, letterSpacing: 0.6, color: color.inkOnYellow },
  // 1a's card sits at −3°. The side margins on a 360-wide frame clear the corners of a 176×246 card at that angle.
  card: { width: CARD_W, height: CARD_H, borderRadius: 14, borderWidth: 6, borderColor: '#F2B8D0', backgroundColor: '#F7F8FC', overflow: 'hidden', shadowOpacity: 0.6, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, transform: [{ rotate: '-3deg' }] },
  img: { position: 'absolute', left: -6, top: -6, width: CARD_W, height: CARD_H, borderRadius: 16 },
  // The band the card detail and the album takeover sweep across a rare, held still: the foil draws over it, and it is
  // what the picture keeps if the shader cannot.
  sheen: { position: 'absolute', top: -CARD_H * 0.25, height: CARD_H * 1.5, left: CARD_W * 0.3, width: CARD_W * 0.4, transform: [{ rotate: '25deg' }] },
  name: { fontFamily: font.black, fontSize: 18, color: color.text, marginTop: 16, letterSpacing: -0.2 },
  line: { fontFamily: font.semibold, fontSize: 12, color: color.text2, marginTop: 4 },
  mark: { marginTop: 16 },
});
