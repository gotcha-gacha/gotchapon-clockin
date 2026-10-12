// Album-complete takeover (F3.5, #392). Stage 1 keeps the COMPLETE stamp on the card that filled
// the album. Claim credits a free Jupiter Degen pack pull at once. The hero is the closed pack.
// There is no in-app rip, and no save-for-later.
import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppFrame } from '@/state/appFrame';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { Album, ApiErrorCode, CardRef, CompletionGift } from '@/api/contract';
import { errorCopy, toApiError } from '@/api/errors';
import { ClosedPack } from '@/components/albums/PartnerPackArt';
import { Confetti } from '@/components/reveal/Confetti';
import { Flash } from '@/components/reveal/effects';
import { playPattern } from '@/components/reveal/tiers';
import { PACK_COPY, safeJupiterOpenUrl } from '@/config/partnerPack';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { playSfx } from '@/audio/sfx';

const COVER_W = 168;
const COVER_H = 216;
const RAY_SIZE = 900;

/** A failed claim leaves the album unclaimed. The network copy says the pack is safe; anything else is a soft retry. */
const claimError = (code: ApiErrorCode) =>
  code === 'NETWORK'
    ? `${errorCopy.NETWORK.title} — your Degen pack pull is safe. Try again from this album.`
    : 'Your Degen pack is temporarily unavailable. Try again.';

type Stage = 'cover' | 'credited' | 'queued' | 'claimed';

/** Gold rays: nine full-width bars 20° apart make eighteen rays, turning once every 40 s behind everything. */
function Rays() {
  const { width, height } = useAppFrame();
  const spin = useSharedValue(0);
  useEffect(() => { spin.set(withRepeat(withTiming(360, { duration: 40_000, easing: Easing.linear }), -1)); }, [spin]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[s.rays, { left: width / 2 - RAY_SIZE / 2, top: height * 0.44 - RAY_SIZE / 2 }, st]}>
      {Array.from({ length: 9 }, (_, i) => <View key={i} style={[s.ray, { transform: [{ rotate: `${i * 20}deg` }] }]} />)}
    </Animated.View>
  );
}

