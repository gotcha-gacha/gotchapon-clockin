// Motion sensors on the web (W0.5, #135): the browser's own `devicemotion` event, never expo-sensors (its SDK 57 web shims
// throw from `addListener`). One window listener feeds every subscriber.
//
// iOS Safari gives no motion data until `DeviceMotionEvent.requestPermission()` is called from a user gesture, so nothing is
// asked at load. The crank calls `primeMotion()` when a touch goes down on it; that only ARMS a one-shot listener, and the
// question itself is asked from the browser's own `pointerup` / `touchend` handler when that touch is released. It cannot be
// asked from the gesture callback: on the web Reanimated's `runOnJS` is `queueMicrotask` (react-native-worklets
// `threads.js`), so a gesture callback never runs on the event handler's stack, and WebKit's user-gesture token is
// stack-scoped (PR #148's review measured the hop; whether the token survives it is unobserved, so nothing here depends on
// it). Granted → samples flow. Refused → the crank works by hand and the question is not asked again this session. Browsers without `requestPermission` (Android Chrome, every desktop) need
// no question; a desktop simply never fires the event, and the foil follows the mouse instead.
import type { Gravity, MotionSubscription, Tilt } from './motion.types';

export type { Gravity, MotionSubscription, Tilt } from './motion.types';

type MotionEventLike = {
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null } | null;
};
type PointerEventLike = { pointerType?: string; clientX: number; clientY: number };
type WindowLike = {
  addEventListener: (type: string, fn: (e: never) => void, capture?: boolean) => void;
  removeEventListener: (type: string, fn: (e: never) => void, capture?: boolean) => void;
  innerWidth: number; innerHeight: number;
  DeviceMotionEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> };
};

const win = (): WindowLike | undefined => (globalThis as unknown as { window?: WindowLike }).window;

/** unknown: not asked yet · armed: the next release asks · asking: the prompt is up · granted / refused: settled for this session. */
let permission: 'unknown' | 'armed' | 'asking' | 'granted' | 'refused' = 'unknown';
const shakers = new Set<(g: Gravity) => void>();
const tilters = new Set<(t: Tilt) => void>();
let listening = false;

const DEG = Math.PI / 180;
function onMotion(e: MotionEventLike) {
  const g = e.accelerationIncludingGravity;
  if (g && g.x != null && g.y != null && g.z != null) { const s = { x: g.x, y: g.y, z: g.z }; shakers.forEach((fn) => fn(s)); }
  const r = e.rotationRate; // deg/s: beta is about the x axis, gamma about y. expo's Gyroscope reports rad/s about the same axes.
  if (r && r.beta != null && r.gamma != null) { const t = { x: r.beta * DEG, y: r.gamma * DEG }; tilters.forEach((fn) => fn(t)); }
}
/** A mouse stands in for a gyroscope: the pointer's place in the window, −1…1, x and y swapped the way the filter reads them. */
function onPointer(e: PointerEventLike) {
  const w = win();
  if (!w || e.pointerType !== 'mouse' || !w.innerWidth || !w.innerHeight) return;
  const nx = (e.clientX / w.innerWidth) * 2 - 1, ny = (e.clientY / w.innerHeight) * 2 - 1;
  tilters.forEach((fn) => fn({ x: ny, y: nx }));
}

/** Browsers that ask nothing may listen as soon as somebody wants samples; iOS Safari only once it has said yes. */
function sync() {
  const w = win();
  if (!w) return;
  const needsAsking = typeof w.DeviceMotionEvent?.requestPermission === 'function';
  const allowed = !!w.DeviceMotionEvent && (needsAsking ? permission === 'granted' : true);
  const wanted = allowed && shakers.size + tilters.size > 0;
  if (wanted && !listening) { w.addEventListener('devicemotion', onMotion as (e: never) => void); listening = true; }
  if (!wanted && listening) { w.removeEventListener('devicemotion', onMotion as (e: never) => void); listening = false; }
}

export function watchShake(onSample: (g: Gravity) => void): MotionSubscription {
  shakers.add(onSample);
  sync();
  return { remove: () => { shakers.delete(onSample); sync(); } };
}

let pointerListening = false;
export function watchTilt(onSample: (t: Tilt) => void): MotionSubscription {
  tilters.add(onSample);
  const w = win();
  if (w && !pointerListening) { w.addEventListener('pointermove', onPointer as (e: never) => void); pointerListening = true; }
  sync();
  return {
    remove: () => {
      tilters.delete(onSample);
      const now = win();
      if (now && pointerListening && tilters.size === 0) { now.removeEventListener('pointermove', onPointer as (e: never) => void); pointerListening = false; }
      sync();
    },
  };
}

/** How an armed touch can end. A release asks; a cancel (the browser took the touch for a scroll or a system gesture) disarms,
 *  so the question never lands on some unrelated tap later. */
const RELEASES = ['pointerup', 'touchend', 'pointercancel', 'touchcancel'] as const;
/** Runs on the browser's own event-handler stack, which is what makes the question a user gesture's. Never throws. */
function askOnRelease(e?: { type?: string }) {
  const w = win();
  if (w) RELEASES.forEach((type) => w.removeEventListener(type, askOnRelease as (e: never) => void, true));
  if (permission !== 'armed') return;
  if (e?.type?.endsWith('cancel')) { permission = 'unknown'; return; } // not a release: the next crank touch arms again
  const api = w?.DeviceMotionEvent;
  if (!api || typeof api.requestPermission !== 'function') { permission = 'unknown'; return; }
  permission = 'asking';
  try {
    Promise.resolve(api.requestPermission()).then(
      (answer) => { permission = answer === 'granted' ? 'granted' : 'refused'; sync(); },
      () => { permission = 'unknown'; }, // rejected (not a gesture after all): not an answer, the next crank touch may ask
    );
  } catch { permission = 'unknown'; }
}

/** Call when a touch goes down on the crank. It asks nothing itself: it arms the release of that touch to ask (see the top of
 *  this file). Once per session at most: a refusal is final until the page reloads, and a second touch while the question is
 *  armed or up changes nothing. Never throws. */
export function primeMotion(): void {
  const w = win();
  if (permission !== 'unknown' || !w || typeof w.DeviceMotionEvent?.requestPermission !== 'function') return;
  permission = 'armed';
  RELEASES.forEach((type) => w.addEventListener(type, askOnRelease as (e: never) => void, true));
}

/** Tests only: a fresh page load. */
export function resetMotionForTests(): void {
  const w = win();
  if (w && listening) w.removeEventListener('devicemotion', onMotion as (e: never) => void);
  if (w && pointerListening) w.removeEventListener('pointermove', onPointer as (e: never) => void);
  if (w) RELEASES.forEach((type) => w.removeEventListener(type, askOnRelease as (e: never) => void, true));
  permission = 'unknown'; listening = false; pointerListening = false; shakers.clear(); tilters.clear();
}
