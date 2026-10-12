// The crank (design "Control panel" + v4 crankMove): angle accumulates from pointer-angle deltas
// ×0.8, backwards ×0.15, heavier at ×5/×10 (÷(1+(n−1)·0.12)); 8 ratchet ticks per revolution with a
// 12 ms haptic; released early → springs back over 320 ms ease-in quad; a full 360° fires onRelease
// exactly once — that is the charge point (F2.3 wires it to prepare → sign → commit).
// Shared values are read with .get() even inside worklets: the React Compiler turns a `.value`
// read in a render-defined closure into a memo dependency it evaluates during render, which
// Reanimated's strict mode flags ("Reading from `value` during component render").
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { primeMotion, watchShake } from '@/sensors/motion';
import Animated, { Easing, runOnJS, runOnUI, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { ProgressRing } from './ProgressRing';
import { useGestureScale } from '@/state/appFrame';
import { shakeSample, shakeTuning } from './shake';

const SOCKET = 88;
const KNOB = 64;
const FULL = Math.PI * 2;
const TICK = Math.PI / 4;

const tick = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
const thunk = () => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };

/** The angle of a touch around the socket's centre. `k` turns the glass pixels a web gesture reports into the app's points
 *  (useGestureScale; 1 on a phone): without it, inside a cabinet scaled to 0.446 a full circle of the pointer swept 99° of knob. */
export function touchAngle(x: number, y: number, k: number): number {
  'worklet';
  return Math.atan2(y * k - SOCKET / 2, x * k - SOCKET / 2);
}

/** How long the keyboard's turn takes (plan §7.17): a constant, never tied to the outcome. The prepare goes out at t = 0, so
 *  these 650 ms are latency the player does not wait for twice. */
export const AUTO_TURN_MS = 650;
const AUTO_STEP_MS = 16;

/** What the keyboard bridge may ask of the crank (W1.2, #124). */
export type CrankHandle = {
  /** One full turn without a hand: `onStart` now, then the knob is placed at elapsed / AUTO_TURN_MS of a turn every 16 ms
   *  (`turnTo`), through the same ticks-and-release tail a hand's turn ends in (`landed`), so there is one 360° release and one
   *  `done` latch. False, and nothing happens, when the crank is off, a hand is on it, or a turn of this kind is already running. */
  autoCrank: () => boolean;
};

export type CrankProps = {
  ref?: React.Ref<CrankHandle>;
  enabled: boolean;
  multi: 1 | 5 | 10;
  armed: boolean;
  /** 0..1 revolution progress, shared so the dome glow can follow the hand. */
  travel: SharedValue<number>;
  onTick?: (travel: number) => void;
  onRelease: () => void;
  /** Hand on / off the crank — the pager locks while it is on. */
  onActive?: (active: boolean) => void;
  /** Hand went on: the ritual prepares the pull now. */
  onStart?: () => void;
  /** Hand came off before 360°: the prepared pull is abandoned. */
  onAbandon?: () => void;
};