function Rise({ delay, children }: { delay: number; children: React.ReactNode }) {
  const t = useSharedValue(0);
  useEffect(() => { t.set(withDelay(delay, withTiming(1, { duration: 500, easing: Easing.out(Easing.ease) }))); }, [t, delay]);
  const st = useAnimatedStyle(() => ({ opacity: t.get(), transform: [{ translateY: (1 - t.get()) * 48 }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

function CoverStage({ album, finisher, busy, error, onReveal }: { album: Album; finisher: CardRef | null; busy: boolean; error: string | null; onReveal: () => void }) {
  const slam = useSharedValue(0);
  const shake = useSharedValue(0);
  const flash = useSharedValue(0);
  const stamp = useSharedValue(0);
  useEffect(() => {
    slam.set(withTiming(1, { duration: 750, easing: Easing.bezier(0.2, 0.9, 0.3, 1.2) }));
    shake.set(withDelay(550, withTiming(1, { duration: 500 })));
    flash.set(withDelay(600, withSequence(withTiming(0.9, { duration: 1 }), withTiming(0, { duration: 900, easing: Easing.out(Easing.ease) }))));
    stamp.set(withDelay(1050, withTiming(1, { duration: 500, easing: Easing.bezier(0.2, 0.9, 0.3, 1.3) })));
    playPattern([40, 60, 40, 60, 200]);
    playSfx('shimmer');
    const heavy = setTimeout(() => { playPattern([80, 40, 160]); playSfx('heavy'); }, 650);
    return () => clearTimeout(heavy);
  }, [slam, shake, flash, stamp]);
  const group = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(shake.get(), [0, 0.2, 0.4, 0.6, 0.8, 1], [0, -8, 8, -5, 4, 0]) },
      { translateY: interpolate(shake.get(), [0, 0.2, 0.4, 0.6, 0.8, 1], [0, 4, -3, 2, -2, 0]) },
    ],
  }));
  const cover = useAnimatedStyle(() => ({
    opacity: interpolate(slam.get(), [0, 0.55, 1], [0, 1, 1]),
    transform: [
      { perspective: 900 },
      { rotateY: `${interpolate(slam.get(), [0, 0.55, 1], [-95, 0, 0])}deg` },
      { scale: interpolate(slam.get(), [0, 0.55, 0.7, 1], [1.15, 1.08, 0.97, 1]) },
    ],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: flash.get() }));
  const stampSt = useAnimatedStyle(() => ({
    opacity: interpolate(stamp.get(), [0, 0.6, 1], [0, 1, 1]),
    transform: [{ rotate: `${interpolate(stamp.get(), [0, 0.6, 1], [-18, -12, -12])}deg` }, { scale: interpolate(stamp.get(), [0, 0.6, 1], [2.6, 0.92, 1]) }],
  }));
  const uri = finisher ? (finisher.imgLarge || finisher.imgSmall) : album.coverUrl;
  const heroLabel = finisher ? finisher.name : `${album.title} cover`;
  return (
    <View style={s.stage}>
      <Animated.View style={[s.coverGroup, group]}>
        <Animated.View pointerEvents="none" style={[s.flash, glow]} />
        <Animated.View style={[s.cover, cover]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={heroLabel} />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']} locations={[0.4, 1]} style={StyleSheet.absoluteFill} />
          <Text style={s.coverTitle} numberOfLines={1}>{finisher ? finisher.name : album.title}</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[s.stampWrap, stampSt]}><Text style={s.stamp}>COMPLETE</Text></Animated.View>
      </Animated.View>
      <Rise delay={1400}><Text style={s.title}>{`${album.title} · ${album.size}/${album.size}`}</Text></Rise>
      <Rise delay={1500}><Text style={s.body}>{PACK_COPY.completeBody}</Text></Rise>
      <Rise delay={1650}>
        <Pressable onPress={onReveal} disabled={busy} accessibilityRole="button" accessibilityLabel={PACK_COPY.claim} accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [s.cta, pressed && s.pressed, busy && s.busy]}>
          <Text style={s.ctaText}>{busy ? PACK_COPY.claiming : PACK_COPY.claim}</Text>
        </Pressable>
        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      </Rise>
    </View>
  );
}

function CreditedStage({ openUrl, onDone }: { openUrl: string; onDone: () => void }) {
  const { width } = useAppFrame();
  const slide = useSharedValue(0);
  useEffect(() => {
    slide.set(withTiming(1, { duration: 700, easing: Easing.bezier(0.2, 0.9, 0.3, 1) }));
    playPattern([60, 80, 200]);
    playSfx('chord');
  }, [slide]);
  const pack = useAnimatedStyle(() => ({
    opacity: interpolate(slide.get(), [0, 0.6, 1], [0, 1, 1]),
    transform: [
      { translateY: interpolate(slide.get(), [0, 0.6, 1], [80, -10, 0]) },
      { scale: interpolate(slide.get(), [0, 0.6, 1], [0.86, 1.03, 1]) },
    ],
  }));
  return (
    <View style={s.stage}>
      <Animated.View style={pack}><ClosedPack /></Animated.View>
      <Text style={s.title}>{PACK_COPY.creditedTitle}</Text>
      <Text style={s.body}>{PACK_COPY.creditedBody}</Text>
      <Pressable onPress={() => { Linking.openURL(safeJupiterOpenUrl(openUrl)).catch(() => {}); }} accessibilityRole="button" accessibilityLabel={PACK_COPY.open} style={({ pressed }) => [s.cta, pressed && s.pressed]}><Text style={s.ctaText}>{PACK_COPY.open}</Text></Pressable>
      <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel={PACK_COPY.done} style={({ pressed }) => [s.done, pressed && s.pressed]}><Text style={s.doneText}>{PACK_COPY.done}</Text></Pressable>
      <Confetti trigger={1} width={width} />
      <Flash trigger={1} />
    </View>
  );
}

export type AlbumCompleteTakeoverProps = {
  /** The album that just reached 25/25; null keeps the takeover closed. */
  album: Album | null;
  /** The card that filled the album. Absent on a binder reopen that did not see the pull. */
  finisher?: CardRef | null;
  /** Claim the Jupiter gift (POST /completion-claims). Null when it was already claimed. */
  onClaim: () => Promise<CompletionGift | null>;
  onDone: () => void;
};

