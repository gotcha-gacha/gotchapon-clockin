// Stub slab chrome from the refreshed GEM MT label (red rim, black inner, barcode,
// generic red-ring "10", grade column). No grader wordmark and no hologram.
// A photo URL that 404s leaves the gradient well.
import React, { useEffect, useId, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { phoneClassWeb } from '@/web/phoneWeb';
import type { SeasonPrize } from '@/api/contract';
import { font } from '@/theme/fonts';

/** Printed set size, only so the label can read "238/191". Not a disclosure. */
const SET_LINE: Record<string, { year: string; code: string; printed: number }> = {
  'Surging Sparks': { year: '2024', code: 'SSP', printed: 191 },
  'Obsidian Flames': { year: '2023', code: 'OBF', printed: 197 },
  'Evolving Skies': { year: '2021', code: 'EVS', printed: 203 },
  'Lost Origin': { year: '2022', code: 'LOR', printed: 196 },
};

type Metrics = {
  radius: number;
  padH: number;
  padTop: number;
  padBot: number;
  gap: number;
  ring: number;
  red: number;
  black: number;
  rule: number;
  gradeW: number;
  gem: number;
  ten: number;
  tenTrack: number;
  year: number;
  name: number;
  no: number;
  badge: number;
  badgeText: number;
  barH: number;
  wellPad: number;
  frame: number;
  nameLines: number;
  minH: number;
};

/** Sizes from the 168px grand and 82px mid in the label reference, scaled to `width`. */
function metrics(lip: 'grand' | 'mid', width: number): Metrics {
  if (lip === 'grand') {
    const k = width / 168;
    return {
      radius: 6 * k, padH: 8 * k, padTop: 9 * k, padBot: 8 * k, gap: 7 * k, ring: 2.5 * k,
      red: 3 * k, black: 1.5 * k, rule: 1.5 * k, gradeW: 44 * k,
      gem: 7 * k, ten: 26 * k, tenTrack: -1.5 * k, year: 7 * k, name: 10 * k, no: 7 * k,
      badge: 16 * k, badgeText: 5 * k, barH: 14 * k, wellPad: 5 * k, frame: 4 * k, nameLines: 1, minH: 52 * k,
    };
  }
  const k = width / 82;
  return {
    radius: 4 * k, padH: 4 * k, padTop: 4 * k, padBot: 4 * k, gap: 3 * k, ring: 2 * k,
    red: 2 * k, black: 1 * k, rule: 1 * k, gradeW: 24 * k,
    gem: 5 * k, ten: 14 * k, tenTrack: -0.6 * k, year: 0, name: 6 * k, no: 0,
    badge: 0, badgeText: 0, barH: 0, wellPad: 2 * k, frame: 2 * k, nameLines: 2, minH: 28 * k,
  };
}

const BAR_MOTIF = [1.5, 1, 0.5, 1, 1.5, 0.5, 0.5, 1.5, 2, 0.5, 0.5, 1.5, 1.5, 1, 0.5, 1.5, 2, 1, 0.5];

function Sheen({ width }: { width: number }) {
  const sweep = useSharedValue(0);
  useEffect(() => {
    // One translating gradient, forever, on the landing page. A phone keeps the slab and skips the sweep.
    if (phoneClassWeb()) { cancelAnimation(sweep); sweep.set(0); return; }
    sweep.set(withRepeat(withTiming(1, { duration: 5000, easing: Easing.linear }), -1));
    return () => cancelAnimation(sweep);
  }, [sweep]);
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * 0.8 + sweep.get() * width * 1.8 }, { rotate: '18deg' }],
  }));
  return (
    <View pointerEvents="none" style={s.sheenClip}>
      <Animated.View testID="season-sheen" style={[s.sheen, { width: width * 0.42, height: width * 2.2 }, motion]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

function Barcode({ width, height, scale }: { width: number; height: number; scale: number }) {
  const bars: React.ReactNode[] = [];
  let x = 0;
  let i = 0;
  while (x < width && i < 500) {
    const w = Math.max(0.5, BAR_MOTIF[i % BAR_MOTIF.length] * scale);
    bars.push(<View key={i} style={{ width: w, height, backgroundColor: i % 2 === 0 ? '#111111' : '#F7F4EC' }} />);
    x += w;
    i += 1;
  }
  return (
    <View testID="season-barcode" accessible={false} style={[s.barcode, { height, marginBottom: 3 * scale }]}>
      {bars}
    </View>
  );
}

function RingBadge({ size, fontSize }: { size: number; fontSize: number }) {
  return (
    <View style={[s.badge, { width: size, height: size, borderRadius: size / 2, borderWidth: Math.max(1, size * 0.12) }]}>
      <View pointerEvents="none" style={[s.badgeRing, { borderRadius: size / 2, borderWidth: Math.max(0.5, size * 0.06) }]} />
      <Text style={[s.badgeText, { fontSize, lineHeight: fontSize + 1 }]}>10</Text>
    </View>
  );
}

function ArtPlaceholder({ id, width, height }: { id: string; width: number; height: number }) {
  return (
    <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <RadialGradient id={id} cx="45%" cy="30%" rx="75%" ry="62%">
          <Stop offset="0" stopColor="#ffe566" />
          <Stop offset="0.34" stopColor="#e8a820" />
          <Stop offset="0.7" stopColor="#3a72c8" />
          <Stop offset="1" stopColor="#142848" />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

export function Slab({ prize, width, lip, sheen }: { prize: SeasonPrize; width: number; lip: 'grand' | 'mid'; sheen: boolean }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const m = metrics(lip, width);
  const grand = lip === 'grand';
  const line = SET_LINE[prize.set];
  const scale = grand ? width / 168 : width / 82;
  const innerW = Math.max(0, width - m.padH * 2 - m.wellPad * 2);
  const innerH = innerW * (88 / 63);
  const showPhoto = Boolean(prize.photo) && !photoFailed;
  const numberLine = line ? `${prize.number}/${line.printed} · CERT ${prize.cert}` : `#${prize.number} · CERT ${prize.cert}`;
  return (
    <View style={[s.case, grand ? s.caseGrand : s.caseMid, {
      width, borderRadius: m.radius, paddingTop: m.padTop, paddingBottom: m.padBot, paddingHorizontal: m.padH, gap: m.gap,
    }]}>
      <LinearGradient
        colors={['rgba(255,255,255,0.62)', 'rgba(230,235,245,0.18)', 'rgba(180,190,210,0.08)', 'rgba(255,255,255,0.4)']}
        locations={[0, 0.3, 0.65, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[s.lip, { top: m.ring, left: m.ring, right: m.ring, bottom: m.ring, borderRadius: Math.max(0, m.radius - 2) }]} />
      <View style={[s.label, { borderWidth: m.red }]}>
        <View style={[s.labelInner, { borderWidth: m.black }]}>
          <View style={[s.labelRow, { minHeight: m.minH }]}>
            <View style={[s.left, { borderRightWidth: m.rule, paddingHorizontal: grand ? 5 * scale : 2 * scale, paddingVertical: grand ? 4 * scale : 2 * scale }]}>
              {grand ? (
                <View style={s.brand}>
                  <RingBadge size={m.badge} fontSize={m.badgeText} />
                  <Text style={[s.year, { fontSize: m.year, lineHeight: m.year * 1.1 }]} numberOfLines={1}>
                    {line ? `${line.year} POKEMON ${line.code} EN` : prize.set.toUpperCase()}
                  </Text>
                </View>
              ) : null}
              <Text style={[s.name, { fontSize: m.name, lineHeight: m.name * (grand ? 1.05 : 1.1) }]} numberOfLines={m.nameLines}>
                {prize.name}
              </Text>
              {grand ? <Text style={[s.no, { fontSize: m.no, lineHeight: m.no * 1.1 }]} numberOfLines={1}>{numberLine}</Text> : null}
            </View>
            <View style={[s.grade, { width: m.gradeW }]}>
              <LinearGradient colors={['#fffef8', '#efe9dc']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
              <Text style={[s.gem, { fontSize: m.gem, letterSpacing: m.gem * 0.06 }]}>GEM MT</Text>
              <Text style={[s.ten, { fontSize: m.ten, lineHeight: m.ten, letterSpacing: m.tenTrack }]}>10</Text>
            </View>
          </View>
          {grand ? <Barcode width={Math.max(0, width - m.padH * 2)} height={m.barH} scale={scale} /> : null}
        </View>
      </View>
      <View style={[s.well, { padding: m.wellPad }]}>
        <View style={[s.card, { width: innerW, height: innerH }]}>
          {showPhoto ? (
            <Image source={{ uri: prize.photo }} style={{ width: innerW, height: innerH }} resizeMode="cover" onError={() => setPhotoFailed(true)} accessibilityIgnoresInvertColors />
          ) : (
            <ArtPlaceholder id={`${raw}a`} width={innerW} height={innerH} />
          )}
          {showPhoto ? null : (
            <View pointerEvents="none" style={[s.frame, { top: m.frame, left: m.frame, right: m.frame, bottom: m.frame }]} />
          )}
        </View>
      </View>
      {sheen ? <Sheen width={width} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  case: { overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.75)' },
  caseGrand: { shadowColor: '#FFD700', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 14 } },
  caseMid: { shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 6 } },
  lip: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  label: { backgroundColor: '#F7F4EC', borderColor: '#C4122F', overflow: 'hidden' },
  labelInner: { borderColor: '#1a1a1a' },
  labelRow: { flexDirection: 'row', alignItems: 'stretch' },
  left: { flex: 1, minWidth: 0, borderRightColor: '#1a1a1a', justifyContent: 'flex-start' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badge: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', borderColor: '#C4122F' },
  badgeRing: { position: 'absolute', top: 1, left: 1, right: 1, bottom: 1, borderColor: '#C4122F' },
  badgeText: { fontFamily: font.bold, color: '#C4122F' },
  year: { flex: 1, fontFamily: font.bold, color: '#111111', letterSpacing: 0.2 },
  name: { fontFamily: font.bold, color: '#000000', textTransform: 'uppercase' },
  no: { fontFamily: font.bold, color: '#222222' },
  grade: { alignItems: 'center', justifyContent: 'center' },
  gem: { fontFamily: font.bold, color: '#111111', textAlign: 'center' },
  ten: { fontFamily: font.bold, color: '#000000', textAlign: 'center' },
  barcode: { marginHorizontal: 4, borderTopWidth: 1, borderTopColor: '#dddddd', flexDirection: 'row', overflow: 'hidden' },
  well: { alignSelf: 'stretch', borderRadius: 2, backgroundColor: '#0c0e14', overflow: 'hidden' },
  card: { alignSelf: 'center', overflow: 'hidden' },
  frame: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,215,80,0.85)' },
  sheenClip: { ...StyleSheet.absoluteFill, overflow: 'hidden', zIndex: 3 },
  sheen: { position: 'absolute', top: '-40%' },
});
