// Drop-down from the streak pill. Copy, tube and buttons are the header brief's table.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font } from '@/theme/fonts';
import { color } from '@/theme/tokens';
import type { PageIndex } from '@/state/session';
import { useEscapeToClose } from '@/ritual/useKeyboardBridge';
import { STREAK_RULES, streakCopy, streakPrimaryLabel, ticketHot, tubeSpots, type StreakFace } from './streakCopy';
import { TicketMark } from './TicketMark';

const enterEase = Easing.bezier(0.2, 0.9, 0.2, 1);
const ease = Easing.inOut(Easing.ease);

export function StreakSheet({ streak, page, onClose, onPull, onRaffle }: {
  streak: StreakFace;
  page: PageIndex;
  onClose: () => void;
  onPull: () => void;
  onRaffle: () => void;
}) {
  const reduced = useReducedMotion() === true;
  const insets = useSafeAreaInsets();
  const copy = streakCopy(streak);
  const y = useSharedValue(reduced ? 0 : -8);
  const opacity = useSharedValue(reduced ? 1 : 0);
  useEscapeToClose(true, onClose);
  useEffect(() => {
    if (reduced) return;
    y.set(withTiming(0, { duration: 300, easing: enterEase }));
    opacity.set(withTiming(1, { duration: 300, easing: enterEase }));
  }, [opacity, reduced, y]);
  const panelStyle = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));
  return (
    <View style={s.host} pointerEvents="box-none">
      <Pressable style={s.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <Animated.View style={[s.panel, { top: insets.top + 48 }, panelStyle]} accessibilityViewIsModal>
        <View style={s.pointer} />
        <LinearGradient colors={['#171E3A', '#12182D']} style={s.panelFill}>
        <View style={s.head}>
          <Text style={s.title}>{copy.title}</Text>
          <Text style={[s.aside, copy.asideGold && s.asideGold]}>{copy.aside}</Text>
        </View>
        <Tube streak={streak} reduced={reduced} />
        <Text style={s.status}>{copy.status}</Text>
        <Text style={s.rules}>{STREAK_RULES}</Text>
        <View style={s.buttons}>
          {copy.showPrimary ? (
            <Pressable accessibilityRole="button" accessibilityLabel={streakPrimaryLabel(page)} onPress={onPull} style={s.primaryWrap}>
              <LinearGradient colors={['#FFE066', '#FFD23F']} style={s.primary}>
                <Text style={s.primaryText}>{streakPrimaryLabel(page)}</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="See the raffle" onPress={onRaffle} style={s.secondary}>
            <Text style={s.secondaryText}>See the raffle</Text>
          </Pressable>
        </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

function Tube({ streak, reduced }: { streak: StreakFace; reduced: boolean }) {
  const hot = ticketHot(streak);
  return (
    <View style={s.tube}>
      <LinearGradient colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.08)']} style={StyleSheet.absoluteFill} />
      <View style={s.tubeHighlight} />
      <View style={s.tubeRow}>
        {tubeSpots(streak).map((kind, i) => <Spot key={i} kind={kind} index={i} reduced={reduced} />)}
        <View style={[s.ticket, hot ? s.ticketHot : s.ticketDim]} testID={hot ? 'streak-ticket-hot' : 'streak-ticket-dim'}>
          <TicketMark width={46} height={32} notch={8} notchColor="#12182D" perf={16} />
          <Text style={s.ticketText}>+2</Text>
        </View>
      </View>
    </View>
  );
}

function Spot({ kind, index, reduced }: { kind: 'filled' | 'today' | 'future'; index: number; reduced: boolean }) {
  const x = useSharedValue(kind === 'filled' && !reduced ? -30 : 0);
  const rot = useSharedValue(kind === 'filled' && !reduced ? -200 : 0);
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (kind === 'filled' && !reduced) {
      x.set(withDelay(index * 100, withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) })));
      rot.set(withDelay(index * 100, withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) })));
    }
    if (kind === 'today' && !reduced) {
      pulse.set(withRepeat(withSequence(
        withTiming(0.35, { duration: 700, easing: ease }),
        withTiming(1, { duration: 700, easing: ease }),
      ), -1));
    }
  }, [index, kind, pulse, reduced, rot, x]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.get(), transform: [{ translateX: x.get() }, { rotate: `${rot.get()}deg` }] }));
  return (
    <Animated.View testID={`streak-spot-${kind}`} style={[s.spot, kind === 'filled' ? s.spotFilled : kind === 'today' ? s.spotToday : s.spotFuture, style]}>
      {kind === 'filled' ? (
        <LinearGradient colors={['#FF9A5B', '#FF9A5B', '#F4F6FB', '#F4F6FB']} locations={[0, 0.5, 0.5, 1]} style={s.spotFill} />
      ) : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  host: { ...StyleSheet.absoluteFill, zIndex: 9 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,5,12,0.55)' },
  panel: {
    position: 'absolute', left: 14, right: 14, zIndex: 10, borderRadius: 18,
    backgroundColor: '#12182D', borderWidth: 1, borderColor: 'rgba(255,138,91,0.5)',
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 50, shadowOffset: { width: 0, height: 20 },
  },
  panelFill: { borderRadius: 17, padding: 14, gap: 12, overflow: 'hidden' },
  pointer: { position: 'absolute', top: -6, left: 30, width: 12, height: 12, backgroundColor: '#171E3A', transform: [{ rotate: '45deg' }], borderTopWidth: 1, borderLeftWidth: 1, borderColor: 'rgba(255,138,91,0.5)' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontFamily: font.black, fontSize: 15, color: color.text },
  aside: { fontFamily: font.extrabold, fontSize: 11, color: color.text2 },
  asideGold: { color: color.yellow },
  tube: { height: 60, borderRadius: 30, borderWidth: 2, borderColor: color.goldTrim, overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 10 },
  tubeHighlight: { position: 'absolute', top: 4, left: 24, right: 24, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
  tubeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spot: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  spotFilled: { borderColor: '#FF9A5B', shadowColor: '#FF6B5B', shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  spotToday: { borderStyle: 'dashed', borderColor: '#FFD23F' },
  spotFuture: { borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)' },
  spotFill: { width: 34, height: 34, borderRadius: 17 },
  ticket: { width: 46, height: 32, alignItems: 'center', justifyContent: 'center' },
  ticketDim: { opacity: 0.45 },
  ticketHot: { opacity: 1, shadowColor: '#FFD23F', shadowOpacity: 0.8, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  ticketText: { position: 'absolute', fontFamily: font.black, fontSize: 12, color: color.inkOnYellow },
  status: { fontFamily: font.bold, fontSize: 12.5, color: '#C9D3EE', textAlign: 'center' },
  rules: { fontFamily: font.semibold, fontSize: 11, color: color.text3, lineHeight: 15 },
  buttons: { gap: 8 },
  primaryWrap: { borderRadius: 14 },
  primary: { borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  primaryText: { fontFamily: font.extrabold, fontSize: 14, color: color.inkOnYellow },
  secondary: { borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  secondaryText: { fontFamily: font.extrabold, fontSize: 14, color: '#C9D3EE' },
});
