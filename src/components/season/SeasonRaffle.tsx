// Albums-page raffle module (docs/season_raffle_6a.md). Copy is the brief's, minus the shelf total and per-slab prices.
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { phoneClassWeb } from '@/web/phoneWeb';
import type { Season, SeasonPrize } from '@/api/contract';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { Slab } from './Slab';

const fixed = { flexGrow: 0, flexShrink: 0 } as const;

const COPY = {
  title: 'Season One raffle',
  yours: 'YOUR TICKETS',
  rate: '1 ticket per $1 paid pull',
  draw: 'Draw on 30 Nov · keep pulling to add more',
  grand: 'GRAND PRIZE',
  rules: "Prizes are PSA 10 slabs, bought before the draw. One prize per ticket, grand prize first. Free pulls don't earn tickets.",
  streak: '5-day streak',
  streakRule: 'A paid pull each day. Miss a day and it starts over. At 5, +2 raffle tickets, then it starts over.',
} as const;

function streakStatus(streak: Season['streak']): string {
  if (streak.countedToday && streak.count === 0) return 'Counted today. It starts over on the next paid day.';
  if (streak.countedToday) return `Day ${streak.count} of 5. Counted today.`;
  if (streak.count === 0) return 'A paid pull starts it.';
  return `Day ${streak.count} of 5. A paid pull today keeps it.`;
}

function StreakRow({ streak }: { streak: Season['streak'] }) {
  return (
    <View testID="season-streak" style={s.streak}>
      <View style={s.streakHead}>
        <Text style={s.streakTitle}>{COPY.streak}</Text>
        <View accessibilityLabel={`${COPY.streak}, ${streak.count} of 5`} style={s.dots}>
          {Array.from({ length: 5 }, (_, i) => (
            <View key={i} testID={i < streak.count ? 'streak-dot-on' : 'streak-dot-off'} style={[s.dot, i < streak.count ? s.dotOn : null]} />
          ))}
        </View>
      </View>
      <Text style={s.streakStatus}>{streakStatus(streak)}</Text>
      <Text style={s.streakRule}>{COPY.streakRule}</Text>
    </View>
  );
}

