// Geo-block (F5.3; not in the design pack, built in its style: the sign-in room, a dimmed capsule, plain copy). A full-screen
// stop when the user's country is closed: nothing can be pulled, deposited or shipped from here, and nothing is charged.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PRODUCT_NAME } from '@/brand/name';
import { countryName } from '@/config/geo';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

export function GeoBlockScreen({ country }: { country?: string | null }) {
  return (
    <LinearGradient colors={['#141C3A', '#05070F']} style={s.fill} testID="geo-block">
      <View style={s.capsule} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={s.capTop} />
        <View style={s.capBottom} />
      </View>
      <Text style={s.title} accessibilityRole="header">Not available in {countryName(country)}</Text>
      <Text style={s.body}>Pulls, deposits and shipping are closed where you are, so the machine stays off. Nothing has been charged.</Text>
      <Text style={s.foot}>If you are travelling, {PRODUCT_NAME} opens again when you are back in a country we serve.</Text>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  capsule: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', opacity: 0.7, marginBottom: 18, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 15, shadowOffset: { width: 0, height: 14 } },
  capTop: { flex: 1, backgroundColor: '#4A5270' },
  capBottom: { flex: 1, backgroundColor: '#F4F6FB' },
  title: { fontFamily: font.black, fontSize: 21, color: color.text, textAlign: 'center' },
  body: { fontFamily: font.semibold, fontSize: 13.5, color: color.text2, textAlign: 'center', lineHeight: 20, marginTop: 10, maxWidth: 300 },
  foot: { fontFamily: font.semibold, fontSize: 12, color: color.text3, textAlign: 'center', lineHeight: 17, marginTop: 14, maxWidth: 280 },
});
