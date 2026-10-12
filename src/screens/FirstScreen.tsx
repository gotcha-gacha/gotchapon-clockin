// The first screen (#211; `design/first_screen_motion_brief.md`, `design/README.md` "First screen (cold open)"). It replaces
// the sign-in wall: a motion hero with one gold call to action, and Privy behind a sheet that rises when you press it.
//
// The beat the brief calls "anticipation": pressing the CTA arms the machine for 780 ms — the G mark lifts and drops into a
// mouth that opens under it — and only then does the auth sheet arrive. The clock lives here, with the sound, so the hero
// component stays a drawing.
//
// Three lines of copy are not the pack's, and each is a recorded decision overruling it (CLAUDE.md source-of-truth order):
// no Pokémon mark in original chrome, so "one real trading card"; no shipping promise while shipping is coming soon (Ben,
// 17 Sept), and no custody claim until the stock is counted (Ben, 11 Oct; #57), so the sub line says only what you do; and no
// "18+", because there is no age gate (#116).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type PointerEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useAuth } from '@/auth/AuthProvider';
import { playSfx } from '@/audio/sfx';
import { playPattern } from '@/components/reveal/tiers';
import { AuthSheet } from '@/screens/firstScreen/AuthSheet';
import { ARM_MS, CAPSULE, HeroCapsule, RATTLE_MS } from '@/screens/firstScreen/HeroCapsule';
import { HeroSky } from '@/screens/firstScreen/HeroSky';
import { useFitScale } from '@/screens/firstScreen/useFitScale';
import { readSettings } from '@/state/settings';
import { PUBLIC_DOMAIN } from '@/brand/name';
import { LegalLink } from '@/legal/LegalLink';
import { SplashLockup } from '@/brand/Wordmark';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

/** How long the screen waits, untouched, before it nudges: the pack's six seconds. */
export const IDLE_MS = 6000;

/** Where the capsule falls to, and where its mouth sits, from the stage it is centred in — the canvas's `armDrop` and
 *  `mouthTop`, which derive both from the space left under the capsule. Clamped so a short window still reads as a drop and a
 *  tall one does not throw the capsule off the screen. */
/** A box on the glass: where the screen itself is, and how big, in whatever units the pointer arrives in. */
export type Box = { x: number; y: number; w: number; h: number };

/** Where a pointer sits inside that box, as −0.5…0.5 of each side.
 *
 *  **The box is the screen's, measured — never the window's.** `onPointerMove` only ever fires over the app, and on the
 *  desktop web the app is a CSS-scaled cabinet inside a much larger window: at 1440×900 the 390 pt screen is about 303 px of
 *  glass, so dividing by the window's width spanned ±0.105 where ±0.5 was meant and the hero leaned ±2.3 px instead of the
 *  brief's ±11 (±1.7 px on the laptop tier — invisible, and a phone has no hover, so the cabinet is the only place this can
 *  be seen at all; found in review). Pointer and measured box are in the same units whatever the scale, so nothing is undone
 *  here — the `useAppFrame` rule is about laying things out, which this is not. */
export function tiltIn(px: number, py: number, box: Box) {
  const clamp = (v: number) => Math.max(-0.5, Math.min(0.5, v));
  return { x: clamp((px - box.x) / box.w - 0.5), y: clamp((py - box.y) / box.h - 0.5) };
}

export function armGeometry(stageHeight: number) {
  const gap = Math.max(0, stageHeight - CAPSULE) / 2;
  return {
    drop: Math.round(Math.min(212, Math.max(40, gap - 30))),
    mouthTop: Math.round(Math.min(64, Math.max(-40, gap - 100))),
  };
}

