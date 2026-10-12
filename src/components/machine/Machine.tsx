// The gachapon machine (design/README.md "Pull (home)" + v4 markup, 310 wide): marquee with chasing
// lights and a static ticker, red collar, capsule globe with the tier/arm LED ring, control panel
// (PULLS counter, crank, ×1/×5/×10, arm lamp) and the tray. F2.2 = idle machine; the
// drop/scratch/reveal phases arrive with F2.4–F2.6.
import React, { useEffect, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useTabVisible } from '@/web/phoneWeb';
import { CapsuleGlobe, useGlobe } from './CapsuleGlobe';
import { RollDome, RollTray } from './PullRoll';
import { TrayPlate } from './TrayPlate';
import { Crank, type CrankHandle } from './Crank';
import { canCrank, crankAffordable } from '@/ritual/canCrank';
import { EmberStream } from '@/components/reveal/effects';
import type { BurnStep, Phase } from '@/ritual/reducer';
import { BrandLockup } from '@/brand/Wordmark';
import { color, radius } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { pullCostUsd, pullsAvailable } from '@/api/contract';
import { dollars, PENDING_COUNT } from '@/format';
import { crankSfx, playSfx } from '@/audio/sfx';

export type Multi = 1 | 5 | 10;
const RED = ['#F2565C', '#D9333B', '#A81F29'] as const;
const RED_STOPS = [0, 0.55, 1] as const;
const W = 310;
const EMBER_TO = { x: W / 2, y: 131 }; // where a burn's embers stream in: the dome's centre
/** The machine's width: the Pull page sizes its reveal stage to it. */
export const MACHINE_W = W;
/** The ticker's, the out-of-pulls line's and the PULLS counter's face. Android has no Menlo (it fell back to the default sans):
 *  it takes `font.mono`. iOS and the web keep Menlo as before; `font.mono` is Menlo on iOS but `monospace` on the web. */
const READOUT_FONT = Platform.OS === 'android' ? font.mono : 'Menlo';

function ChaseLight({ i, on }: { i: number; on: boolean }) {
  const op = useSharedValue(0.2);
  useEffect(() => {
    // Opacity only. Animating shadowOpacity with it was twelve box-shadows, repainted for the whole session,
    // including while this page sat offscreen in the pager.
    if (!on) { cancelAnimation(op); op.set(0.55); return; }
    op.set(withDelay(i * 110, withRepeat(withSequence(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) }), withTiming(0.2, { duration: 650, easing: Easing.inOut(Easing.ease) })), -1)));
    return () => cancelAnimation(op);
  }, [i, on, op]);
  const st = useAnimatedStyle(() => ({ opacity: op.get() }));
  return <Animated.View style={[s.light, st]} />;
}

/** One still line under the tagline (#340). The odds sleeve stays closed, so this is not a control unless something opens it. */
function Ticker({ text, onPress }: { text: string; onPress?: () => void }) {
  const line = <Text numberOfLines={1} ellipsizeMode="tail" style={s.tickerText}>{text}</Text>;
  if (!onPress) return <View style={s.ticker}>{line}</View>;
  return (
    <Pressable onPress={onPress} style={s.ticker} accessibilityRole="button" accessibilityLabel="View odds">
      {line}
    </Pressable>
  );
}

