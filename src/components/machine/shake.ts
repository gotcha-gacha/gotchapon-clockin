// Shake-to-crank's arithmetic, per platform: what one motion sample (`accelerationIncludingGravity`, m/s²) does to a turn.
// Pure, so the crank's listener and the tests share it.
//
// The design's numbers (|a| > 10 adds (|a| − 10) · 0.12 rad of hand travel; the turn resets after 2.5 s without one) stay
// on iOS and the web. Android (Ben, 11 Oct 2026, for the judging build): a phone at rest reads ~9.8 of those 10, Android's
// raw accelerometer is noisy, and a turn reset only after 2.5 s of quiet, so walking with the Pull page open could add up
// to a full turn — a $1 pull, signed without a prompt. Ben chose a harder shake over no shake. On Android a sample counts
// only over 15 m/s² (gravity alone is 9.8; walking with the phone in hand peaks around 13), every sample that does not
// count takes some of the turn back while a shake is going, and 0.6 s without one that counts ends it (spring back,
// abandon). Measured on synthetic motion at the crank's 33 ms sampling (shake.test.ts): steps, even 2.5 g heel strikes at
// running cadence, never add up; a 2 g shake at 3 Hz turns in about 1.3 s.
import type { Gravity } from '@/sensors/motion';

export type ShakeTuning = {
  /** A sample counts as shaking only above this, in m/s² with gravity in it. */
  threshold: number;
  /** Radians of hand travel per m/s² over the threshold. */
  gain: number;
  /** Radians of hand travel each sample at or under the threshold takes back while a shake is going. */
  leak: number;
  /** This long without a sample that counts and the shake is over: short of a full turn, the knob springs back. */
  idleMs: number;
};

/** iOS and the web: the design's numbers, unchanged. */
export const DESIGN_SHAKE: ShakeTuning = { threshold: 10, gain: 0.12, leak: 0, idleMs: 2500 };

/** Android: about 1.5 g with gravity in it. Gravity is 9.8 and walking with the phone in hand peaks around 13. */
export const ANDROID_SHAKE_THRESHOLD = 15;
/** Android: the leak. 13 quiet samples between two steps 0.5 s apart take back 5.2 rad, more than a hard heel strike
 *  (two or three samples of 20 to 30 m/s²) adds, so steps never add up. A shake that is kept up outruns it. */
export const ANDROID_SHAKE_LEAK = 0.4;
/** Android: a shake is over 0.6 s after its last sample that counted (the design waits 2.5 s). */
export const ANDROID_SHAKE_IDLE_MS = 600;
export const ANDROID_SHAKE: ShakeTuning = { threshold: ANDROID_SHAKE_THRESHOLD, gain: DESIGN_SHAKE.gain, leak: ANDROID_SHAKE_LEAK, idleMs: ANDROID_SHAKE_IDLE_MS };

export function shakeTuning(os: string): ShakeTuning {
  return os === 'android' ? ANDROID_SHAKE : DESIGN_SHAKE;
}

/** One sample: whether it counts as shaking (it starts a shake, or keeps one going), and the hand travel it adds. A sample
 *  that does not count adds nothing, or takes the leak back while a shake is going (`shaking`). */
export function shakeSample(g: Gravity, t: ShakeTuning, shaking: boolean): { counts: boolean; delta: number } {
  const mag = Math.hypot(g.x, g.y, g.z);
  if (mag > t.threshold) return { counts: true, delta: (mag - t.threshold) * t.gain };
  return { counts: false, delta: shaking && t.leak > 0 ? -t.leak : 0 };
}
