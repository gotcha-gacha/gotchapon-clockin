// Binder detail (F3.2, design "2. Albums" → album detail): back button + title/sub, "Pull this album"
// row (targeted pull, $1.50) while incomplete, the album progress bar, a leather binder with a
// five-ring spine holding the 5×5 sleeve grid (owned = card + slot number, ×n pill for extras,
// missing = dashed + number), then the Extras shelf and Your rares shelf. Tap an owned card → detail (F3.3).
import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { EXTRAS_NOTE, ExtraThumbs, type ExtraRef } from './ExtrasCard';
import { LinearGradient } from 'expo-linear-gradient';
import type { Album, Holding, Tier } from '@/api/contract';
import { PACK_COPY, type PartnerPackCredit } from '@/config/partnerPack';
import { albumProgress } from './AlbumsGrid';
import { tierColor, color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

export const SLEEVE_PAD = 10;
export const SLEEVE_GAP = 8;
export const SLEEVE_BORDER = 1;
/** One sleeve's width for a measured row. onLayout reports the border-box, so the row's border comes off too:
 *  without it the fifth sleeve overflowed by 1–2 px and wrapped on most phone widths. */
export const sleeveWidth = (rowWidth: number) => Math.floor((rowWidth - 2 * (SLEEVE_PAD + SLEEVE_BORDER) - SLEEVE_GAP * 4) / 5);

export type RareRef = { id: string; name: string; imgSmall: string; rarity: Tier };

type BinderDetailProps = {
  album: Album;
  holdings: Record<string, Holding>;
  extras: ExtraRef[];
  rares: RareRef[];
  /** False while a pull is in flight: the target can only change in idle. */
  canTarget?: boolean;
  onBack: () => void;
  onTargetPull: (albumId: string) => void;
  /** Tap an owned card: its id, plus the tier for a line on the rares shelf, so F3.3 opens that exact holding line. */
  onOpenCard?: (cardId: string, rarity?: Tier) => void;
  /** A complete album's Degen pack credit (#392): claim it while the machine is idle (`canTarget`). */
  onPartnerPack?: (albumId: string) => void;
  /** Set once this session's claim recorded a pack. Absent until then. */
  partnerPack?: PartnerPackCredit | null;
};

export function BinderDetail({ album, holdings, extras, rares, canTarget = true, onBack, onTargetPull, onOpenCard, onPartnerPack, partnerPack = null }: BinderDetailProps) {
  const { have, total, done } = albumProgress(album, holdings);
  // Slots are sized from the measured sleeve row (percentage width + aspectRatio collapses in the page ScrollView).
  const [sleevesW, setSleevesW] = useState(0);
  const onSleevesLayout = (e: LayoutChangeEvent) => setSleevesW(e.nativeEvent.layout.width);
  const slotW = sleeveWidth(sleevesW);
  const slotSize = { width: slotW, height: (slotW * 7) / 5 };
  return (
    <View>
      <View style={s.head}>
        <Pressable onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Back to albums"><Text style={s.backText}>← Albums</Text></Pressable>
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{album.title}</Text>
          <Text style={s.sub}>{have}/{total} collected{done ? ' · complete' : ''}</Text>
        </View>
      </View>
      {!done ? (
        <View style={s.chase}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.chaseTitle}>Pull this album</Text>
            <Text style={s.chaseSub}>Random card from this album · $1.50</Text>
          </View>
          <Pressable onPress={() => onTargetPull(album.id)} disabled={!canTarget} style={({ pressed }) => [s.chaseBtn, !canTarget && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button" accessibilityLabel={`Pull for ${album.title}, $1.50`}><Text style={s.chaseBtnText}>Pull $1.50</Text></Pressable>
        </View>
      ) : onPartnerPack ? (
        <View style={s.chase}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.chaseTitle}>Album complete</Text>
            <Text style={s.chaseSub}>{partnerPack ? PACK_COPY.binderCredited : PACK_COPY.binderReady}</Text>
          </View>
          {partnerPack ? null : (
            <Pressable onPress={() => onPartnerPack(album.id)} disabled={!canTarget} style={({ pressed }) => [s.chaseBtn, !canTarget && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button" accessibilityLabel={`Claim ${album.title} partner pack`} accessibilityState={{ disabled: !canTarget }}>
              <Text style={s.chaseBtnText}>{PACK_COPY.claim}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      <View style={s.meter}><View style={[s.meterFill, { width: `${Math.round((have / total) * 100)}%` }]} /></View>

      <LinearGradient colors={['#33202C', '#211420']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.binder}>
        <View style={s.spine}>{[0, 1, 2, 3, 4].map((i) => <View key={i} style={s.ring} />)}</View>
        <View style={s.sleeves} onLayout={onSleevesLayout} testID="binder-sleeves">
          {sleevesW > 0 && album.cards.map((c) => {
            const qty = holdings[c.id]?.qty ?? 0;
            const have = qty > 0;
            return (
              <Pressable key={c.id} onPress={() => have && onOpenCard?.(c.id)} disabled={!have || !onOpenCard} style={[s.slot, slotSize, have ? s.slotHave : s.slotEmpty]} accessibilityRole={have && onOpenCard ? 'button' : undefined} accessibilityLabel={have ? c.name : `Slot ${c.slot}, missing`}>
                {have ? (
                  <>
                    <Image source={{ uri: c.imgSmall }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    <Text style={s.slotNo}>{c.slot}</Text>
                    {qty > 1 ? <View style={s.xPill}><Text style={s.xText}>×{qty}</Text></View> : null}
                  </>
                ) : (
                  <Text style={s.emptyNo}>{c.slot}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </LinearGradient>
      {onOpenCard ? <Text style={s.tapHint}>Tap a card you own to see it up close.</Text> : null}

      {extras.length ? (
        <View style={s.shelf}>
          <Text style={s.shelfTitle}>Extras · {extras.reduce((n, e) => n + e.count, 0)}</Text>
          <ExtraThumbs extras={extras} />
          <Text style={s.shelfNote}>{EXTRAS_NOTE}</Text>
        </View>
      ) : null}

      {rares.length ? (
        <View style={s.shelf}>
          <Text style={s.shelfTitle}>Your rares</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
            {rares.map((r) => (
              <Pressable key={`${r.id}-${r.rarity}`} onPress={() => onOpenCard?.(r.id, r.rarity)} disabled={!onOpenCard} style={[s.rare, { borderColor: tierColor[r.rarity], shadowColor: tierColor[r.rarity] }]} accessibilityRole={onOpenCard ? 'button' : undefined} accessibilityLabel={r.name}>
                <Image source={{ uri: r.imgSmall }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 10 },
  back: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, paddingVertical: 7, paddingHorizontal: 12 },
  backText: { fontFamily: font.extrabold, fontSize: 12, color: color.text },
  title: { fontFamily: font.black, fontSize: 16, color: color.text },
  sub: { fontFamily: font.semibold, fontSize: 12, color: color.text2 },
  chase: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: 'rgba(143,227,197,0.08)', borderWidth: 1, borderColor: 'rgba(143,227,197,0.35)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10 },
  chaseTitle: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  chaseSub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text2 },
  chaseBtn: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: color.mint },
  chaseBtnText: { fontFamily: font.extrabold, fontSize: 12.5, color: color.inkOnMint },
  meter: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 99, overflow: 'hidden', marginBottom: 10 },
  meterFill: { height: '100%', backgroundColor: color.mint, borderRadius: 99, shadowColor: color.mint, shadowOpacity: 0.7, shadowRadius: 8 },
  binder: { borderWidth: 2, borderColor: color.goldTrim, borderRadius: 20, paddingTop: 12, paddingRight: 12, paddingBottom: 12, paddingLeft: 30, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 34, shadowOffset: { width: 0, height: 14 } },
  spine: { position: 'absolute', left: 8, top: 0, bottom: 0, justifyContent: 'space-around', paddingVertical: 16 },
  ring: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: '#8f97b0' },
  sleeves: { backgroundColor: 'rgba(240,244,255,0.05)', borderWidth: SLEEVE_BORDER, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: SLEEVE_PAD, flexDirection: 'row', flexWrap: 'wrap', gap: SLEEVE_GAP, minHeight: 40 },
  slot: { borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  slotHave: { backgroundColor: '#F7F8FC', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  slotEmpty: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)' },
  slotNo: { position: 'absolute', bottom: 2, right: 3, fontFamily: font.extrabold, fontSize: 9, color: color.inkOnYellow, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4, paddingHorizontal: 3, overflow: 'hidden' },
  emptyNo: { fontFamily: font.bold, fontSize: 10, color: color.text3 },
  xPill: { position: 'absolute', top: 2, left: 3, borderRadius: 99, paddingHorizontal: 4, backgroundColor: color.mint },
  xText: { fontFamily: font.extrabold, fontSize: 9, color: color.inkOnYellow },
  tapHint: { marginTop: 10, textAlign: 'center', fontFamily: font.semibold, fontSize: 12, color: color.text2 },
  shelf: { marginTop: 14 },
  shelfTitle: { fontFamily: font.extrabold, fontSize: 13, color: color.text, marginBottom: 6 },
  shelfNote: { fontFamily: font.semibold, fontSize: 11, color: color.text3, marginTop: 8 },
  rare: { width: 64, height: 90, borderRadius: 6, overflow: 'hidden', borderWidth: 2, shadowOpacity: 0.8, shadowRadius: 14 },
});