export type MachineProps = {
  /** The crank's handle, for the keyboard's turn (W1.2). */
  crankRef?: React.Ref<CrankHandle>;
  balanceUsd: number;
  /** False while the session has not applied `/balance` yet. Omitted means the caller already knows the figure (tests). */
  balanceKnown?: boolean;
  freePulls: number;
  multi: Multi;
  onMulti: (m: Multi) => void;
  targeted: boolean;
  tickerText: string;
  /** Opens the odds sleeve. Omitted while that sleeve is hidden (#332): the marquee is not a button. */
  onTicker?: () => void;
  onDeposit: () => void;
  onRelease: (multi: Multi) => void;
  onCrankStart?: () => void;
  onCrankAbandon?: () => void;
  onCrankActive?: (active: boolean) => void;
  /** Ritual phase: the crank only turns in idle/preparing/armed/coined; the machine dims behind a capsule or card. */
  phase?: Phase;
  /** The burn hand-off's step (F4.2): embers stream into the dome, then it flashes mint and the capsules jump. */
  burnStep?: BurnStep;
  /** Globe capsule colours (a targeted pull narrows them to the album's colour). */
  capsuleColors?: string[];
  capsuleCount?: number;
  /** Something sits on top of the machine (the album-complete takeover): the crank and shake-to-pull rest. They also rest
   *  while the machine is off screen (`active` false), so a shake on another page never pulls. */
  locked?: boolean;
  /** Physics only runs while the machine is on screen. */
  active?: boolean;
  /** Every album is sold out: the next-restock label. The dome says so and the crank rests (F2.10). */
  restocking?: string | null;
  /** Tray reels locked so far (0–3, left to right) while the pull is rolling or stopping. */
  reelStop?: number;
  /** Dome orbit rings: `rolling` and `stopping`. Tray reels mount in the mouth for the same wait (#358). */
  showRoll?: boolean;
  /** The stop flash on the orbit rings. */
  rollFlash?: boolean;
  /** How long that flash runs. Defaults to the ×5/×10 fade; ×1 passes the short one. */
  rollFlashMs?: number;
  /** Keep waiting / Notify me, only while the wait is still `rolling` and has run long. */
  rollActions?: boolean;
  onRollKeep?: () => void;
  onRollNotify?: () => void;
  /** "Browse my binder" from the restocking dome. */
  onBrowse?: () => void;
};

/** Free pulls count toward an untargeted pull; a targeted pull is always paid. */
export function canAfford(multi: Multi, targeted: boolean, balanceUsd: number, freePulls: number) {
  return balanceUsd >= pullCostUsd(multi, targeted, freePulls);
}