function ConicWash() {
  const turn = useSharedValue(0);
  useEffect(() => {
    // The wash is 220% of the prize case. Rotating a conic-gradient is a repaint of that whole layer, and on a
    // phone it was the Albums page's always-on cost (the landing page after sign-in). The gold wedge stays; it just holds still.
    if (phoneClassWeb()) { cancelAnimation(turn); turn.set(0); return; }
    turn.set(withRepeat(withTiming(1, { duration: 30_000, easing: Easing.linear }), -1));
    return () => cancelAnimation(turn);
  }, [turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  const webWash = Platform.OS === 'web'
    ? ({ backgroundImage: 'conic-gradient(from 0deg, rgba(255,215,0,0.08) 0deg 42deg, rgba(255,215,0,0) 42deg)' } as object)
    : null;
  return (
    <Animated.View pointerEvents="none" testID="season-conic" style={[s.conic, spin, webWash]}>
      {Platform.OS === 'web' ? null : (
        <LinearGradient colors={['rgba(255,215,0,0.08)', 'rgba(255,215,0,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.55 }} style={StyleSheet.absoluteFill} />
      )}
    </Animated.View>
  );
}

function Countdown({ drawAt, nowMs }: { drawAt: string; nowMs?: number }) {
  const [clock, setClock] = useState<number | null>(nowMs ?? null);
  useEffect(() => {
    if (nowMs != null) return;
    // Date.now() stays out of render (compiler). The first tick is a timeout so the effect itself does not set state.
    const tick = () => setClock(Date.now());
    const kick = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(kick); clearInterval(id); };
  }, [nowMs]);
  if (clock != null && Date.parse(drawAt) - clock <= 0) {
    return (
      <View testID="season-drawing" style={s.drawing}>
        <Text style={s.drawingText}>Drawing…</Text>
      </View>
    );
  }
  const total = clock == null ? null : Math.floor((Date.parse(drawAt) - clock) / 1000);
  const parts = total == null ? null : {
    DAYS: Math.floor(total / 86400),
    HRS: Math.floor((total % 86400) / 3600),
    MIN: Math.floor((total % 3600) / 60),
    SEC: total % 60,
  };
  return (
    <View testID="season-countdown" style={s.tiles}>
      {(['DAYS', 'HRS', 'MIN', 'SEC'] as const).map((label) => (
        <View key={label} style={s.tile}>
          <Text style={s.digit}>{parts ? String(parts[label]).padStart(2, '0') : '–'}</Text>
          <Text style={s.tileLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function PrizeCase({ prizes, reduced, onOpenPrize }: { prizes: Season['prizes']; reduced: boolean; onOpenPrize: (prize: SeasonPrize) => void }) {
  const grand = prizes.find((prize) => prize.slot === 'grand');
  const mids = prizes.filter((prize) => prize.slot === 'mid');
  const [midW, setMidW] = useState(0);
  if (!grand) return null;
  return (
    <LinearGradient colors={['#2A2110', '#151005']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={s.case}>
      {reduced ? null : <ConicWash />}
      <View style={s.caseRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${grand.name}, grand prize`}
          testID={`season-slab-${grand.cardId}`}
          onPress={() => onOpenPrize(grand)}
          style={fixed}
        >
          <Slab prize={grand} width={150} lip="grand" sheen={!reduced} />
          <LinearGradient colors={['#FFE680', '#FFD23F', '#E0A91A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.pill}>
            <Text style={s.pillText}>{COPY.grand}</Text>
          </LinearGradient>
        </Pressable>
        <View
          testID="season-mid-grid"
          style={s.midGrid}
          onLayout={(event) => {
            const next = Math.floor((event.nativeEvent.layout.width - 8) / 2);
            setMidW((prev) => (prev === next || next <= 0 ? prev : next));
          }}
        >
          {midW > 0 ? mids.map((prize) => (
            <Pressable
              key={prize.cardId}
              accessibilityRole="button"
              accessibilityLabel={`${prize.name}, prize slab`}
              testID={`season-slab-${prize.cardId}`}
              onPress={() => onOpenPrize(prize)}
              style={[fixed, { width: midW }]}
            >
              <Slab prize={prize} width={midW} lip="mid" sheen={false} />
            </Pressable>
          )) : null}
        </View>
      </View>
    </LinearGradient>
  );
}

export function SeasonRaffle({ season, nowMs, onOpenPrize, motion = true }: { season: Season; nowMs?: number; onOpenPrize: (prize: SeasonPrize) => void; motion?: boolean }) {
  const reduced = useReducedMotion() === true || !motion;
  return (
    <View testID="season-raffle" style={s.column}>
      <View style={s.header}>
        <Text style={s.title}>{COPY.title}</Text>
      </View>
      <View style={s.stubWrap}>
        <LinearGradient colors={['#FFE680', '#FFD23F', '#E0A91A']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.stub}>
          <View style={s.stubLeft}>
            <Text style={s.yours}>{COPY.yours}</Text>
            <Text testID="season-ticket-count" style={s.count}>{season.myTickets}</Text>
          </View>
          <View style={s.stubRight}>
            <Text style={s.rate}>{COPY.rate}</Text>
            <Text style={s.keep}>{COPY.draw}</Text>
          </View>
        </LinearGradient>
        <View style={[s.notch, s.notchL]} />
        <View style={[s.notch, s.notchR]} />
      </View>
      <StreakRow streak={season.streak} />
      <Countdown drawAt={season.drawAt} nowMs={nowMs} />
      <PrizeCase prizes={season.prizes} reduced={reduced} onOpenPrize={onOpenPrize} />
      <Text style={s.rules}>{COPY.rules}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  column: { ...fixed, gap: 12, marginBottom: 12 },
  header: { ...fixed, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: { flexShrink: 1, fontFamily: font.black, fontSize: 20, color: color.text },
  stubWrap: { ...fixed, position: 'relative' },
  stub: {
    ...fixed,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 78,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  stubLeft: { ...fixed, paddingVertical: 10, paddingLeft: 16, paddingRight: 12, borderRightWidth: 2, borderStyle: 'dashed', borderRightColor: 'rgba(31,45,77,0.35)' },
  yours: { fontFamily: font.black, fontSize: 9, letterSpacing: 1.5, color: color.inkOnYellow, opacity: 0.75 },
  count: { fontFamily: font.black, fontSize: 30, letterSpacing: -1, color: color.inkOnYellow, marginTop: -2 },
  stubRight: { flex: 1, flexShrink: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  rate: { fontFamily: font.black, fontSize: 12.5, color: color.inkOnYellow },
  keep: { fontFamily: font.bold, fontSize: 10.5, color: color.inkOnYellow, opacity: 0.8 },
  notch: { position: 'absolute', top: '50%', width: 18, height: 18, marginTop: -9, borderRadius: 9, backgroundColor: color.room },
  notchL: { left: -9 },
  notchR: { right: -9 },
  tiles: { ...fixed, flexDirection: 'row', gap: 6 },
  tile: { flex: 1, alignItems: 'center', borderRadius: 10, backgroundColor: '#12182D', borderWidth: 1, borderColor: 'rgba(255,210,63,0.3)', paddingVertical: 8 },
  digit: { fontFamily: font.mono, fontWeight: '700', fontSize: 22, color: color.marqueeInk },
  tileLabel: { fontFamily: font.black, fontSize: 8.5, letterSpacing: 1.2, color: color.text3, marginTop: 2 },
  drawing: { ...fixed, borderRadius: 10, backgroundColor: '#12182D', borderWidth: 1, borderColor: 'rgba(255,210,63,0.3)', paddingVertical: 16, alignItems: 'center' },
  drawingText: { fontFamily: font.black, fontSize: 18, color: color.marqueeInk },
  case: { ...fixed, borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: color.goldTrim, overflow: 'hidden' },
  conic: { position: 'absolute', top: '-60%', left: '-60%', width: '220%', height: '220%' },
  caseRow: { ...fixed, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pill: { marginTop: 8, borderRadius: 99, paddingVertical: 5, paddingHorizontal: 8, alignItems: 'center' },
  pillText: { fontFamily: font.black, fontSize: 10, letterSpacing: 1.5, color: color.inkOnYellow, textAlign: 'center' },
  midGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' },
  rules: { ...fixed, fontFamily: font.semibold, fontSize: 11, lineHeight: 15, color: color.text3 },
  streak: { ...fixed, gap: 4, borderRadius: 12, backgroundColor: '#12182D', borderWidth: 1, borderColor: 'rgba(255,210,63,0.3)', paddingVertical: 10, paddingHorizontal: 12 },
  streakHead: { ...fixed, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  streakTitle: { fontFamily: font.black, fontSize: 13, color: color.text },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,210,63,0.45)' },
  dotOn: { backgroundColor: color.yellow, borderColor: color.yellow },
  streakStatus: { fontFamily: font.bold, fontSize: 11, color: color.text2 },
  streakRule: { fontFamily: font.semibold, fontSize: 11, lineHeight: 15, color: color.text3 },
});
