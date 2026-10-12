// Card detail (F3.3, design "detail" sheet): a 220×308 card that tilts under the finger (±22° Y, ±16° X) with a sheen
// band that follows it, plus foil and a travelling sheen on rares; the spec table, the album progress row for a common,
// and Ship this card. The contract has no per-card market price, condition or vault date yet: the sheet shows the
// tier's value from /odds (no price source or date until a price import exists, #61; no vault row until stock is
// counted, #57; Ben, 11 Oct), a slab's serial, and nothing it cannot back.
// A season prize is the same sheet: the enlarged slab, the card name, and set · number. No cert line, Verify link,
// value, or Close control — pull the sheet down, or tap the dimmed backdrop.
import React, { useEffect } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import type { Album, Holding, Odds, SeasonPrize, Tier } from '@/api/contract';
import { Slab } from '@/components/season/Slab';
import { dollars } from '@/format';
import { albumProgress } from '@/components/albums/AlbumsGrid';
import { Foil } from '@/components/reveal/Foil';
import { TIER, hexGlow } from '@/components/reveal/tiers';
import { color } from '@/theme/tokens';
import { Backdrop } from '@/components/Backdrop';
import { font } from '@/theme/fonts';
import { useSheetIn } from '@/components/useSheetIn';
import { useGestureScale } from '@/state/appFrame';

const CARD_W = 220;
const CARD_H = 308;
const SHEEN = ['rgba(255,255,255,0)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)'] as const;

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.row, !last && s.rowRule]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function TiltCard({ small, large, name, rarity }: { small: string; large: string; name: string; rarity: Tier }) {
  const spec = TIER[rarity];
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const touch = useSharedValue(0);
  const sweep = useSharedValue(0);
  useEffect(() => { if (spec.lvl >= 1) sweep.set(withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1)); }, [spec.lvl, sweep]);
  const clamp = (v: number) => { 'worklet'; return Math.min(0.5, Math.max(-0.5, v)); };
  const k = useGestureScale(); // glass pixels → the card's own points (see useGestureScale)
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => { x.set(clamp(e.x * k / CARD_W - 0.5)); y.set(clamp(e.y * k / CARD_H - 0.5)); touch.set(withTiming(1, { duration: 120 })); })
    .onUpdate((e) => { x.set(clamp(e.x * k / CARD_W - 0.5)); y.set(clamp(e.y * k / CARD_H - 0.5)); })
    .onFinalize(() => { x.set(withSpring(0)); y.set(withSpring(0)); touch.set(withTiming(0, { duration: 200 })); });
  const tilt = useAnimatedStyle(() => ({ transform: [{ perspective: 900 }, { rotateY: `${x.get() * 22}deg` }, { rotateX: `${-y.get() * 16}deg` }] }));
  const fingerSheen = useAnimatedStyle(() => ({ opacity: touch.get(), transform: [{ translateX: x.get() * CARD_W * 1.6 }, { rotate: '25deg' }] }));
  const rareSheen = useAnimatedStyle(() => ({ transform: [{ translateX: -CARD_W + sweep.get() * CARD_W * 2 }, { rotate: '25deg' }] }));
  const rare = spec.lvl >= 1;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[s.cardShadow, rare ? { shadowColor: spec.glow, shadowOpacity: 0.9, shadowRadius: 22, shadowOffset: { width: 0, height: 0 } } : null, tilt]} accessibilityLabel={name} accessibilityHint="Move your finger over the card to tilt it">
        <View style={[s.card, { borderColor: rare ? spec.glow : '#C9A44C' }]}>
          {/* The binder's thumbnail is already cached: it is drawn first, so the card never opens blank while the large art loads. */}
          <Image testID="card-art-small" source={{ uri: small }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <Image testID="card-art-large" source={{ uri: large }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          {spec.foil > 0 ? <View style={StyleSheet.absoluteFill} pointerEvents="none"><Foil width={CARD_W - 12} height={CARD_H - 12} intensity={spec.foil} radius={8} /></View> : null}
          {rare ? <Animated.View pointerEvents="none" style={[s.sheen, rareSheen]}><LinearGradient colors={SHEEN} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} /></Animated.View> : null}
          <Animated.View pointerEvents="none" style={[s.sheen, fingerSheen]}><LinearGradient colors={SHEEN} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} /></Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/** How far a downward drag must travel, in the sheet's own points, before it dismisses. A fast flick counts too. */
const SLAB_DISMISS_Y = 64;
const SLAB_DISMISS_V = 800;