export function FirstScreen() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [sheet, setSheet] = useState(false);
  const [arming, setArming] = useState(false);
  const [stageHeight, setStageHeight] = useState(0);
  // The pack's `splashIntensity: 'calm'` — fewer particles, time at 0.6× — "after the first session". This device has had one
  // once it has been through onboarding, which is already remembered on disk. Read once: it cannot change under this screen.
  const [calm] = useState(() => readSettings().onboarded);
  const [rattling, setRattling] = useState(false);
  const [nudge, setNudge] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rattleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    if (rattleTimer.current) clearTimeout(rattleTimer.current);
  }, []);

  const busy = auth.stage === 'busy';
  // Any road into the busy state opens the sheet, not only its own buttons: the two-step copy #6 specifies has to play where
  // the user is looking, and `signIn` is callable from outside this screen.
  const sheetOpen = sheet || busy;
  const { drop, mouthTop } = armGeometry(stageHeight);

  // Where the pointer is inside this screen, as −0.5…0.5 (`tiltIn`). The box is measured on every layout: `measureInWindow`
  // and the pointer both report glass pixels on the web and points on a phone, so the two always agree.
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const root = useRef<View>(null);
  const viewportRef = useRef<View>(null);
  const columnRef = useRef<View>(null);
  // Web only: when the brand, capsule and copy are taller than the dark panel, scale the column to it (#325).
  // scale 1 on a phone, and on a panel that already fits. The sky stays full-bleed behind the column.
  const fit = useFitScale(viewportRef, columnRef);
  const box = useRef<Box | null>(null);
  const measure = useCallback(() => {
    root.current?.measureInWindow((x, y, w, h) => { if (w > 0 && h > 0) box.current = { x, y, w, h }; });
  }, []);

  // Anything the hand does wakes the screen: the nudge goes, and the six seconds start again. **A ref, not a counter in
  // state**: a pointer move must not re-render. The tilt lives on shared values precisely to stay off the React path, and
  // bumping state on every move put it back — a drag across the hero re-rendered the screen, the capsule's flare `<Svg>` and
  // both skies 60–120 times a second (found in review). `setNudge` with the value it already has is a no-op in React.
  const lastTouch = useRef(0); // 0 until the effect below starts the clock: `Date.now()` in render is impure (compiler lint)
  const wake = useCallback(() => { lastTouch.current = Date.now(); setNudge((on) => (on ? false : on)); }, []);

  const onPointerMove = (e: PointerEvent) => {
    if (arming || sheetOpen || reduced) return;
    const b = box.current;
    if (!b) { measure(); return; } // the first move before a layout has landed: nothing to normalise against yet
    const { clientX, clientY } = e.nativeEvent;
    const t = tiltIn(clientX, clientY, b);
    tiltX.set(t.x);
    tiltY.set(t.y);
    wake();
  };
  const onPointerLeave = () => {
    tiltX.set(withTiming(0, { duration: 300 }));
    tiltY.set(withTiming(0, { duration: 300 }));
  };

  const tapCapsule = () => {
    if (arming || sheetOpen) return;
    playSfx('tick');
    playPattern([10, 30, 10, 30, 14]);
    setRattling(true);
    if (rattleTimer.current) clearTimeout(rattleTimer.current);
    rattleTimer.current = setTimeout(() => setRattling(false), RATTLE_MS + 50);
    wake();
  };

  const pull = () => {
    if (arming || sheetOpen) return;
    playSfx('click');
    playPattern([12, 40, 18]);
    setNudge(false);
    setArming(true);
    armTimer.current = setTimeout(() => {
      playSfx('pop'); // the capsule landing in the mouth; the sheet rises on the same beat
      setArming(false);
      setSheet(true);
    }, ARM_MS);
  };
  const openSheet = () => { if (arming) return; playSfx('click'); setSheet(true); };

  // The CTA's breath (`pbBreathe`): a glow behind the button rather than an animated shadow, which costs a layer per frame.
  const glow = useSharedValue(0);
  const nudgeGlow = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    glow.set(withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [reduced, glow]);
  // `pbNudge`, twice and then done: four half-cycles, after which the button goes back to breathing.
  useEffect(() => {
    if (!nudge || reduced) { nudgeGlow.set(0); return; }
    nudgeGlow.set(withRepeat(withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }), 4, true));
  }, [nudge, reduced, nudgeGlow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.35 + 0.4 * glow.get() + 0.25 * nudgeGlow.get() }));

  // The six seconds, owned by an effect so its cleanup is the only way it is ever cancelled. It re-arms against `lastTouch`
  // rather than restarting on a state change, which is what lets a pointer move wake the screen without a render: the timer
  // that was already running wakes, finds the deadline has moved, and sets the next one. (The first version hung off a
  // `wake()` that also cleared the nudge, so the re-render the nudge caused ran the effect again and took the nudge straight
  // back off — it fired and vanished in the same tick, which no test could see standing still.)
  useEffect(() => {
    if (sheetOpen || arming || reduced || nudge) return;
    if (!lastTouch.current) lastTouch.current = Date.now(); // the six seconds start when the screen does
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      const left = IDLE_MS - (Date.now() - lastTouch.current);
      // The deadline is re-read when the timer lands, not when it was set: a touch in between moved it, and then this only
      // arms again. The six seconds are exact either way — the wait is never split into an extra tick.
      t = setTimeout(() => { if (Date.now() - lastTouch.current >= IDLE_MS) setNudge(true); else arm(); }, Math.max(left, 0));
    };
    arm();
    return () => clearTimeout(t);
  }, [sheetOpen, arming, reduced, nudge]);

  const onStage = (e: LayoutChangeEvent) => setStageHeight(e.nativeEvent.layout.height);
  const tilt = { x: tiltX, y: tiltY };

  return (
    <View
      ref={root}
      style={[s.screen, Platform.OS === 'web' && s.clip, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 26 }]}
      testID="first-screen"
      onLayout={measure}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <HeroSky reduced={reduced} calm={calm} tilt={tilt} paused={sheetOpen} />
      <View ref={viewportRef} style={[s.viewport, Platform.OS === 'web' && s.clip]}>
        <View
          ref={columnRef}
          testID="first-screen-column"
          style={[s.column, fit.scale < 1 && { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', height: fit.content, transform: [{ scale: fit.scale }] }]}
        >
          <View style={s.brand}><SplashLockup /></View>
          <View style={s.stage} onLayout={onStage}>
            <Pressable onPress={tapCapsule} accessibilityRole="button" accessibilityLabel="Gotchapon mark" disabled={arming}>
              <HeroCapsule arming={arming} reduced={reduced} drop={drop} mouthTop={mouthTop} rattling={rattling} nudge={nudge} tilt={tilt} />
            </Pressable>
          </View>
          <View style={s.copy}>
            <Text style={s.headline}>$1. One real trading card.</Text>
            <Text style={s.sub}>Pull a capsule, fill your binder.</Text>
            <View style={s.ctaWrap}>
              <Animated.View style={[s.ctaGlow, glowStyle]} pointerEvents="none" />
              <Pressable onPress={pull} disabled={arming} accessibilityRole="button" style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}>
                <LinearGradient colors={['#FFE066', '#FFD23F']} style={StyleSheet.absoluteFill} />
                <Text style={s.ctaText}>{arming ? 'Loading a capsule…' : 'Pull your first card'}</Text>
              </Pressable>
            </View>
            <Pressable onPress={openSheet} accessibilityRole="button" hitSlop={8} style={s.secondary}>
              <Text style={s.secondaryText}>Already collecting? Sign in</Text>
            </Pressable>
            <Text style={s.legal}>{PUBLIC_DOMAIN} · <LegalLink doc="terms" style={s.legalLink} /> · <LegalLink doc="privacy" style={s.legalLink} /></Text>
          </View>
        </View>
      </View>
      {sheetOpen ? <AuthSheet onClose={() => setSheet(false)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, backgroundColor: '#05070F' },
  // The dark panel clips. The viewport is the box the column fits; on the web the column scales down when its
  // children are taller than that box (#325). The sky is a sibling of the viewport, so it is not part of the fit.
  clip: { overflow: 'hidden' },
  viewport: { flex: 1, minHeight: 0 },
  column: { flex: 1, minHeight: 0, transformOrigin: 'top center' },
  brand: { alignItems: 'center' },
  stage: { flex: 1, minHeight: CAPSULE, alignItems: 'center', justifyContent: 'center' },
  copy: { alignItems: 'center' },
  headline: { fontFamily: font.black, fontSize: 34, lineHeight: 35, letterSpacing: -0.8, color: color.text, textAlign: 'center' },
  sub: { fontFamily: font.semibold, fontSize: 14, lineHeight: 20, color: color.text2, textAlign: 'center', marginTop: 10, maxWidth: 300 },
  ctaWrap: { width: '100%', marginTop: 22 },
  ctaGlow: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 18, backgroundColor: color.yellow, shadowColor: color.yellow, shadowOpacity: 0.9, shadowRadius: 34, shadowOffset: { width: 0, height: 0 } },
  cta: { borderRadius: 18, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderBottomWidth: 3, borderBottomColor: color.yellowShadow },
  ctaPressed: { transform: [{ scale: 0.97 }] },
  ctaText: { fontFamily: font.black, fontSize: 17, color: color.inkOnYellow },
  secondary: { marginTop: 14 },
  secondaryText: { fontFamily: font.extrabold, fontSize: 13, color: color.text2 },
  legal: { marginTop: 12, fontFamily: font.semibold, fontSize: 10.5, color: color.text3 },
  legalLink: { color: color.text3, textDecorationLine: 'underline' },
});