export function Machine({ crankRef, ...p }: MachineProps) { // the ref apart from the rest: the compiler's lint reads every `p.x` as a ref read otherwise
  const globe = useGlobe();
  const travel = useSharedValue(0);
  const flash = useSharedValue(0);
  const phase = p.phase ?? 'idle';
  const canPull = (m: Multi) => canAfford(m, p.targeted, p.balanceUsd, p.freePulls);
  const crankable = phase === 'idle' || phase === 'preparing' || phase === 'armed' || phase === 'coined';
  // Prepare has already reserved this turn's free pulls. The counter drops then; the crank stays through the turn.
  const affordable = crankAffordable(phase, canPull(p.multi));
  // Nothing in stock: depositing would not help, so the restocking dome wins over out-of-pulls and the crank rests.
  const restocking = p.restocking != null && phase === 'idle';
  const armed = (!restocking && affordable && crankable) || phase === 'coined';
  // A balance still loading is 0 in state. That must not paint OUT OF PULLS or a "0" on the counter.
  const balanceKnown = p.balanceKnown !== false;
  const tabVisible = useTabVisible();
  // The hydration frost is one `filter: blur` over this tree. A transform written under it (these lights, the globe)
  // invalidates that whole bitmap every frame, and the CSS then flattens the transform anyway. Hold still until the
  // balance is on screen. A backgrounded tab stops too.
  const motionOn = (p.active ?? true) && tabVisible && (Platform.OS !== 'web' || balanceKnown);
  const noBal = balanceKnown && !restocking && !canPull(p.multi) && phase === 'idle';
  const outTitle = p.targeted ? `NOT ENOUGH FOR ${dollars(pullCostUsd(p.multi, true, 0))}` : p.freePulls > 0 ? `NOT ENOUGH FOR ×${p.multi}` : 'OUT OF PULLS';
  const outSub = p.targeted
    ? (p.freePulls > 0 ? 'Free pulls work on $1 pulls' : 'No fees, no minimum')
    : p.freePulls > 0 ? `${p.freePulls} free pull${p.freePulls === 1 ? '' : 's'} left — switch to ×1` : 'No fees, no minimum';
  const dim = phase === 'capsule' || phase === 'card' || phase === 'spread' || phase === 'sealed' ? 0.3 : phase === 'batchcaps' ? 0.6 : 1;
  const lamp = armed ? color.mint : '#39405C';
  const led = armed ? 'rgba(143,227,197,0.55)' : 'rgba(255,255,255,0.25)';
  // Dial and, while chasing, the tray plate share this count. A chase is $1.50 and ignores free pulls.
  const pulls = pullsAvailable(p.balanceUsd, p.freePulls, p.targeted);
  const pullsShown = balanceKnown ? pulls : PENDING_COUNT;

  const domeGlow = useAnimatedStyle(() => ({
    shadowRadius: 22 + travel.get() * 40 + flash.get() * 48,
    shadowOpacity: Math.max(armed ? 0.25 + travel.get() * 0.55 : 0, flash.get()),
  }));
  // The burn hand-off on the machine (F4.2): embers arriving jostle the capsules; then the dome flashes and they jump.
  useEffect(() => {
    if (p.burnStep === 'stream') { const t = setTimeout(() => globe.kick.set(1.4), 600); return () => clearTimeout(t); }
    if (p.burnStep === 'flash') { flash.set(withSequence(withTiming(1, { duration: 300 }), withTiming(0, { duration: 400 }))); globe.kick.set(3); }
    return undefined;
  }, [p.burnStep, flash, globe.kick]);
  // Dome churn: the balls tumble only while the server is still out. Stopping clears this immediately.
  useEffect(() => {
    if (phase !== 'rolling') return;
    const kick = globe.kick;
    const id = setInterval(() => kick.set(2.4), 140);
    return () => clearInterval(id);
  }, [phase, globe.kick]);

  const multis = useMemo(() => ([1, 5, 10] as Multi[]).map((n) => ({ n, on: p.multi === n, off: balanceKnown && !canPull(n) })), [p.multi, p.balanceUsd, p.freePulls, p.targeted, balanceKnown]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[s.wrap, { opacity: dim }]}>
      {/* top cap + side pillars */}
      <LinearGradient colors={['#B8242E', '#8E1A22']} style={s.topCap} />
      <View style={[s.pillar, { left: 8, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }]}><LinearGradient colors={RED} locations={RED_STOPS} style={StyleSheet.absoluteFill} /><View style={[s.slit, { left: 8 }]} /></View>
      <View style={[s.pillar, { right: 8, borderTopRightRadius: 8, borderBottomRightRadius: 8 }]}><LinearGradient colors={RED} locations={RED_STOPS} style={StyleSheet.absoluteFill} /><View style={[s.slit, { right: 8 }]} /></View>

      {/* marquee */}
      <View style={s.marquee}>
        <LinearGradient colors={RED} locations={RED_STOPS} style={[StyleSheet.absoluteFill, { borderRadius: 16 }]} />
        <View style={s.screen}>
          <View style={s.lights}>{Array.from({ length: 12 }, (_, i) => <ChaseLight key={i} i={i} on={motionOn} />)}</View>
          <BrandLockup variant="lockup" size={17} mark={22} />
          <Text style={s.tagline}>— GOOD THINGS AWAIT —</Text>
        </View>
        <Ticker text={p.tickerText} onPress={p.onTicker} />
      </View>

      {/* globe */}
      <View style={s.globe}>
        <LinearGradient colors={['#A81F29', '#D9333B']} style={s.collar} />
        <LinearGradient colors={['#F2565C', '#A81F29']} style={s.shell} />
        <Animated.View style={[s.dome, { borderColor: led, shadowColor: armed ? color.mint : led }, domeGlow]}>
          <LinearGradient colors={['#1B2033', '#0C0F1C']} style={StyleSheet.absoluteFill} />
          <View style={s.domeTint} />
          <View style={[StyleSheet.absoluteFill, (noBal || restocking) && { opacity: 0.35 }]}>
            <CapsuleGlobe globe={globe} idle={!noBal && !restocking} active={motionOn} colors={p.capsuleColors} count={p.capsuleCount} />
          </View>
          {restocking ? (
            <View style={s.outOfPulls}>
              <Text style={s.outText}>RESTOCKING</Text>
              <Pressable onPress={p.onBrowse} style={({ pressed }) => [s.depositBtn, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button">
                <Text style={s.depositText}>Browse my binder</Text>
              </Pressable>
              <Text style={[s.outSub, s.outSubWide]}>{`Next restock ${p.restocking}. Your binder and balance are untouched.`}</Text>
            </View>
          ) : noBal ? (
            <View style={s.outOfPulls}>
              <Text style={s.outText}>{outTitle}</Text>
              <Pressable onPress={p.onDeposit} style={({ pressed }) => [s.depositBtn, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button">
                <Text style={s.depositText}>{p.targeted ? 'Deposit USDC · $1.50 a pull' : 'Deposit USDC · $1 a pull'}</Text>
              </Pressable>
              <Text style={s.outSub}>{outSub}</Text>
            </View>
          ) : null}
          {p.showRoll ? <RollDome flash={!!p.rollFlash} flashMs={p.rollFlashMs} actions={!!p.rollActions} onKeep={p.onRollKeep} onNotify={p.onRollNotify} /> : null}
          <View style={s.glassA} pointerEvents="none" />
          <View style={s.glassB} pointerEvents="none" />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']} style={s.domeShade} pointerEvents="none" />
        </Animated.View>
        {p.burnStep === 'stream' || p.burnStep === 'flash' ? <EmberStream to={EMBER_TO} height={262} /> : null}
      </View>

      {/* control panel */}
      <View style={s.panel}>
        <LinearGradient colors={RED} locations={RED_STOPS} style={[StyleSheet.absoluteFill, { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }]} />
        <View style={[s.vents, { left: 12 }]}>{[0, 1, 2].map((i) => <View key={i} style={s.vent} />)}</View>
        <View style={[s.vents, { right: 12 }]}>{[0, 1, 2].map((i) => <View key={i} style={s.vent} />)}</View>
        <View style={[s.sideLamp, { left: 11 }]} />
        <View style={[s.sideLamp, { right: 11 }]} />
        <View style={s.inset}>
          <LinearGradient colors={['#2C3148', '#171B2B']} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
          <Text style={s.marker}>▼</Text>
          <View style={s.counter} accessible accessibilityLabel={balanceKnown ? `${pulls} pulls` : 'Pulls loading'}>
            <Text style={s.counterNum} testID="pulls-count">{pullsShown}</Text>
            <Text style={s.counterLabel}>PULLS</Text>
          </View>
          <View style={s.multis}>
            {multis.map((m) => (
              <Pressable key={m.n} disabled={(m.off && !m.on) || phase !== 'idle'} onPress={() => p.onMulti(m.n)} style={[s.multiBtn, m.on && s.multiOn, m.off && !m.on && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel={`Pull ×${m.n}`}>
                <Text style={[s.multiText, m.on && { color: color.inkOnYellow }]}>×{m.n}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[s.armLamp, { backgroundColor: lamp, shadowColor: lamp, shadowOpacity: armed ? 0.9 : 0, shadowRadius: 7 }]} />
          <View style={s.crankWrap}>
            <Crank
              ref={crankRef}
              // The session gates are canCrank's, shared with the keyboard (W1.2); staying live through a turn is the hand's own rule.
              enabled={crankable && canCrank({ phase, affordable, restocking, takeover: !!p.locked, active: p.active ?? true })}
              multi={p.multi}
              armed={armed}
              travel={travel}
              onTick={(t) => { globe.kick.set(0.5 + t * 1.6); playSfx(crankSfx(t)); }}
              onRelease={() => { playSfx('pop'); globe.kick.set(3); p.onRelease(p.multi); }}
              onActive={p.onCrankActive}
              onStart={p.onCrankStart}
              onAbandon={p.onCrankAbandon}
            />
          </View>
        </View>
      </View>

      {/* tray */}
      <View style={s.tray}>
        <LinearGradient colors={RED} locations={RED_STOPS} style={[StyleSheet.absoluteFill, { borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }]} />
        <LinearGradient colors={['#E9464B', '#8E1A22']} style={s.trayInset} />
        <View style={s.mouth}>{(phase === 'rolling' || phase === 'stopping') ? <RollTray reelStop={p.reelStop ?? 0} /> : null}</View>
        <View style={[s.trayVents, { left: 14 }]}><View style={s.trayVent} /><View style={s.trayVent} /></View>
        <View style={[s.dotGrid, { right: 14 }]}>{Array.from({ length: 8 }, (_, i) => <View key={i} style={s.gridDot} />)}</View>
        <TrayPlate phase={phase} balanceUsd={p.balanceUsd} freePulls={p.freePulls} balanceKnown={balanceKnown} targeted={p.targeted} onTopUp={p.onDeposit} />
        <View style={[s.foot, { left: 10 }]}>{[0, 1, 2].map((i) => <View key={i} style={s.footLight} />)}</View>
        <View style={[s.foot, { right: 10 }]}>{[0, 1, 2].map((i) => <View key={i} style={s.footLight} />)}</View>
      </View>
    </View>
  );
}

const shell = { borderWidth: 2, borderColor: 'rgba(255,255,255,0.14)', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } } as const;

const s = StyleSheet.create({
  wrap: { width: W, alignSelf: 'center' },
  topCap: { position: 'absolute', left: (W - 120) / 2, top: 0, width: 120, height: 14, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderWidth: 2, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.12)' },
  pillar: { position: 'absolute', top: 22, width: 22, height: 60, borderRadius: 4, overflow: 'hidden', zIndex: 2 },
  slit: { position: 'absolute', top: 12, width: 5, height: 34, borderRadius: 3, backgroundColor: color.neonCyan, shadowColor: color.neonCyan, shadowOpacity: 1, shadowRadius: 10 },
  marquee: { marginTop: 12, marginHorizontal: 30, height: 92, borderRadius: 16, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, ...shell, overflow: 'visible' },
  screen: { position: 'absolute', left: 9, right: 9, top: 8, height: 54, borderRadius: 10, backgroundColor: '#0C0F1C', borderWidth: 2, borderColor: '#23283C', alignItems: 'center', justifyContent: 'center' },
  lights: { position: 'absolute', top: 4, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  light: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.yellow },
  tagline: { fontFamily: font.extrabold, fontSize: 8, letterSpacing: 2, color: color.text2, marginTop: 1 },
  ticker: { position: 'absolute', left: 9, right: 9, bottom: 5, height: 16, overflow: 'hidden', backgroundColor: '#05070F', borderRadius: 4 },
  tickerText: { fontFamily: READOUT_FONT, fontWeight: '700', fontSize: 9.5, lineHeight: 16, color: color.tickerAmber, textShadowColor: 'rgba(255,176,63,0.8)', textShadowRadius: 8 },
  globe: { width: W, height: 262, marginTop: -10 },
  collar: { position: 'absolute', left: (W - 230) / 2, top: 0, width: 230, height: 30, borderBottomLeftRadius: 115, borderBottomRightRadius: 115, zIndex: 1 },
  shell: { position: 'absolute', left: 0, right: 0, top: 0, bottom: -4, borderTopLeftRadius: 155, borderTopRightRadius: 155, borderBottomLeftRadius: 120, borderBottomRightRadius: 120, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  dome: { position: 'absolute', left: 9, right: 9, top: 10, bottom: 4, borderTopLeftRadius: 150, borderTopRightRadius: 150, borderBottomLeftRadius: 112, borderBottomRightRadius: 112, borderWidth: 3, overflow: 'hidden', shadowOffset: { width: 0, height: 0 } },
  domeTint: { position: 'absolute', inset: 0, backgroundColor: 'rgba(140,160,255,0.06)' },
  glassA: { position: 'absolute', left: 14, top: -10, width: 110, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.12)', transform: [{ rotate: '-24deg' }] },
  glassB: { position: 'absolute', right: 30, top: 22, width: 26, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.08)', transform: [{ rotate: '18deg' }] },
  domeShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 40 },
  outOfPulls: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 9, zIndex: 2 },
  outText: { fontFamily: READOUT_FONT, fontWeight: '700', fontSize: 11, letterSpacing: 2.5, color: color.tickerAmber, textShadowColor: 'rgba(255,176,63,0.9)', textShadowRadius: 10 },
  depositBtn: { borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 18, backgroundColor: color.mint, shadowColor: color.mint, shadowOpacity: 0.5, shadowRadius: 24, borderBottomWidth: 3, borderBottomColor: color.mintShadow },
  depositText: { fontFamily: font.extrabold, fontSize: 14, color: color.inkOnMint },
  outSubWide: { textAlign: 'center', paddingHorizontal: 28, lineHeight: 15 },
  outSub: { fontFamily: font.semibold, fontSize: 10.5, color: color.text2 },
  // The price line used to sit under the crank. The inset now ends just below the socket (#340).
  panel: { width: W, height: 126, marginTop: -4 },
  vents: { position: 'absolute', top: 26, width: 16, gap: 5 },
  vent: { height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.6)' },
  sideLamp: { position: 'absolute', top: 66, width: 18, height: 5, borderRadius: 3, backgroundColor: color.neonCyan, shadowColor: color.neonCyan, shadowOpacity: 1, shadowRadius: 10 },
  inset: { position: 'absolute', left: 36, right: 36, top: 8, height: 110, borderRadius: 14, borderWidth: 2, borderColor: color.room },
  marker: { position: 'absolute', left: 0, right: 0, top: -1, textAlign: 'center', fontSize: 9, color: color.yellow, lineHeight: 10 },
  counter: { position: 'absolute', left: 8, top: 14, width: 50, height: 56, borderRadius: 8, backgroundColor: '#05070F', borderWidth: 2, borderColor: color.goldTrim, alignItems: 'center', justifyContent: 'center' },
  counterNum: { fontFamily: READOUT_FONT, fontWeight: '900', fontSize: 20, color: color.neonCyan, textShadowColor: 'rgba(91,224,255,0.9)', textShadowRadius: 10, lineHeight: 22 },
  counterLabel: { fontFamily: font.extrabold, fontSize: 7.5, letterSpacing: 1, color: color.neonCyan, opacity: 0.85, marginTop: 3 },
  multis: { position: 'absolute', right: 8, top: 14, width: 50, height: 56, justifyContent: 'space-between' },
  multiBtn: { height: 16, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  multiOn: { backgroundColor: color.yellow, shadowColor: color.yellow, shadowOpacity: 0.6, shadowRadius: 12 },
  multiText: { fontFamily: font.black, fontSize: 11, color: color.marqueeInk, lineHeight: 14 },
  armLamp: { position: 'absolute', left: 26, top: 84, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  crankWrap: { position: 'absolute', left: '50%', top: 14, marginLeft: -44 },
  tray: { width: W, height: 132, marginTop: -2 },
  trayInset: { position: 'absolute', left: (W - 186) / 2, top: 6, width: 186, height: 74, borderRadius: 14 },
  mouth: { position: 'absolute', left: (W - 160) / 2, top: 16, width: 160, height: 54, borderRadius: 10, backgroundColor: '#05070F', borderWidth: 2, borderColor: '#23283C', overflow: 'hidden' },
  trayVents: { position: 'absolute', top: 58, flexDirection: 'row', gap: 4 },
  trayVent: { width: 4, height: 22, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.6)' },
  dotGrid: { position: 'absolute', top: 60, width: 28, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  gridDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.65)' },
  foot: { position: 'absolute', bottom: 14, width: 12, height: 36, borderRadius: 4, backgroundColor: color.room, justifyContent: 'space-around', paddingVertical: 3 },
  footLight: { height: 5, marginHorizontal: 2, borderRadius: 2, backgroundColor: color.yellow, shadowColor: color.yellow, shadowOpacity: 1, shadowRadius: 6 },
});