function SlabDetail({ prize, onClose }: { prize: SeasonPrize; onClose: () => void }) {
  const reduced = useReducedMotion() === true;
  const drag = useSharedValue(0);
  const settled = useSharedValue(false);
  const sheetIn = useSheetIn(true, drag);
  const k = useGestureScale(); // glass pixels → the sheet's own points (see useGestureScale)
  const finish = (translationY: number, velocityY: number) => {
    'worklet';
    if (settled.get()) return;
    settled.set(true);
    const pulled = Math.max(drag.get(), translationY * k);
    if (pulled > SLAB_DISMISS_Y || velocityY * k > SLAB_DISMISS_V) runOnJS(onClose)();
    else {
      drag.set(withSpring(0));
      settled.set(false);
    }
  };
  const pan = Gesture.Pan()
    .withTestId('slab-sheet-pan')
    .activeOffsetY(12)
    .onBegin(() => { settled.set(false); })
    // A pull down the bottom sheet leaves the view. Keep the gesture, and still settle if it is cancelled.
    .shouldCancelWhenOutside(false)
    .onUpdate((e) => { drag.set(Math.max(0, e.translationY * k)); })
    .onEnd((e) => { finish(e.translationY, e.velocityY); })
    .onFinalize((e, success) => { if (!success) finish(e.translationY, e.velocityY); });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="card-detail">
      <GestureHandlerRootView style={s.fill}>
        <Backdrop style={s.backdrop} onPress={onClose} label="Close card detail" />
        <GestureDetector gesture={pan}>
          <Animated.View style={[s.sheet, sheetIn]} testID="slab-sheet">
            <View testID="slab-sheet-grabber" style={s.grabber} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <View style={s.slabBody}>
              {/* The face is not a hit target: a browser image-drag would swallow the pull-down. */}
              <View style={s.cardWrap} pointerEvents="none">
                <Slab prize={prize} width={220} lip="grand" sheen={prize.slot === 'grand' && !reduced} />
              </View>
              <Text testID="slab-detail-title" style={[s.name, s.slabTitle]} numberOfLines={2}>{prize.name}</Text>
              <Text testID="slab-detail-subtitle" style={[s.meta, s.slabSub]} numberOfLines={1}>{`${prize.set} · ${prize.number}`}</Text>
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

export type CardDetailProps = {
  /** The holding line to show; null keeps the sheet closed. */
  holding: Holding | null;
  /** The album a common belongs to (none for rares). */
  album: Album | null;
  holdings: Record<string, Holding>;
  /** The odds tables (F5.1): the tier's value and when prices were refreshed. Without them the sheet names no price. */
  odds?: Odds | null;
  /** Season raffle slab. When set, the sheet is the slab variant instead of a holding. */
  slab?: SeasonPrize | null;
  onClose: () => void;
};

export function CardDetailSheet({ holding, album, holdings, odds, onClose, slab = null }: CardDetailProps) {
  // `Holding.card` is optional in the contract: a common's card, and its slot, come from its album, so the sheet opens without it.
  const albumCard = album?.cards.find((c) => c.id === holding?.cardId);
  const card = holding?.card ?? albumCard;
  const slot = albumCard?.slot;
  const open = !!card && !slab;
  const sheetIn = useSheetIn(open);
  if (slab) return <SlabDetail prize={slab} onClose={onClose} />;
  if (!holding || !card) return null;
  const rarity: Tier = holding.rarity ?? 'common';
  const spec = TIER[rarity];
  const rare = spec.lvl >= 1;
  // The value of the tier, not of this card: the /odds row. No price source or date is claimed until a real price import
  // exists (#61), and no vault row until the cards are bought and counted (#57): Ben, 11 Oct.
  const tier = odds?.paid.rows.find((r) => r.tier === rarity);
  const serial = holding.serials?.[0];
  const { have, total } = album ? albumProgress(album, holdings) : { have: 0, total: 0 };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="card-detail">
      <GestureHandlerRootView style={s.fill}>
        <Backdrop style={s.backdrop} onPress={onClose} label="Close card detail" />
        <Animated.View style={[s.sheet, sheetIn]}>
          <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
            <View style={s.cardWrap}><TiltCard small={card.imgSmall} large={card.imgLarge} name={card.name} rarity={rarity} /></View>
            <Text style={s.hint}>Move your finger over the card to tilt it</Text>
            <View style={s.titleRow}>
              <View style={s.titleCopy}>
                <Text style={s.name} numberOfLines={1}>{card.name}</Text>
                <Text style={s.meta} numberOfLines={1}>{rare ? spec.tag : album?.title ?? spec.tag}</Text>
              </View>
              <View style={[s.tag, { backgroundColor: rare ? spec.glow : 'rgba(255,255,255,0.1)', shadowColor: rare ? hexGlow(spec.glow) : 'transparent' }]}>
                <Text style={[s.tagText, { color: spec.lvl >= 3 ? '#FFFFFF' : rare ? '#0B1E2A' : color.text2 }]}>{rare ? spec.tag.toUpperCase() : 'COMMON'}</Text>
              </View>
            </View>
            <View style={s.table}>
              {tier ? <Row label="Tier value" value={`about ${dollars(tier.valueUsd)} · any ${tier.label.toLowerCase()}`} /> : null}
              <Row label="Set · number" value={`${card.set} · ${card.number}${slot && !rare ? ` · slot ${slot}/${total}` : ''}`} />
              <Row label="Condition" value={rarity === 'graded' ? `Graded slab${serial ? ` · ${serial}` : ''}` : 'Raw'} />
              <Row label="You hold" value={`×${holding.qty}`} last />
            </View>
            {!rare && album && slot ? (
              <View style={s.albumRow}>
                <View style={s.titleCopy}>
                  <Text style={s.albumTitle}>{album.title}</Text>
                  <Text style={s.albumSub}>{`Slot ${slot} of ${total} · album ${have}/${total}`}</Text>
                </View>
                <View style={s.meter}><View style={[s.meterFill, { width: `${total ? Math.round((have / total) * 100) : 0}%` }]} /></View>
              </View>
            ) : null}
          </ScrollView>
          <View style={s.footer}>
            <Pressable onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><Text style={s.closeText}>Close</Text></Pressable>
            {/* Shipping is coming soon (Ben, 11 Sept): the button stays visible so the path is known, and says so. */}
            <Pressable disabled style={[s.shipBtn, s.shipSoon]} accessibilityRole="button" accessibilityLabel="Ship this card" accessibilityState={{ disabled: true }}>
              <Text style={s.shipText}>Ship this card</Text>
              <Text style={s.shipSub}>coming soon</Text>
            </Pressable>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(3,5,12,0.78)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '94%', backgroundColor: 'rgba(18,24,45,0.98)', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  body: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  cardWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  cardShadow: { width: CARD_W, height: CARD_H, borderRadius: 14, shadowColor: '#000', shadowOpacity: 0.65, shadowRadius: 27, shadowOffset: { width: 0, height: 18 } },
  card: { flex: 1, borderRadius: 14, borderWidth: 6, overflow: 'hidden', backgroundColor: '#F7F8FC' },
  sheen: { position: 'absolute', top: -CARD_H * 0.25, height: CARD_H * 1.5, left: CARD_W * 0.3, width: CARD_W * 0.4 },
  hint: { textAlign: 'center', fontFamily: font.semibold, fontSize: 11, color: color.text3, marginVertical: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  titleCopy: { flex: 1, minWidth: 0 },
  name: { fontFamily: font.black, fontSize: 20, color: color.text },
  meta: { fontFamily: font.semibold, fontSize: 12, color: color.text2 },
  tag: { borderRadius: 99, paddingVertical: 5, paddingHorizontal: 11, shadowOpacity: 0.8, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  tagText: { fontFamily: font.black, fontSize: 11, letterSpacing: 0.6 },
  table: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9 },
  rowRule: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  rowLabel: { fontFamily: font.semibold, fontSize: 13, color: color.text2 },
  rowValue: { flexShrink: 1, fontFamily: font.bold, fontSize: 13, color: color.text, textAlign: 'right' },
  albumRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  albumTitle: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  albumSub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text2 },
  meter: { width: 90, height: 6, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 99, backgroundColor: color.mint },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 30, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  closeBtn: { justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16 },
  closeText: { fontFamily: font.extrabold, fontSize: 14, color: color.text },
  shipBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.mint, borderRadius: 12, paddingVertical: 8, shadowColor: '#3DAF88', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 3 } },
  shipSoon: { opacity: 0.55 },
  shipText: { fontFamily: font.black, fontSize: 15, color: '#0B1E2A' },
  shipSub: { fontFamily: font.bold, fontSize: 10.5, color: '#0B1E2A' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.28)', marginTop: 10 },
  slabBody: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28 },
  slabTitle: { textAlign: 'center', marginTop: 10 },
  slabSub: { textAlign: 'center', marginTop: 2 },
});
