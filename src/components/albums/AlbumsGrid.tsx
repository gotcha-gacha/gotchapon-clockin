// Albums grid (F3.1, design "2. Albums"): 3×3 covers — the album's cover card shown as a card,
// tilted −4°, never cropped into a banner; gold "Complete" pill when done; SOON scrim for upcoming;
// a 25-slot progress bar and count on every cover.
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Album, Holding } from '@/api/contract';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

const GAP = 10;
const SWATCH = ['#3A2B5C', '#1F3F5C', '#4A2A2A', '#2A4A3A', '#4A3A1F', '#2A2A4A', '#3F2A4A', '#1F4A4A', '#4A1F3A'];

export function albumProgress(album: Album, holdings: Record<string, Holding>) {
  const have = album.cards.filter((c) => (holdings[c.id]?.qty ?? 0) > 0).length;
  return { have, total: album.size, done: album.cards.length > 0 && have >= album.size };
}

function Cover({ album, index, holdings, onOpen, width }: { album: Album; index: number; holdings: Record<string, Holding>; onOpen: (id: string) => void; width: number }) {
  // Only an upcoming set is closed. A restocking album is still the user's binder: it opens, pulls just skip it.
  const soon = album.status === 'soon';
  const { have, total, done } = albumProgress(album, holdings);
  return (
    <Pressable onPress={() => !soon && onOpen(album.id)} disabled={soon} style={({ pressed }) => [s.cover, { width, height: (width * 4.2) / 3, backgroundColor: SWATCH[index % SWATCH.length], borderColor: done ? '#E9C46A' : 'rgba(255,255,255,0.12)' }, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel={`${album.title}, ${have} of ${total}`}>
      <View style={s.dots} pointerEvents="none">
        {Array.from({ length: 24 }, (_, i) => <View key={i} style={[s.dot, { left: 6 + (i % 6) * 14 + ((Math.floor(i / 6) % 2) * 7), top: 6 + Math.floor(i / 6) * 14 }]} />)}
      </View>
      {!soon ? (
        <View style={[s.coverCard, { left: width * 0.21, top: width * 0.07, width: width * 0.58, height: width * 0.58 * 1.4 }]}>
          <Image source={{ uri: album.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={`${album.title} cover card`} />
        </View>
      ) : (
        <View style={s.soon}><Text style={s.soonText}>SOON</Text></View>
      )}
      <LinearGradient colors={['rgba(6,8,18,0)', 'rgba(6,8,18,0.88)']} locations={[0, 0.6]} style={s.foot}>
        <Text style={s.title} numberOfLines={2}>{album.title}</Text>
        <View style={s.meterRow}>
          <View style={s.meter}><View style={[s.meterFill, { width: `${Math.round((have / total) * 100)}%` }]} /></View>
          <Text style={s.count}>{have}/{total}</Text>
        </View>
      </LinearGradient>
      {album.status === 'restocking' ? <View style={s.restock}><Text style={s.restockText}>Restocking</Text></View> : null}
      {done ? <View style={s.complete}><Text style={s.completeText}>Complete</Text></View> : null}
    </Pressable>
  );
}

export function AlbumsGrid({ albums, holdings, onOpen }: { albums: Album[]; holdings: Record<string, Holding>; onOpen: (id: string) => void }) {
  // Covers are sized from the measured row: a percentage width + aspectRatio collapses to zero height
  // inside the page's ScrollView on RN 0.86.
  const [gridW, setGridW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setGridW(e.nativeEvent.layout.width);
  const coverW = Math.floor((gridW - GAP * 2) / 3);
  return (
    <View style={s.grid} onLayout={onLayout} testID="albums-grid">
      {gridW > 0 ? albums.map((a, i) => <Cover key={a.id} album={a} index={i} holdings={holdings} onOpen={onOpen} width={coverW} />) : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cover: { borderRadius: 14, overflow: 'hidden', borderWidth: 2, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  dots: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.5 },
  dot: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.35)' },
  coverCard: { position: 'absolute', borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', transform: [{ rotate: '-4deg' }], shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  soon: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(6,8,18,0.55)', alignItems: 'center', justifyContent: 'center' },
  soonText: { fontFamily: font.black, fontSize: 11, letterSpacing: 1.5, color: color.text2 },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 22, paddingHorizontal: 8, paddingBottom: 8 },
  title: { fontFamily: font.black, fontSize: 11.5, color: '#fff', lineHeight: 13.5 },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  meter: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 99, overflow: 'hidden' },
  meterFill: { height: '100%', backgroundColor: color.mint, borderRadius: 99 },
  count: { fontFamily: font.extrabold, fontSize: 9.5, color: color.text },
  complete: { position: 'absolute', top: 6, right: 6, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 99, backgroundColor: '#E9C46A' },
  restock: { position: 'absolute', top: 6, left: 6, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 99, backgroundColor: color.tickerAmber },
  restockText: { fontFamily: font.extrabold, fontSize: 9, color: color.inkOnYellow },
  completeText: { fontFamily: font.extrabold, fontSize: 9, color: '#3A2430' },
});