export function AlbumCompleteTakeover({ album, finisher = null, onClaim, onDone }: AlbumCompleteTakeoverProps) {
  const [stage, setStage] = useState<Stage>('cover');
  const [openUrl, setOpenUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  if (!album) return null;
  const reveal = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const gift = await onClaim();
      if (gift?.status === 'confirmed') { setOpenUrl(safeJupiterOpenUrl(gift.openUrl)); setStage('credited'); }
      else setStage('claimed');
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'RESTOCKING') setStage('queued');
      else if (err.hint === 'already-claimed') setStage('claimed');
      else setError(claimError(err.code));
    }
    inFlight.current = false;
    setBusy(false);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!inFlight.current) onDone(); }} testID="album-complete">
      <View style={s.backdrop}>
        <Rays />
        {stage === 'cover' ? <CoverStage album={album} finisher={finisher} busy={busy} error={error} onReveal={() => { void reveal(); }} /> : null}
        {stage === 'credited' ? <CreditedStage openUrl={openUrl} onDone={onDone} /> : null}
        {stage === 'queued' || stage === 'claimed' ? (
          <View style={s.stage}>
            <Text style={s.title}>{`${album.title} · ${album.size}/${album.size}`}</Text>
            <Text style={s.body}>{stage === 'queued' ? PACK_COPY.queued : PACK_COPY.already}</Text>
            <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Done" style={({ pressed }) => [s.cta, pressed && s.pressed]}><Text style={s.ctaText}>Done</Text></Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,12,0.86)', alignItems: 'center', justifyContent: 'center', padding: 24, overflow: 'hidden' },
  rays: { position: 'absolute', width: RAY_SIZE, height: RAY_SIZE },
  ray: { position: 'absolute', left: RAY_SIZE / 2 - 28, top: 0, width: 56, height: RAY_SIZE, backgroundColor: 'rgba(255,210,63,0.09)' },
  stage: { alignItems: 'center', width: '100%' },
  coverGroup: { width: COVER_W, height: COVER_H, alignItems: 'center', justifyContent: 'center' },
  flash: { position: 'absolute', left: -60, right: -60, top: -60, bottom: -60, borderRadius: 999, backgroundColor: '#FFF3C4' },
  cover: { width: COVER_W, height: COVER_H, borderRadius: 16, overflow: 'hidden', borderWidth: 4, borderColor: '#E9C46A', backgroundColor: '#211420', transformOrigin: 'left center' },
  coverTitle: { position: 'absolute', left: 10, right: 10, bottom: 14, fontFamily: font.black, fontSize: 14, color: '#FFFFFF', textAlign: 'center' },
  stampWrap: { position: 'absolute', alignSelf: 'center', borderWidth: 4, borderColor: color.yellow, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12, backgroundColor: 'rgba(20,14,0,0.5)', shadowColor: color.yellow, shadowOpacity: 0.6, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } },
  stamp: { fontFamily: font.black, fontSize: 17, letterSpacing: 2.5, color: color.yellow },
  title: { fontFamily: font.black, fontSize: 22, color: color.text, marginTop: 18, textAlign: 'center' },
  body: { fontFamily: font.semibold, fontSize: 13, color: color.text2, textAlign: 'center', lineHeight: 19, marginTop: 6, marginBottom: 10, maxWidth: 280, alignSelf: 'center' },
  cta: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 26, backgroundColor: color.yellow, alignItems: 'center', shadowColor: color.yellow, shadowOpacity: 0.45, shadowRadius: 17, shadowOffset: { width: 0, height: 0 }, borderBottomWidth: 4, borderBottomColor: color.yellowShadow },
  ctaText: { fontFamily: font.black, fontSize: 16, color: color.inkOnYellow },
  done: { marginTop: 10, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 26, alignItems: 'center' },
  doneText: { fontFamily: font.black, fontSize: 15, color: color.text2 },
  pressed: { transform: [{ scale: 0.96 }] },
  busy: { opacity: 0.6 },
  error: { fontFamily: font.semibold, fontSize: 12, color: color.text2, textAlign: 'center', marginTop: 10, maxWidth: 280 },
});
