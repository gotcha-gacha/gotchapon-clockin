// Extras (F2.9, F4.1; design "Albums"): copies a user holds beyond the one kept in the binder, shown under the album
// grid with the burn offer. The title count is the server's `extras` (what POST /burns checks); the thumbs come from
// holdings, and the binder's Extras shelf reuses them. At five the card turns mint and the button starts the hand-off
// (F4.2, BurnGather). When that finishes, five extras become one free pull. No card is awarded then.
import React, { useRef } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BURN_COST, type Album, type Holding } from '@/api/contract';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

export type ExtraRef = { id: string; name: string; imgSmall: string; count: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const EXTRAS_NOTE = 'Extras go back into the machine. You keep one of each.';
/** The burn offer while a pull is already open. The count may still be the pre-burn number until the burn lands; it is not a live offer. */
export const EXTRAS_UNAVAILABLE = 'Unavailable until this pull is in your binder';
/** The extras shelf's thumbnail size and gap: the burn hand-off (BurnGather) lifts its copies from exactly these positions. */
export const THUMB_W = 38;
export const THUMB_H = 53;
export const THUMB_GAP = 6;

/** Copies beyond the first of each card. `holdings` is keyed by holdingKey, where a common's key is its card id. */
export function extrasIn(cards: Album['cards'], holdings: Record<string, Holding>): ExtraRef[] {
  return cards.flatMap((c) => {
    const qty = holdings[c.id]?.qty ?? 0;
    return qty > 1 ? [{ id: c.id, name: c.name, imgSmall: c.imgSmall, count: qty - 1 }] : [];
  });
}

export function ExtraThumbs({ extras }: { extras: ExtraRef[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: THUMB_GAP }}>
      {extras.map((e) => (
        <View key={e.id} style={s.thumb}>
          <Image source={{ uri: e.imgSmall }} style={[StyleSheet.absoluteFill, { opacity: 0.8 }]} resizeMode="cover" accessibilityLabel={e.name} />
          <View style={s.x}><Text style={s.xText}>×{e.count}</Text></View>
        </View>
      ))}
    </ScrollView>
  );
}

export function ExtrasCard({ count, extras, canBurn = true, dimmed = false, onBurn, onMeasured }: {
  count: number;
  extras: ExtraRef[];
  canBurn?: boolean;
  /** The hand-off is lifting copies out of the shelf (F4.2): the originals fade back. */
  dimmed?: boolean;
  onBurn?: () => void;
  /** Where the shelf's thumbs sit on screen when Burn is pressed, so the hand-off lifts copies from there. */
  onMeasured?: (r: Rect) => void;
}) {
  const row = useRef<View>(null);
  if (count <= 0) return null;
  const ready = count >= BURN_COST;
  // Five extras during a pull still in progress is not a second burn. The mint offer would read as spendable while the button is dead.
  const offered = ready && canBurn;
  const enabled = offered && !!onBurn;
  const sub = ready && !canBurn ? EXTRAS_UNAVAILABLE : ready ? `Burn ${BURN_COST} for a free pull — ready` : `Burn ${BURN_COST} for a free pull · ${BURN_COST - count} to go`;
  return (
    <View style={[s.card, offered && s.cardReady]} testID="extras-card">
      <View style={s.row}>
        <View style={s.copy}>
          <Text style={s.title}>{`Extras · ${count}`}</Text>
          <Text style={s.sub}>{sub}</Text>
        </View>
        <Pressable
          onPress={() => { row.current?.measureInWindow((x, y, width, height) => onMeasured?.({ x, y, width, height })); onBurn?.(); }}
          disabled={!enabled}
          accessibilityRole="button"
          accessibilityLabel={`Burn ${BURN_COST} extras for a free pull`}
          accessibilityState={{ disabled: !enabled }}
          style={({ pressed }) => [s.btn, offered && s.btnReady, pressed && s.pressed]}
        >
          <Text style={[s.btnText, offered && s.btnTextReady]}>{`Burn ${BURN_COST} → free pull`}</Text>
        </Pressable>
      </View>
      {extras.length ? <View ref={row} style={[s.thumbs, (dimmed || !canBurn) && s.dimmed]}><ExtraThumbs extras={extras} /></View> : null}
      <Text style={s.note}>{EXTRAS_NOTE}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.13)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.extrabold, fontSize: 13.5, color: color.text },
  sub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text2 },
  btn: { borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.08)', opacity: 0.6 },
  btnText: { fontFamily: font.extrabold, fontSize: 13, color: color.text2 },
  cardReady: { borderColor: 'rgba(143,227,197,0.6)' },
  btnReady: { backgroundColor: color.mint, opacity: 1, shadowColor: color.mint, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  btnTextReady: { color: color.inkOnMint },
  pressed: { transform: [{ scale: 0.96 }] },
  thumbs: { marginTop: 10 },
  dimmed: { opacity: 0.25 },
  note: { fontFamily: font.semibold, fontSize: 11, color: color.text3, marginTop: 8 },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  x: { position: 'absolute', top: 2, left: 2, borderRadius: 99, paddingHorizontal: 4, backgroundColor: color.mint },
  xText: { fontFamily: font.extrabold, fontSize: 8, color: color.inkOnMint },
});
