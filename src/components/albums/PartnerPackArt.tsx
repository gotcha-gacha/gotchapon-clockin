// Closed Jupiter Degen pack (#392). Claim credits the pull; the pack is not opened in the app.
// A placeholder with no art stays a drawn face, never a Gotchapon holo.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { partnerPackFace, type PlaceholderPartner, placeholderPartner } from '@/config/partnerPack';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

const PACK_W = 168;
const PACK_H = 228;

// Official Jupiter Pokémon DEGEN pack. Black field removed so the foil is the hero.
// Closed is 540×986. The peeled file is not mounted: there is no in-app rip.
const DEGEN_PACK = require('../../../assets/partners/jupiter-pokemon-degen-pack.webp');
const ART_W = 176;
const ART_H = Math.round((ART_W * 986) / 540);

export function ClosedPack({ partner = placeholderPartner }: { partner?: PlaceholderPartner }) {
  const face = partnerPackFace(partner);
  if (partner === 'jupiter-degen') {
    return (
      <View style={s.art} accessibilityLabel={`Closed ${face.sub}`}>
        <Image testID="closed-pack-art" source={DEGEN_PACK} style={s.artImg} resizeMode="contain" accessible={false} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View style={s.pack} accessibilityLabel={`Closed ${face.sub}`}>
      <View style={s.stripe} />
      <Text style={s.mark}>{face.mark}</Text>
      <Text style={s.tier}>{face.tier}</Text>
      <Text style={s.word}>PACK</Text>
    </View>
  );
}

const s = StyleSheet.create({
  art: { width: ART_W, height: ART_H, alignItems: 'center', justifyContent: 'center' },
  artImg: { width: ART_W, height: ART_H },
  pack: {
    width: PACK_W, height: PACK_H, borderRadius: 16, overflow: 'hidden',
    backgroundColor: color.gunmetalDeep, borderWidth: 4, borderColor: color.goldTrim,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: color.mint, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
  },
  stripe: { position: 'absolute', left: -20, right: -20, top: 78, height: 28, backgroundColor: color.mint, transform: [{ rotate: '-8deg' }] },
  mark: { fontFamily: font.extrabold, fontSize: 13, letterSpacing: 3, color: color.mint },
  tier: { fontFamily: font.black, fontSize: 28, letterSpacing: 1, color: color.cream, marginTop: 4 },
  word: { fontFamily: font.bold, fontSize: 12, letterSpacing: 4, color: color.marqueeInk, marginTop: 8 },
});
