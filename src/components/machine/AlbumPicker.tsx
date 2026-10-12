// Targeted-pull album picker (F2.8; README "Under the machine": shown only while a targeted pull is active. The v4 canvas
// does not draw it, so it is built in the pack's style.) Each open album shows its cover card and how much of it is
// held; the album being chased is rimmed mint. Tapping another switches the chase while the machine is idle. A
// complete album's partner pack takes this row, so it cannot be picked.
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Album, Holding } from '@/api/contract';
import { albumProgress } from '@/components/albums/AlbumsGrid';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { GLOBE_CAP } from './CapsuleGlobe';

/** Design-pack album swatches (`design/cards.js` c1). The chase globe and the dispensed shell share one. */
export const ALBUM_SWATCH: Record<string, string> = {
  A: '#FFD23F',
  B: '#8FE3C5',
  C: '#C9A7FF',
};

export function albumSwatch(albumId: string): string {
  return ALBUM_SWATCH[albumId] ?? color.tierCommon;
}

/** Chase globe: the whole album, capped at what the globe can draw. Holdings do not shrink it (#391). */
export function targetCapsules(album: Album): number {
  return Math.min(album.size, GLOBE_CAP);
}

export function AlbumPicker({ albums, holdings, selectedId, disabled = false, onPick }: {
  albums: Album[];
  holdings: Record<string, Holding>;
  selectedId: string;
  /** A pull is under way: the chase cannot switch. */
  disabled?: boolean;
  onPick: (albumId: string) => void;
}) {
  const open = albums.filter((a) => a.status !== 'soon');
  if (open.length < 2) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.label}>Chase an album</Text>
      <View style={s.row}>
        {open.map((a) => {
          const { have, total, done } = albumProgress(a, holdings);
          const on = a.id === selectedId;
          const closed = done || (disabled && !on);
          return (
            <Pressable
              key={a.id}
              onPress={() => onPick(a.id)}
              disabled={on || done || disabled}
              accessibilityRole="button"
              accessibilityLabel={`${a.title}, ${done ? 'complete' : `${have} of ${total}`}`}
              accessibilityState={{ selected: on, disabled: on || done || disabled }}
              style={({ pressed }) => [s.chip, on && s.chipOn, closed && s.chipClosed, pressed && s.pressed]}
            >
              <View style={s.cover}><Image source={{ uri: a.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="contain" /></View>
              <View style={s.copy}>
                <Text style={s.title} numberOfLines={1}>{a.title}</Text>
                <Text style={[s.sub, on && s.subOn]}>{done ? 'Complete' : `${have} of ${total}`}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 14 },
  label: { fontFamily: font.bold, fontSize: 11, color: color.text3, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexGrow: 1, flexBasis: '46%', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 8 },
  chipOn: { borderColor: 'rgba(143,227,197,0.7)', backgroundColor: 'rgba(143,227,197,0.1)' },
  chipClosed: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.97 }] },
  cover: { width: 34, height: 48, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.extrabold, fontSize: 12.5, color: color.text },
  sub: { fontFamily: font.semibold, fontSize: 11, color: color.text2 },
  subOn: { color: color.mint },
});
