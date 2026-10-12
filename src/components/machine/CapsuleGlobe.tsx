// The globe's capsules: 22 two-tone spheres under 2-D physics on the UI thread (design/README.md
// "Globe" + the v4 loop): gravity .6, damping .96, curved floor with restitution .35, walls .5,
// pairwise collision r = 44 with impulse .55, idle nudge every 2.6 s, rotation follows x.
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { phoneClassWeb } from '@/web/phoneWeb';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';

export const CAPSULE_COLORS = ['#FF6B5B', '#FFD23F', '#8FE3C5', '#5BB8FF', '#C9A7FF', '#FF9A5B', '#4CD964', '#FF3B7F'];
/** How many capsules the globe can draw. A chase count is the album size, capped here. */
export const GLOBE_CAP = 22;
const N = GLOBE_CAP;
const SIZE = 44;
const BOX_W = 256; // design coordinate space (capsule left edge range)
const FLOOR = 196;

export type GlobeHandle = { kick: SharedValue<number> };

/** Call `kick.set(k)` to jostle every capsule (k ≈ .5 crank tick, 3 release, .22 idle nudge). */
export function useGlobe(): GlobeHandle {
  const kick = useSharedValue(0);
  return { kick };
}

/** Under reduced motion, how long the capsules get to fall into place before they are held still. */
export const SETTLE_MS = 3000;
/** How often an idle globe on the web gets one nudge, matching the in-loop jostle a phone used to pay for every frame. */
const IDLE_NUDGE_MS = 2600;
/**
 * Web only. The floor shoves each capsule a little every frame, so the pairwise pile never rests (measured: still
 * moving 28s later) and 22 transformed views were written from the JS thread the whole time Pull was mounted.
 * Run the same physics for a short beat after a kick — long enough to fall in or take a nudge — then hold the pose
 * until the next one. A phone skips the idle nudge; the crank and the dome churn still wake the pile.
 */
const MOTION_BUDGET_MS = 1400;
const WEB = Platform.OS === 'web';

function Capsule({ i, pos, color, flat }: { i: number; pos: SharedValue<number[]>; color: string; flat?: boolean }) {
  const style = useAnimatedStyle(() => {
    const x = pos.get()[i * 4];
    const y = pos.get()[i * 4 + 1];
    return { transform: [{ translateX: x }, { translateY: y }, { rotate: `${x * 2}deg` }] };
  });
  return (
    <Animated.View style={[s.cap, flat && s.capFlat, style]}>
      <View style={[s.half, { top: 0, backgroundColor: color, borderTopLeftRadius: SIZE / 2, borderTopRightRadius: SIZE / 2 }]} />
      <View style={[s.half, { bottom: 0, backgroundColor: '#F4F6FB', borderBottomLeftRadius: SIZE / 2, borderBottomRightRadius: SIZE / 2 }]} />
      <View style={s.shade} />
      <View style={s.shine} />
    </Animated.View>
  );
}

