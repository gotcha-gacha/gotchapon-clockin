// Shown instead of the app in a tab that is not the active one (web only; W0.2b, #136). The machine, the binder and the wallet
// all run in one tab at a time: two would share one store and one balance, and a paid pull must never depend on which tab wrote last.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PRODUCT_NAME } from '@/brand/name';
import { color, radius } from '@/theme/tokens';
import { font } from '@/theme/fonts';

export function OtherTabCard({ onUseHere }: { onUseHere: () => void }) {
  return (
    <View style={s.wrap} accessibilityRole="alert" testID="other-tab-card">
      <Text style={s.title}>{PRODUCT_NAME} is open in another tab</Text>
      <Text style={s.body}>Your machine, binder and balance run in one tab at a time.</Text>
      <Pressable onPress={onUseHere} style={({ pressed }) => [s.btn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
        <Text style={s.btnText}>Use it here</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.room, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  title: { fontFamily: font.black, fontSize: 18, color: color.text, textAlign: 'center' },
  body: { fontFamily: font.semibold, fontSize: 13, lineHeight: 19, color: color.text2, textAlign: 'center', maxWidth: 300 },
  btn: { marginTop: 10, borderRadius: radius.button, paddingVertical: 13, paddingHorizontal: 26, backgroundColor: color.yellow, borderBottomWidth: 3, borderBottomColor: color.yellowShadow },
  btnText: { fontFamily: font.extrabold, fontSize: 15, color: color.inkOnYellow },
});
