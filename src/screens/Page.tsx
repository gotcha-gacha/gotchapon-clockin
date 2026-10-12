// Shared page shell: the design pads every page 64px (under the header) / 16px / 116px (above the dots).
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { railHeight } from '@/components/PageDots';
import { color, space } from '@/theme/tokens';
import { font } from '@/theme/fonts';

// The design pads pages 64 / 16 / 116 inside a notch-free 430×880 frame. On a device the header and
// the dots sit inside the safe areas, so the paddings grow by the insets.
// `overlay` renders above the scroll content, anchored to the page frame (sheets, toasts).
// `pinBottom` keeps a short page on the rail (#340): spare height sits above the machine, not as a
// band between the tray and the nav.
const RAIL_GAP = 8;

export function Page({ children, overlay, scroll = true, pinBottom = false, scrollToken = 0 }: { children: React.ReactNode; overlay?: React.ReactNode; scroll?: boolean; pinBottom?: boolean; scrollToken?: number }) {
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (!scrollToken) return;
    scroller.current?.scrollTo({ y: 0, animated: true });
  }, [scrollToken]);
  const pad = {
    paddingTop: insets.top + 56,
    paddingBottom: pinBottom ? railHeight(insets.bottom) + RAIL_GAP : 102 + insets.bottom,
  };
  const content = [s.pad, pad, pinBottom && s.pin];
  const body = scroll ? (
    <ScrollView ref={scroller} style={s.page} contentContainerStyle={content} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[s.page, content]}>{children}</View>
  );
  return (
    <View style={s.page}>
      {body}
      {overlay}
    </View>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.h2}>{title}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, width: '100%' },
  pad: { paddingHorizontal: space.gutter },
  pin: { flexGrow: 1, justifyContent: 'flex-end' },
  h2: { fontFamily: font.black, fontSize: 20, color: color.text, marginTop: 6, marginBottom: 2 },
  sub: { fontFamily: font.semibold, fontSize: 13, color: color.text2, lineHeight: 18 },
});