export function CapsuleGlobe({ globe, idle, active = true, colors = CAPSULE_COLORS, count = N }: { globe: GlobeHandle; idle: boolean; active?: boolean; colors?: string[]; count?: number }) {
  const n = Math.min(count, N);
  // Deterministic start layout (render must stay pure); the first kicks scatter them.
  const pos = useSharedValue<number[]>(
    Array.from({ length: N * 4 }, (_, k) => { const i = Math.floor(k / 4); return k % 4 === 0 ? 14 + ((i * 97) % 250) : k % 4 === 1 ? 40 + ((i * 61) % 140) : 0; }),
  );
  const idleSv = useSharedValue(idle);
  // -1, not 0. timeSinceFirstFrame is 0 on the first frame, and frame.timestamp is ms since boot —
  // a clock that stays at 0 used to match `lastJig === 0` on every frame and kick the pile forever.
  const lastJig = useSharedValue(-1);
  const alive = useSharedValue(n);
  const kick = globe.kick;
  useEffect(() => { idleSv.set(idle); }, [idle, idleSv]);
  useEffect(() => { alive.set(n); }, [n, alive]);

  // Reduced motion (the system setting, F6.2): the capsules still settle once, but nothing jostles them.
  // The step runs in this frame callback. A pos.modify updater is its own worklet, rebuilt every frame.
  const reduced = useReducedMotion();
  // Web: the loop is off once the pile is still. A kick from the machine (or the idle timer) turns it back on.
  const [awake, setAwake] = useState(true);
  const resting = useSharedValue(false);
  /** timeSinceFirstFrame of the last kick. 0 is the opening fall, which gets the same budget. */
  const stirred = useSharedValue(0);
  const sleep = useCallback(() => setAwake(false), []);
  const loop = useFrameCallback((frame) => {
    'worklet';
    const t = frame.timeSinceFirstFrame;
    const m = alive.get();
    // On the web the idle nudge is a timer, so a sleeping pile still gets one. The native loop keeps it here.
    if (!WEB && (lastJig.get() < 0 || t - lastJig.get() > IDLE_NUDGE_MS)) {
      lastJig.set(t);
      if (idleSv.get()) kick.set(Math.max(kick.get(), 0.22));
    }
    const k = kick.get();
    if (k > 0) { kick.set(0); resting.set(false); stirred.set(t); }
    // Already at rest and nothing new to apply: do not write transforms. The loop is about to be switched off.
    if (WEB && resting.get()) return;
    const p = pos.get().slice();
    for (let i = 0; i < m; i++) {
      const b = i * 4;
      if (k > 0 && !reduced) { p[b + 2] += (Math.random() - 0.5) * 6 * k; p[b + 3] -= Math.random() * 8 * k; }
      p[b + 3] += 0.6;
      p[b] += p[b + 2];
      p[b + 1] += p[b + 3];
      p[b + 2] *= 0.96;
      const fl = FLOOR - Math.abs(p[b] - 128) * 0.22;
      if (p[b + 1] > fl) { p[b + 1] = fl; p[b + 3] *= -0.35; p[b + 2] *= 0.8; p[b + 2] += p[b] < 128 ? -0.3 : 0.3; }
      if (p[b + 1] < 0) { p[b + 1] = 0; p[b + 3] *= -0.4; }
      const ex = Math.max(4, 26 - Math.min(p[b + 1], 60) * 0.4);
      if (p[b] < ex) { p[b] = ex; p[b + 2] *= -0.5; }
      if (p[b] > BOX_W - ex) { p[b] = BOX_W - ex; p[b + 2] *= -0.5; }
    }
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        const a = i * 4, c = j * 4;
        const dx = p[c] - p[a], dy = p[c + 1] - p[a + 1];
        const d2 = dx * dx + dy * dy;
        if (d2 < SIZE * SIZE && d2 > 0.01) {
          const d = Math.sqrt(d2), ov = (SIZE - d) / 2, nx = dx / d, ny = dy / d;
          p[a] -= nx * ov; p[a + 1] -= ny * ov; p[c] += nx * ov; p[c + 1] += ny * ov;
          const rv = (p[c + 2] - p[a + 2]) * nx + (p[c + 3] - p[a + 3]) * ny;
          if (rv < 0) { const imp = rv * 0.55; p[a + 2] += nx * imp; p[a + 3] += ny * imp; p[c + 2] -= nx * imp; p[c + 3] -= ny * imp; }
        }
      }
    }
    if (WEB && k === 0 && t - stirred.get() > MOTION_BUDGET_MS) {
      for (let i = 0; i < m; i++) { p[i * 4 + 2] = 0; p[i * 4 + 3] = 0; }
      resting.set(true);
      pos.set(p);
      runOnJS(sleep)();
      return;
    }
    pos.set(p);
  }, true);
  // The machine writes `kick` while this loop may already be asleep (a crank release, dome churn). Wake within a frame.
  useEffect(() => {
    if (!WEB || !active || awake) return undefined;
    const id = setInterval(() => {
      if (kick.get() <= 0) return;
      resting.set(false);
      setAwake(true);
    }, 50);
    return () => clearInterval(id);
  }, [active, awake, kick, resting]);
  // Idle nudge on the web, off the frame loop so a still pile is not a 60fps job between nudges.
  useEffect(() => {
    // A phone holds the pose between pulls. The nudge is decorative; the crank still kicks the shared value.
    if (!WEB || !active || !idle || reduced || phoneClassWeb()) return undefined;
    const id = setInterval(() => {
      resting.set(false);
      kick.set(Math.max(kick.get(), 0.22));
      setAwake(true);
    }, IDLE_NUDGE_MS);
    return () => clearInterval(id);
  }, [active, idle, reduced, kick, resting]);
  // ...and once they have settled they hold still (W1.6, #139). The pile never quite comes to rest by itself: once a capsule
  // has left it, the pairwise push-apart keeps every capsule trembling for good (measured in Chromium under
  // prefers-reduced-motion: 22 elements still moving 28 s after a pull, one by 2 px). So under reduced motion the loop runs for
  // a settling window after the globe appears and after the number of capsules changes, and is then switched off.
  const [stillAt, setStillAt] = useState<number | null>(null);
  useEffect(() => {
    if (!reduced) return;
    const t = setTimeout(() => setStillAt(n), SETTLE_MS);
    return () => clearTimeout(t);
  }, [reduced, n]);
  const running = active && awake && (!reduced || stillAt !== n);
  useEffect(() => { loop.setActive(running); }, [running, loop]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => <Capsule key={i} i={i} pos={pos} color={colors[i % colors.length]} flat={WEB} />)}
    </View>
  );
}

const s = StyleSheet.create({
  cap: { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, borderRadius: SIZE / 2, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  // A moving box-shadow is a paint on every frame. The dome is dark; the drop shadow was not carrying the read.
  capFlat: { shadowOpacity: 0, shadowRadius: 0 },
  half: { position: 'absolute', left: 0, right: 0, height: SIZE / 2 },
  shade: { position: 'absolute', inset: 0, borderRadius: SIZE / 2, borderRightWidth: 5, borderBottomWidth: 6, borderColor: 'rgba(0,0,0,0.18)' },
  shine: { position: 'absolute', left: 8, top: 5, width: 14, height: 9, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.5)', transform: [{ rotate: '-18deg' }] },
});
