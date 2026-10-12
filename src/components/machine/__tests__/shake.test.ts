// Shake-to-crank's numbers per platform (shake.ts; Ben, 11 Oct 2026). On Android, walking with the Pull page open added up to
// a full turn, which is a $1 pull signed without a prompt. Fed here as synthetic motion at the crank's 33 ms sampling, through
// the same arithmetic the crank's listener runs: a turn is 2π of knob, hand travel geared ×0.8 (×1 pull), and a shake ends,
// short of a turn, `idleMs` after its last sample that counted.
import { expect, test } from '@jest/globals';
import { ANDROID_SHAKE, DESIGN_SHAKE, shakeSample, shakeTuning, type ShakeTuning } from '../shake';

const DT = 33;
const FULL = 2 * Math.PI;

/** When the first full turn lands, in ms, or null if it never does. `mags` are |a| samples, DT apart. */
function firstTurn(mags: number[], t: ShakeTuning): number | null {
  let knob = 0, shaking = false, last = -Infinity;
  for (let i = 0; i < mags.length; i++) {
    const now = i * DT;
    if (shaking && now - last >= t.idleMs) { shaking = false; knob = 0; } // the idle timer: spring back
    const { counts, delta } = shakeSample({ x: mags[i], y: 0, z: 0 }, t, shaking);
    if (counts) { shaking = true; last = now; }
    knob = Math.max(0, knob + delta * 0.8);
    if (knob >= FULL) return now;
  }
  return null;
}

// Deterministic noise: the same walk every run.
function noise(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
}
const seconds = (n: number) => Math.round((n * 1000) / DT);
const series = (secs: number, f: (ms: number, i: number) => number) => Array.from({ length: seconds(secs) }, (_, i) => f(i * DT, i));
const n = noise(7);
const resting = series(60, () => 9.8 + n() * 5); // 7.3 … 12.3: a phone on a table, or in a still hand, on a noisy sensor
const walking = series(60, (ms) => 9.8 + 3.5 * Math.sin((2 * Math.PI * 2 * ms) / 1000) + n() * 2); // two steps a second, peaks near 14
/** A heel strike every `every` ms: two samples, 25 then 20 m/s², and the noisy resting phone between. */
const strikes = (every: number) => series(60, (ms) => { const p = ms % every; return p < DT ? 25 : p < 2 * DT ? 20 : 9.8 + n() * 2; });
/** A hard heel strike every 0.5 s: three samples of 30, 30, 25 (3 g). */
const hardStrikes = series(60, (ms) => { const p = ms % 500; return p < 2 * DT ? 30 : p < 3 * DT ? 25 : 9.8 + n() * 2; });
/** A deliberate shake, side to side: `g` × 9.8 m/s² peak at `hz`, on top of gravity. */
const shake = (g: number, hz: number) => series(10, (ms) => Math.hypot(9.8, g * 9.8 * Math.sin((2 * Math.PI * hz * ms) / 1000)));

test('iOS and the web keep the design\'s numbers, exactly', () => {
  expect(shakeTuning('ios')).toEqual({ threshold: 10, gain: 0.12, leak: 0, idleMs: 2500 });
  expect(shakeTuning('web')).toBe(DESIGN_SHAKE);
  expect(shakeSample({ x: 13, y: 0, z: 0 }, DESIGN_SHAKE, false)).toEqual({ counts: true, delta: expect.closeTo(0.36, 9) });
  expect(shakeSample({ x: 9.8, y: 0, z: 0 }, DESIGN_SHAKE, true)).toEqual({ counts: false, delta: 0 }); // no leak
});

test('Android counts a sample only over 15 m/s², and leaks only while a shake is going', () => {
  expect(shakeTuning('android')).toBe(ANDROID_SHAKE);
  expect(ANDROID_SHAKE).toEqual({ threshold: 15, gain: 0.12, leak: 0.4, idleMs: 600 });
  expect(shakeSample({ x: 15, y: 0, z: 0 }, ANDROID_SHAKE, false).counts).toBe(false); // 15 is not over 15
  expect(shakeSample({ x: 20, y: 0, z: 0 }, ANDROID_SHAKE, false)).toEqual({ counts: true, delta: expect.closeTo(0.6, 9) });
  expect(shakeSample({ x: 9.8, y: 0, z: 0 }, ANDROID_SHAKE, false)).toEqual({ counts: false, delta: 0 }); // at rest, nothing
  expect(shakeSample({ x: 9.8, y: 0, z: 0 }, ANDROID_SHAKE, true)).toEqual({ counts: false, delta: -0.4 }); // mid-shake, the leak
});

test('the bug, pinned: with the design\'s numbers a minute of walking, or of steps, turns the crank', () => {
  expect(firstTurn(walking, DESIGN_SHAKE)).not.toBeNull();
  expect(firstTurn(strikes(500), DESIGN_SHAKE)).not.toBeNull();
});

test('on Android a minute of rest, walking, steps at walking or running cadence, or hard 3 g heel strikes never turns it', () => {
  expect(firstTurn(resting, ANDROID_SHAKE)).toBeNull();
  expect(firstTurn(walking, ANDROID_SHAKE)).toBeNull();
  expect(firstTurn(strikes(500), ANDROID_SHAKE)).toBeNull();
  expect(firstTurn(strikes(350), ANDROID_SHAKE)).toBeNull();
  expect(firstTurn(hardStrikes, ANDROID_SHAKE)).toBeNull();
  // The leak is what holds the steps back, not the 0.6 s reset alone: without it the same steps turn the crank in seconds.
  expect(firstTurn(strikes(500), { ...ANDROID_SHAKE, leak: 0 })).not.toBeNull();
});

test('on Android a hard shake that is kept up still turns it, and a gentle one does not', () => {
  const t2g = firstTurn(shake(2, 3), ANDROID_SHAKE); // 2 g at 3 Hz
  expect(t2g).not.toBeNull();
  expect(t2g!).toBeLessThan(2000);
  expect(firstTurn(shake(2.5, 4), ANDROID_SHAKE)!).toBeLessThan(1000);
  expect(firstTurn(shake(1.5, 3), ANDROID_SHAKE)).toBeNull(); // 1.5 g: turns on iOS, not here
  expect(firstTurn(shake(1.5, 3), DESIGN_SHAKE)).not.toBeNull();
});