export function Crank({ ref, enabled, multi, armed, travel, onTick, onRelease, onActive, onStart, onAbandon }: CrankProps) {
  const angle = useSharedValue(0);
  const last = useSharedValue(0);
  const ticks = useSharedValue(0);
  const done = useSharedValue(false);
  /** The knob's angle belongs to a turn that has RELEASED (#161, PR #166's reviews). `done` is only the latch: several places
   *  reopen it (a new hand, the shake's idle reset, a new ritual), and reading "done is false" as "the knob is a real
   *  part-turn" let a latch reopened over a knob still at 360° release on the first movement. This flag is set at a release and
   *  cleared only when the knob is put back to zero, and every reopening goes through `reopen`, which zeroes a spent knob. */
  const spent = useSharedValue(false);
  const heavy = useSharedValue(1);
  useEffect(() => { heavy.set(1 / (1 + (multi - 1) * 0.12)); }, [multi, heavy]);

  const springBack = React.useMemo(() => () => {
    'worklet';
    angle.set(withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }));
    ticks.set(0);
  }, [angle, ticks]);
  /** The knob has just been put somewhere: ratchet ticks, and the release at 360°. The hand's deltas and the keyboard's turn
   *  both end here, so there is one release and one `done` latch. */
  const landed = () => {
    'worklet';
    const a = angle.get();
    const n = Math.floor(a / TICK);
    if (n > ticks.get()) {
      ticks.set(n);
      runOnJS(tick)();
      if (onTick) runOnJS(onTick)(a / FULL);
    }
    if (a >= FULL) {
      done.set(true);
      spent.set(true);
      runOnJS(thunk)();
      runOnJS(onRelease)();
      angle.set(withDelay(280, withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) })));
      ticks.set(0);
    }
  };
  /** Apply a rotation delta (radians of hand travel, already sign-corrected), geared down, more for ×5 / ×10. */
  const applyDelta = (d: number) => {
    'worklet';
    if (done.get()) return;
    angle.set(Math.max(0, angle.get() + d * 0.8 * heavy.get()));
    landed();
  };
  /** The keyboard's turn: the knob AT a fraction of a turn, not moved BY something. `begin` is its zero. Placed, not nudged,
   *  because a nudge inherits whatever the knob was doing: the last turn's 360° (held for 280 ms after a release that landed
   *  on an idle machine, so the next turn released on its first step, ~100 ms into its 650) and the gearing of a multi that
   *  can change under it (the knob stopped short and the release never came). Both found by PR #158's review.
   *  `begin` opens the latch AND zeroes the knob, as one act: the latch open over a knob still at the last turn's 360° is a
   *  release waiting for any delta at all, and the shake listener supplies one (a phone merely held reads 9.8 of the 10 it
   *  takes; the first `turnTo` is 16 ms away). I took the zeroing out once because no test of mine could tell it was there:
   *  the second review released a turn 8 ms in with one motion sample. A surviving mutant says the tests cannot see the
   *  line, never that the line does nothing.
   *  `turnTo` stops at `done` so a shake that finishes the turn first is the turn's one release, not the first of two. */
  const turnBegin = () => { 'worklet'; done.set(false); spent.set(false); ticks.set(0); angle.set(0); };
  /** Reopen the latch for a new turn: over a knob a release left behind, from zero; over a part-turn (a let-go springing back,
   *  a shake's progress), from where it is, as the design's crankDown carries it on. */
  const reopen = () => { 'worklet'; if (spent.get()) turnBegin(); else done.set(false); };
  /** The machine went off in the middle of the keyboard's turn. Queued on the UI thread like every placement, so it runs AFTER
   *  one already on its way: it springs the knob back from wherever that left it and closes the latch, so no late placement
   *  moves it again. Done on the JS side instead, a placement queued just before landed after the spring-back had begun and
   *  parked the knob at 0.985 of a turn with the latch open; the next motion sample released a pull (#163). */
  const turnCancel = () => {
    'worklet';
    done.set(true);
    ticks.set(0);
    angle.set(withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }));
  };
  const turnTo = (t: number) => {
    'worklet';
    if (done.get()) return;
    angle.set(FULL * t);
    landed();
  };
  // Latest worklets for the sensor listener and the keyboard's timer, without re-subscribing every render.
  const applyRef = useRef(applyDelta);
  const turnRef = useRef({ begin: turnBegin, to: turnTo, cancel: turnCancel, reopen });
  useEffect(() => { applyRef.current = applyDelta; turnRef.current = { begin: turnBegin, to: turnTo, cancel: turnCancel, reopen }; });

  // The keyboard's turn. It owns no release of its own: it puts the knob where elapsed / 650 says (`turnTo`), and the release
  // fires where a hand's does, in `landed`, when the angle reaches 360°: at t = 1 and nowhere else, because the turn starts
  // from zero (`turnBegin`) whatever the knob was doing. The `done` latch is opened there as `onBegin` opens it for a hand,
  // closed by `landed` at 360°, and reset by the `!enabled` effect below. While it runs the pan is off (a finger landing mid-turn would otherwise add its own
  // travel, and lifting would abandon the key's pull), and a second call is refused.
  const hand = useSharedValue(false); // a finger is on the crank (a shared value: the gesture's worklets write it)
  const auto = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [turning, setTurning] = useState(false);
  // Reduced motion (W1.6): the turn still takes its 650 ms, since that is when the pull is released and nothing about the
  // money path should depend on a display setting, but the knob is not drawn going round: it is placed once, at the end.
  const reduced = useReducedMotion();
  const live = useRef({ enabled, onStart, onActive, reduced });
  useEffect(() => { live.current = { enabled, onStart, onActive, reduced }; });
  useImperativeHandle(ref, () => ({
    autoCrank: () => {
      if (!live.current.enabled || hand.get() || auto.current) return false;
      setTurning(true);
      runOnUI(turnRef.current.begin)();
      live.current.onActive?.(true);
      live.current.onStart?.();
      const began = Date.now();
      const step = () => {
        const t = Math.min(1, (Date.now() - began) / AUTO_TURN_MS);
        if (t >= 1 || !live.current.reduced) runOnUI(turnRef.current.to)(t);
        if (t >= 1) { auto.current = null; setTurning(false); live.current.onActive?.(false); return; }
        auto.current = setTimeout(step, AUTO_STEP_MS);
      };
      auto.current = setTimeout(step, AUTO_STEP_MS);
      return true;
    },
  }), [hand]);
  useEffect(() => () => { if (auto.current) clearTimeout(auto.current); }, []);

  const k = useGestureScale(); // the touch arrives in glass pixels; `c` is in the app's points (see useGestureScale)
  const pan = Gesture.Pan()
    .withTestId('crank-pan')
    .enabled(enabled && !turning)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin((e) => {
      last.set(touchAngle(e.x, e.y, k));
      // After a release, a new hand turn starts from zero (`turnBegin`, as the keyboard's does). It used only to reopen the
      // latch: a release that lands on an idle machine (a failed or repriced prepare) leaves the knob held at 360° and then
      // eased back, so the latch opened over it and the first movement released a pull (#161: a 45° flick committed 127 ms
      // after the touch). Only then: a hand that grabs a knob springing back after a let-go, or one a shake has part-turned,
      // carries on from where it is, as the design's crankDown does (PR #166's review: zeroing every grab wiped a shake's
      // progress and abandoned its pull).
      reopen();
      // The web arms its motion-permission question here and asks it from the browser's own pointerup / touchend handler when this
      // touch is released (see @/sensors/motion.web). Not from this callback: on the web runOnJS is a microtask, off the handler's stack.
      runOnJS(primeMotion)();
      hand.set(true);
      if (onActive) runOnJS(onActive)(true);
      if (onStart) runOnJS(onStart)();
    })
    .onUpdate((e) => {
      if (done.get()) return;
      const a = touchAngle(e.x, e.y, k);
      let d = a - last.get();
      if (d > Math.PI) d -= FULL;
      if (d < -Math.PI) d += FULL;
      last.set(a);
      if (d < 0) d *= 0.15;
      applyDelta(d);
    })
    .onFinalize(() => {
      if (!done.get() && angle.get() < FULL) { springBack(); if (onAbandon) runOnJS(onAbandon)(); }
      hand.set(false);
      if (onActive) runOnJS(onActive)(false);
    });

  // Shake-to-crank (design: |a| > 10 adds (|a| − 10) · 0.12 rad): the sensor listener on the JS
  // thread hands each delta to the same UI-thread worklet the pan gesture uses. The first shake
  // counts as "hand on" so the pull is prepared. The simulator has no motion sensor. Samples come through the sensor seam
  // (@/sensors/motion): expo-sensors on a device, the browser's devicemotion event on the web. Android asks for a harder,
  // kept-up shake (./shake.ts: walking used to add up to a turn); iOS and the web keep the design's numbers.
  // Handlers by ref so the sensor subscription lives for the whole enabled span, not per render.
  const onStartRef = useRef(onStart); const onAbandonRef = useRef(onAbandon);
  useEffect(() => { onStartRef.current = onStart; onAbandonRef.current = onAbandon; });
  const shakeStarted = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    shakeStarted.current = false;
    // A new enabled span is a new ritual: the knob starts at rest, whatever the last span left (a release, a spring-back cut
    // short by the machine coming straight back: PR #166's second review). Set here, on the JS side, so it holds before any
    // gesture or sample of the new span.
    done.set(false); spent.set(false); ticks.set(0); angle.set(0);
    let idle: ReturnType<typeof setTimeout> | null = null;
    const tune = shakeTuning(Platform.OS);
    const sub = watchShake((g) => {
      const { counts, delta } = shakeSample(g, tune, shakeStarted.current);
      if (!counts && delta) runOnUI(applyRef.current)(delta); // Android's leak: a quiet sample mid-shake takes some of the turn back
      if (counts) {
        if (!shakeStarted.current) { shakeStarted.current = true; onStartRef.current?.(); }
        runOnUI(applyRef.current)(delta);
        if (idle) clearTimeout(idle);
        // Shaking stopped: the next shake is a new turn. Short of a full turn, spring back and abandon the prepared pull. A full
        // turn on a machine that is still enabled went nowhere (a refused or failed prepare, a new price), or its release waits on
        // a slow prepare that a second release does not change: only the turn resets. A later shake that stops short sends an
        // abandon, which the ritual ignores while that release waits.
        idle = setTimeout(() => {
          shakeStarted.current = false;
          if (done.get()) runOnUI(turnRef.current.reopen)(); // the latch reopened over a spent knob zeroes it (PR #166's second review)
          else { runOnUI(springBack)(); onAbandonRef.current?.(); }
        }, tune.idleMs);
      }
    });
    return () => { sub.remove(); if (idle) clearTimeout(idle); };
  }, [enabled, done, spent, ticks, angle, springBack]);

  // Expose progress and let the parent reset us after release.
  useDerivedValue(() => { travel.set(Math.min(1, angle.get() / FULL)); });
  useEffect(() => {
    if (!enabled) { angle.set(withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) })); ticks.set(0); done.set(false); }
  }, [enabled, angle, ticks, done]);
  // The machine went off in mid-turn (the page changed, a takeover came up): the keyboard's turn stops with it.
  // It sends the abandon a hand sends when it lets go short of 360° (onFinalize): a pull prepared for this turn is given up, and
  // the ritual ignores it if the turn had already released (#163).
  useEffect(() => {
    if (enabled || !auto.current) return;
    clearTimeout(auto.current); auto.current = null;
    runOnUI(turnRef.current.cancel)();
    setTurning(false);
    live.current.onActive?.(false);
    onAbandonRef.current?.();
  }, [enabled]);

  const knob = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}rad` }] }));
  const progress = useDerivedValue(() => angle.get() / FULL);

  // The gesture lives on the non-rotating socket: pointer angles must be measured in a fixed frame
  // around the true centre. On the rotating knob the touch coordinates turned with the knob, so
  // every delta came back reduced (k/(1+k) instead of k) — invisible at ×1, but ×5/×10 never
  // reached 360°.
  return (
    <GestureDetector gesture={pan}>
      <View style={s.socket}>
        <View style={s.socketFace} />
        <ProgressRing size={SOCKET} thickness={14} progress={progress} />
        <Animated.View style={[s.knob, armed && s.knobArmed, !enabled && { opacity: 0.6 }, knob]} pointerEvents="none">
          <View style={s.handle} />
          <View style={s.knobRim} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  socket: { width: SOCKET, height: SOCKET, alignItems: 'center', justifyContent: 'center' },
  socketFace: { position: 'absolute', inset: 0, borderRadius: SOCKET / 2, backgroundColor: '#10131F', borderWidth: 3, borderColor: '#B8242E', shadowColor: '#000', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#B4BACB', borderWidth: 3, borderColor: '#5B6275', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  knobArmed: { shadowColor: '#8FE3C5', shadowOpacity: 0.8, shadowRadius: 26 },
  handle: { position: 'absolute', top: 7, bottom: 7, width: 10, borderRadius: 5, backgroundColor: '#6E768F', borderWidth: 1, borderColor: '#4A5063' },
  knobRim: { position: 'absolute', inset: 10, borderRadius: KNOB / 2, borderWidth: 2, borderColor: 'rgba(0,0,0,0.18)' },
});
