// An address that is not one of the app's (W2.2, #129; plan §4.4). Drawn inside the cabinet like every other screen: the
// catch-all route answers every path with 200, so the app itself recognises the unknown ones. The status stays 200 (a soft
// 404), so the page asks search engines not to keep it. Built in the geo-block screen's style: the room, a dimmed capsule,
// plain copy, and one way back to the machine.
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { DocTitle } from '@/web/DocHead';
import { titled } from '@/navigation/appPaths';
import { showNotFound } from '@/navigation/notFoundShown';
import { color, radius } from '@/theme/tokens';
import { font } from '@/theme/fonts';

/** Back to the machine. On the web, a page load of `/`: `router.replace('/')` from inside the catch-all route re-renders the
 *  same route in place and leaves the bad address in the bar (seen: `/nope` stayed, and `/binder/A/x` became `/binder/A`), so
 *  a reload came straight back here. Nothing on this page is in progress, so a load costs nothing. `replace`, so Back does
 *  not return to the dead address. */
export function goHome(routerReplace: (href: '/') => void, load: (href: string) => void = (h) => window.location.replace(h)): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') load('/');
  else routerReplace('/');
}

export function NotFound() {
  const router = useRouter();
  useEffect(() => showNotFound(), []); // the QR of the page reads it (notFoundShown.ts)
  return (
    <LinearGradient colors={['#141C3A', '#05070F']} style={s.fill} testID="not-found">
      <DocTitle title={titled('Not found')} noindex />
      <View style={s.capsule} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={s.capTop} />
        <View style={s.capBottom} />
      </View>
      <Text style={s.title} accessibilityRole="header">Nothing at this address</Text>
      <Text style={s.body}>The link may be old or mistyped. The machine is where it always is.</Text>
      <Pressable onPress={() => goHome(router.replace)} style={({ pressed }) => [s.btn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
        <Text style={s.btnText}>Go to the machine</Text>
      </Pressable>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  capsule: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', opacity: 0.7, marginBottom: 18 },
  capTop: { flex: 1, backgroundColor: '#4A5270' },
  capBottom: { flex: 1, backgroundColor: '#F4F6FB' },
  title: { fontFamily: font.black, fontSize: 21, color: color.text, textAlign: 'center' },
  body: { fontFamily: font.semibold, fontSize: 13.5, color: color.text2, textAlign: 'center', lineHeight: 20, marginTop: 10, maxWidth: 300 },
  btn: { marginTop: 20, borderRadius: radius.button, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: color.yellow },
  btnText: { fontFamily: font.extrabold, fontSize: 14, color: color.inkOnYellow },
});
