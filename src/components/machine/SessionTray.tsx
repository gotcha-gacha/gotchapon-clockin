// "This session" tray (F2.9, design "Under the machine"): up to 24 of this session's pulls, newest first, five
// wide; rares rimmed in their tier colour (holo and up also glow), new commons marked with a mint dot, and a tally.
// Cells are sized from the measured row: percentage width + aspectRatio collapses inside the page ScrollView.
import React, { useState } from 'react';
import { Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { Outcome } from '@/api/contract';
import { TIER, hexGlow } from '@/components/reveal/tiers';
import { spreadSummary } from '@/components/reveal/Spread';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

const COLS = 5;
const GAP = 6;

export function SessionTray({ recent, pulled }: { recent: Outcome[]; pulled: number }) {
  const [rowW, setRowW] = useState(0);
  if (!recent.length) return null;
  const { fresh, rares } = spreadSummary(recent);
  const tally = `${pulled} pulled · ${fresh} new${rares ? ` · ${rares} rare${rares > 1 ? 's' : ''}` : ''}`;
  const cellW = Math.floor((rowW - GAP * (COLS - 1)) / COLS);
  const cell = { width: cellW, height: (cellW * 7) / 5 };
  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.label}>This session</Text>
        <Text style={s.tally}>{tally}</Text>
      </View>
      <View style={s.grid} testID="session-tray" onLayout={(e: LayoutChangeEvent) => setRowW(e.nativeEvent.layout.width)}>
        {rowW > 0 && recent.map((o, i) => {
          const spec = TIER[o.rarity];
          const isNew = !o.isDupe && spec.lvl < 1;
          return (
            // Newest is index 0; `pulled - i` stays the same for a card as newer pulls are prepended.
            <View key={`${pulled - i}-${o.cardId}`} style={[s.cell, cell, spec.lvl >= 2 && { shadowColor: hexGlow(spec.glow), shadowOpacity: 1, shadowRadius: 8 }]} accessible accessibilityLabel={`${o.card.name}${isNew ? ', new' : spec.lvl >= 1 ? `, ${spec.tag}` : ''}`}>
              <View style={[StyleSheet.absoluteFill, s.face, { borderColor: spec.lvl >= 1 ? spec.glow : 'rgba(255,255,255,0.3)' }]}>
                <Image source={{ uri: o.card.imgSmall }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                {isNew ? <View style={s.dot} /> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 14 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  label: { fontFamily: font.bold, fontSize: 11, color: color.text3 },
  tally: { fontFamily: font.bold, fontSize: 11, color: color.text2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, minHeight: 10 },
  cell: { borderRadius: 6, shadowOffset: { width: 0, height: 0 } },
  face: { borderRadius: 6, overflow: 'hidden', borderWidth: 2, backgroundColor: '#1B2033' },
  dot: { position: 'absolute', top: 3, left: 3, width: 7, height: 7, borderRadius: 3.5, backgroundColor: color.mint, shadowColor: color.mint, shadowOpacity: 1, shadowRadius: 4 },
});
