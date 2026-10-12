// Result bar (F2.6, design "Result sheet"): chip, name, the result (up to two lines, so a milestone's "5/25!" at the
// end is never cut off beside the button, F3.4), "Into binder →". Rises in
// over 380 ms. For a spread the chip is ×N and the button waits until every card is flipped. A MagicBlock pull adds one
// "Check the draw" link once its draw's page is known (#418, state/drawLink).
import React, { useEffect } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RESULT_GAP, railHeight } from '@/components/PageDots';
import { color } from '@/theme/tokens';
import { useFocusWhenShown } from '@/components/webFocus';
import { font } from '@/theme/fonts';

type ResultBarProps = {
  chip: string;
  chipBg: string;
  chipInk: string;
  chipGlow: string;
  title: string;
  sub: string;
  /** Day-5 reveal only. Clears when the result bar unmounts with the card. */
  bonusChip?: string;
  canSettle: boolean;
  onSettle: () => void;
  /** The draw's transaction page (state/drawLink), already built: the press opens it with no await in between. */
  drawUrl?: string | null;
};

export function ResultBar(p: ResultBarProps) {
  const y = useSharedValue(48), op = useSharedValue(0);
  useEffect(() => { y.set(withTiming(0, { duration: 380, easing: Easing.bezier(0.2, 0.9, 0.2, 1) })); op.set(withTiming(1, { duration: 300 })); }, [y, op]);
  const st = useAnimatedStyle(() => ({ opacity: op.get(), transform: [{ translateY: y.get() }] }));
  // On the web the button takes keyboard focus as it appears (W1.6): space pulled, space opened the capsule, enter puts the
  // card away. The keyboard bridge is deliberately inert on a revealed card (plan §4.3); this button's own press is the way on.
  const settle = useFocusWhenShown();
  // `bottom: 70` cleared the design's page dots. The labeled rail is that tall plus the home
  // indicator, and it paints over this sheet (zIndex 8 over 6) when the number stays 70.
  const insets = useSafeAreaInsets();
  return (
    <Animated.View style={[s.bar, st, { bottom: railHeight(insets.bottom) + RESULT_GAP }]}>
      <View style={[s.chip, { backgroundColor: p.chipBg, shadowColor: p.chipGlow }]}><Text style={[s.chipText, { color: p.chipInk }]}>{p.chip}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title} numberOfLines={1}>{p.title}</Text>
        <Text style={s.sub} numberOfLines={2}>{p.sub}</Text>
        {p.bonusChip ? <BonusChip label={p.bonusChip} /> : null}
        {p.drawUrl ? (
          <Pressable onPress={() => { void Linking.openURL(p.drawUrl!).catch(() => {}); }} accessibilityRole="link" accessibilityLabel="Check the draw" hitSlop={6} style={s.drawLink}>
            <Text style={s.drawLinkText}>Check the draw</Text>
          </Pressable>
        ) : null}
      </View>
      {p.canSettle ? (
        <Pressable ref={settle} onPress={p.onSettle} style={({ pressed }) => [s.btnWrap, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel="Into binder">
          <LinearGradient colors={['#FFE066', '#FFD23F']} style={s.btn}><Text style={s.btnText}>Into binder →</Text></LinearGradient>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function BonusChip({ label }: { label: string }) {
  const reduced = useReducedMotion() === true;
  const scale = useSharedValue(reduced ? 1 : 0.4);
  useEffect(() => {
    if (reduced) return;
    scale.set(withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [reduced, scale]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={[s.bonus, pop]} accessibilityLabel={label}>
      <Text style={s.bonusText}>{label}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(14,19,38,0.94)', borderWidth: 1, borderColor: color.glassBorder, borderRadius: 20, paddingVertical: 12, paddingLeft: 14, paddingRight: 12, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 44, shadowOffset: { width: 0, height: 18 }, zIndex: 6 },
  chip: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.7, shadowRadius: 18 },
  chipText: { fontFamily: font.black, fontSize: 8.5, letterSpacing: 0.3, textAlign: 'center' },
  title: { fontFamily: font.black, fontSize: 16, color: color.text, letterSpacing: -0.2 },
  sub: { fontFamily: font.semibold, fontSize: 12, color: color.text2, marginTop: 1 },
  bonus: { alignSelf: 'flex-start', marginTop: 6, borderRadius: 99, backgroundColor: color.yellow, paddingVertical: 3, paddingHorizontal: 8 },
  bonusText: { fontFamily: font.black, fontSize: 11, color: color.inkOnYellow },
  drawLink: { alignSelf: 'flex-start', marginTop: 4 },
  drawLinkText: { fontFamily: font.semibold, fontSize: 12, color: color.text2, textDecorationLine: 'underline' },
  btnWrap: { borderRadius: 14, shadowColor: color.yellow, shadowOpacity: 0.35, shadowRadius: 22 },
  btn: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: color.yellowShadow },
  btnText: { fontFamily: font.extrabold, fontSize: 14, color: color.inkOnYellow },
});
