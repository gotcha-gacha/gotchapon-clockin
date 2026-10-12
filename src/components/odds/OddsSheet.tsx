// Published pull odds as a right-side sleeve over Pull (design README §3 `oddsOpen`; Ben, 16 Sept):
// paid + free tables, stacked bar, targeted note. Vault/audit/EV/proof stay out.
// No pull-10 starter line: v0 has no mid-pull rare ladder (product lock, #316).
// Opened from the ODDS edge tab (tap or drag left), ticker, "see odds", and Account → Odds disclosure.
import React, { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppFrame } from '@/state/appFrame';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Odds, OddsRow } from '@/api/contract';
import { TIER } from '@/components/reveal/tiers';
import { playSfx } from '@/audio/sfx';
import { useSession } from '@/state/session';
import { color, radius } from '@/theme/tokens';
import { Backdrop } from '@/components/Backdrop';
import { font } from '@/theme/fonts';

const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;
const money = (v: number) => (v >= 10 ? `$${v}` : `$${v.toFixed(2)}`);
const SLIDE = Easing.bezier(0.25, 0.8, 0.3, 1);

function OddsTable({ rows }: { rows: OddsRow[] }) {
  return (
    <View>
      {rows.map((o, i) => (
        <View key={o.tier} style={[s.row, i < rows.length - 1 && s.rule]} accessible accessibilityLabel={`${o.label}, ${pct(o.pct)}`}>
          <View style={s.grow}>
            <View style={s.rowHead}>
              <View style={[s.dot, { backgroundColor: TIER[o.tier].glow, shadowColor: TIER[o.tier].glow }]} />
              <Text style={s.rowName}>{o.label}</Text>
            </View>
          </View>
          <Text style={s.rowPct}>{pct(o.pct)}</Text>
        </View>
      ))}
    </View>
  );
}

function StackedBar({ rows }: { rows: OddsRow[] }) {
  return (
    <View style={s.bar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {rows.map((o) => <View key={o.tier} style={{ flexGrow: o.pct, flexBasis: 0, minWidth: 2, backgroundColor: TIER[o.tier].glow }} />)}
    </View>
  );
}

function OddsCards({ odds }: { odds: Odds }) {
  const targeted = odds.paid.targetedPrice;
  return (
    <>
      <View style={s.card}>
        <OddsTable rows={odds.paid.rows} />
        <StackedBar rows={odds.paid.rows} />
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>Free pull</Text>
          <Text style={s.cardAside}>free · commons only</Text>
        </View>
        <OddsTable rows={odds.free.rows} />
        {targeted ? (
          <View style={s.subBlock}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>Chasing an album</Text>
              <Text style={s.cardAside}>{`${money(targeted)} a pull`}</Text>
            </View>
            <Text style={s.cardSub}>A $1.50 pull draws a random card from that album.</Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

export function OddsSheet({ onClose }: { onClose: () => void }) {
  const { odds, ready, refresh } = useSession();
  const insets = useSafeAreaInsets();
  const { width: winW } = useAppFrame();
  const panelW = Math.min(340, Math.round(winW * 0.82));
  const x = useSharedValue(panelW);
  const fade = useSharedValue(0);
  useEffect(() => {
    playSfx('click');
    x.set(panelW);
    fade.set(0);
    x.set(withTiming(0, { duration: 380, easing: SLIDE }));
    fade.set(withTiming(1, { duration: 250 }));
  }, [panelW, x, fade]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const scrim = useAnimatedStyle(() => ({ opacity: fade.get() }));
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} testID="odds-sheet">
      <View style={s.root}>
        <Animated.View style={[s.backdrop, scrim]}>
          <Backdrop style={StyleSheet.absoluteFill} onPress={onClose} label="Close odds" />
        </Animated.View>
        <Animated.View testID="odds-panel" style={[s.panel, { width: panelW, paddingTop: insets.top + 16 }, slide]}>
          <View style={s.head}>
            <View style={s.headCopy}>
              <Text style={s.title}>Odds per $1 pull</Text>
            </View>
            <Pressable onPress={onClose} style={s.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Text style={s.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
            {odds ? <OddsCards odds={odds} /> : (
              <View style={s.card}>
                <Text style={s.cardTitle}>{ready ? 'The odds did not load' : 'Loading the odds…'}</Text>
                {ready ? <Pressable onPress={() => { void refresh(); }} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}><Text style={s.link}>Try again</Text></Pressable> : null}
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(3,5,12,0.55)' },
  panel: {
    height: '100%',
    backgroundColor: 'rgba(18,24,45,0.97)',
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 60,
    shadowOffset: { width: -20, height: 0 },
    elevation: 16,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  headCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: font.black, fontSize: 18, color: color.text },
  close: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 14, color: color.text2 },
  body: { paddingTop: 4, paddingHorizontal: 16, gap: 10 },
  card: { backgroundColor: color.glassBg, borderWidth: 1, borderColor: color.glassBorder, borderRadius: radius.cardLg, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  cardTitle: { fontFamily: font.extrabold, fontSize: 14, color: color.text },
  cardAside: { fontFamily: font.semibold, fontSize: 11, color: color.text2 },
  cardSub: { fontFamily: font.semibold, fontSize: 12, color: color.text2, lineHeight: 17 },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  rule: { borderBottomWidth: 1, borderBottomColor: color.hairline },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  rowPct: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  rowName: { fontFamily: font.bold, fontSize: 13, color: color.text },
  bar: { marginTop: 8, height: 8, borderRadius: radius.pill, overflow: 'hidden', flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)' },
  subBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.hairline, gap: 4 },
  link: { marginTop: 10, fontFamily: font.extrabold, fontSize: 12, color: color.mint, textDecorationLine: 'underline' },
});
