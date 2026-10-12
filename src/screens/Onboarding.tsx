// Onboarding (three sheets — what this is · how pulls work · album-complete partner pack). The design drew them over
// the dimmed Pull page; since #210 the app lands on the Binder, so that is what is dimmed behind them, and the last
// button names that page. "Pull my first one" is the first sheet's story (the next sheet is the card landing in the
// binder), not a navigation.
// No age confirmation (Ben, 17 Sept, #116). Seen once per device (settings.onboarded).
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { PACK_COPY } from '@/config/partnerPack';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

const SHEETS = [
  { t: 'Real trading cards', b: 'Every capsule holds a real trading card. Turn the crank to see what you get.', c: 'Pull my first one' },
  { t: 'It went into your binder', b: "Every card belongs to one of nine albums. Fill an album's 25 slots and it stays yours forever.", c: 'Got it' },
  { t: PACK_COPY.onboardTitle, b: PACK_COPY.onboardBody, c: 'See my binder' },
];

function Cap({ size, top, lift, glow }: { size: number; top: string; lift: number; glow?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', transform: [{ translateY: -lift }], shadowColor: glow ? color.mint : '#000', shadowOpacity: glow ? 0.5 : 0.5, shadowRadius: glow ? 30 : 24, shadowOffset: { width: 0, height: 10 } }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: size / 2, backgroundColor: top }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: size / 2, backgroundColor: '#E8ECF6' }} />
    </View>
  );
}

function Illustration({ index }: { index: number }) {
  if (index === 0) return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
      <Cap size={56} top={color.rimCoral} lift={14} /><Cap size={70} top={color.mint} lift={0} glow /><Cap size={56} top={color.tierHolo} lift={8} />
    </View>
  );
  if (index === 1) {
    const filled = [1, 1, 0, 1, 0, 0, 1, 2, 1, 0, 1, 0, 1, 1, 0];
    return (
      <View style={{ width: 34 * 5 + 5 * 4, flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
        {filled.map((f, i) => <View key={i} style={[s.slot, f === 1 && { backgroundColor: '#F7F8FC' }, f === 2 && { borderWidth: 2, borderColor: color.mint, backgroundColor: 'rgba(143,227,197,0.15)', shadowColor: color.mint, shadowOpacity: 0.7, shadowRadius: 14 }]} />)}
      </View>
    );
  }
  return (
    <View style={s.holo}>
      <View style={s.holoArt}><View style={s.holoBlob} /></View>
    </View>
  );
}

export function Onboarding() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const i = auth.onboardingIndex;
  const sheet = SHEETS[i];

  return (
    <View style={s.dim} pointerEvents="auto">
      <LinearGradient colors={['#151C36', '#0D1226']} style={[s.sheet, { marginBottom: insets.bottom + 16 }]}>
        <View style={s.dots}>{[0, 1, 2].map((d) => <View key={d} style={[s.dot, d === i && s.dotOn]} />)}</View>
        <View style={s.stage}><Illustration index={i} /></View>
        <Text style={s.title}>{sheet.t}</Text>
        <Text style={s.body}>{sheet.b}</Text>
        <Pressable onPress={auth.nextSheet} style={({ pressed }) => [s.cta, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button">
          <Text style={s.ctaText}>{sheet.c}</Text>
        </Pressable>
        {i === 0 ? <Pressable onPress={auth.skipOnboarding} hitSlop={8} accessibilityRole="button"><Text style={s.skip}>Skip</Text></Pressable> : null}
      </LinearGradient>
    </View>
  );
}

const s = StyleSheet.create({
  dim: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,6,14,0.78)', justifyContent: 'flex-end', padding: 16, zIndex: 12 },
  sheet: { borderRadius: 26, borderWidth: 1, borderColor: color.glassBorder, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 70, shadowOffset: { width: 0, height: 30 } },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotOn: { width: 18, backgroundColor: color.yellow },
  stage: { height: 150, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  slot: { width: 34, height: 34 * 7 / 5, borderRadius: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.3)' },
  holo: { width: 96, height: 134, borderRadius: 10, backgroundColor: '#F7F8FC', borderWidth: 5, borderColor: '#F2B8D0', overflow: 'hidden', shadowColor: color.tierHolo, shadowOpacity: 0.5, shadowRadius: 40 },
  holoArt: { position: 'absolute', left: 6, top: 6, right: 6, height: 66, borderRadius: 5, backgroundColor: 'hsl(205, 70%, 90%)' },
  holoBlob: { position: 'absolute', left: '10%', top: '10%', width: '65%', height: '65%', borderRadius: 999, backgroundColor: 'hsl(210, 80%, 62%)' },
  title: { fontFamily: font.black, fontSize: 18, color: color.text, textAlign: 'center' },
  body: { fontFamily: font.semibold, fontSize: 13, color: color.text2, textAlign: 'center', lineHeight: 19, marginTop: 6, marginBottom: 16 },
  cta: { alignSelf: 'stretch', alignItems: 'center', borderRadius: 14, paddingVertical: 14, backgroundColor: color.yellow, borderBottomWidth: 3, borderBottomColor: color.yellowShadow, shadowColor: color.yellow, shadowOpacity: 0.35, shadowRadius: 28 },
  ctaText: { fontFamily: font.extrabold, fontSize: 16, color: color.inkOnYellow },
  skip: { marginTop: 12, fontFamily: font.semibold, fontSize: 12, color: color.text2, textDecorationLine: 'underline' },
});
