// Header on every page. Signed in and past onboarding: streak pill, tickets pill, then the right group
// (DEMO, settings, sound, and balance off Pull). The left pills never shrink.
// The daily-capsule claim pill is gone (#376). The mint free-count pill is gone (#385): a burn credit
// still lives on the machine, and the header does not advertise a free count. Replay mode is not built.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PENDING_COUNT } from '@/format';
import { PAGE, balanceText, useSession } from '@/state/session';
import { useAuth } from '@/auth/AuthProvider';
import { useSeason } from '@/state/season';
import { color, radius } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { StreakPill } from './header/StreakPill';
import { TicketsPill } from './header/TicketsPill';
import { StreakSheet } from './header/StreakSheet';
import { useTabVisible } from '@/web/phoneWeb';

function RoundButton({ glyph, onPress, label, dim, strike }: { glyph: string; onPress: () => void; label: string; dim?: boolean; strike?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [s.round, pressed && { transform: [{ scale: 0.96 }] }]}>
      <Text style={[s.roundGlyph, dim && { color: 'rgba(159,176,216,0.4)' }, strike && { textDecorationLine: 'line-through' }]}>{glyph}</Text>
    </Pressable>
  );
}

const EMPTY_STREAK = { count: 0, countedToday: false, bonusJustEarned: false };

export function HeaderOverlay({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { page, setPage, balanceUsd, balanceKnown, muted, toggleMuted, usingMock, devDeposit, closeAlbum } = useSession();
  const auth = useAuth();
  const { streak, tickets, popToken, focusRaffle, refresh } = useSeason();
  const insets = useSafeAreaInsets();
  const [streakOpen, setStreakOpen] = useState(false);
  const onPull = page === PAGE.pull;
  const tabVisible = useTabVisible();
  const showPills = auth.stage === 'done';
  useEffect(() => { if (showPills) void refresh(); }, [showPills, refresh]);
  const face = streak ?? EMPTY_STREAK;
  const goPull = () => { setStreakOpen(false); setPage(PAGE.pull); };
  const goRaffle = () => { setStreakOpen(false); closeAlbum(); setPage(PAGE.albums); focusRaffle(); };

  return (
    <View pointerEvents="box-none" style={[s.host, streakOpen && s.hostOpen]}>
      {/* The design fades its bar from 0.85 to clear behind glass pills (a backdrop blur). RN has no backdrop blur, so page text
          scrolled under the header read through the fade and the pills. The ground is solid instead, in the fade's own colour, easing
          to clear over its last 8 pt. Its height is fixed, 2 pt short of where pages start (Page: the inset + 56), so pills grown by a
          larger text size never let it cover a page's first line. */}
      <View pointerEvents="none" style={[s.ground, { height: insets.top + 54 }]}>
        <View style={{ flex: 1, backgroundColor: color.roomDeep }} />
        <LinearGradient colors={[color.roomDeep, `${color.roomDeep}00`]} style={{ height: 8 }} />
      </View>
      <View style={[s.row, { paddingTop: insets.top + 8 }]}>
        {showPills ? (
          <StreakPill streak={face} showDots={onPull} open={streakOpen} live={balanceKnown && tabVisible} onPress={() => setStreakOpen((open) => !open)} />
        ) : null}
        {showPills ? (
          <TicketsPill count={tickets} popToken={popToken} onPress={goRaffle} />
        ) : null}
        <View style={s.spacer} />
        <View style={s.right}>
          {usingMock ? (
            // Mock only: tapping the marker credits $10 of demo balance so paid paths can be exercised without a chain. What
            // the tap does is on the pill itself on Pull, where the bar has the room (#185: nobody should have to guess where
            // the money came from, or take it for real money). Off Pull the bar also carries the balance pill,
            // so the marker stays the short word there and the screen-reader label carries the rest.
            <Pressable onPress={() => { void devDeposit?.(10); }} accessibilityRole="button" accessibilityLabel="Demo data: add $10 of demo money. Not real money." style={s.demoPill}><Text style={s.demoText}>{onPull ? 'DEMO +$10' : 'DEMO'}</Text></Pressable>
          ) : null}
          <RoundButton glyph="⚙" label="Settings" onPress={onOpenSettings} />
          <RoundButton glyph="♪" label={muted ? 'Sound off' : 'Sound on'} onPress={toggleMuted} dim={muted} strike={muted} />
          {!onPull ? (
            <View style={s.balPill} accessible accessibilityLabel={balanceKnown ? balanceText(balanceUsd) : 'Balance loading'}>
              <Text style={s.balText}>{balanceKnown ? balanceText(balanceUsd) : PENDING_COUNT}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {showPills && streakOpen ? (
        <StreakSheet
          streak={face}
          page={page}
          onClose={() => setStreakOpen(false)}
          onPull={goPull}
          onRaffle={goRaffle}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  host: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 },
  hostOpen: { bottom: 0, zIndex: 9 },
  ground: { position: 'absolute', top: 0, left: 0, right: 0 },
  row: { paddingHorizontal: 18, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  spacer: { flexGrow: 1, flexShrink: 1, minWidth: 6 },
  right: { flexGrow: 0, flexShrink: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
  demoPill: { borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,176,63,0.6)', backgroundColor: 'rgba(255,176,63,0.14)', paddingVertical: 4, paddingHorizontal: 7 },
  demoText: { fontFamily: font.black, fontSize: 8.5, letterSpacing: 1, color: color.tickerAmber },
  round: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  roundGlyph: { fontSize: 14, color: color.text2, lineHeight: 18 },
  balPill: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  balText: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
});
