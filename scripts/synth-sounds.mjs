// Renders the design pack's WebAudio effect recipes into WAV files for expo-audio, which plays files rather than
// oscillators (F6.2). Source: design/Pocket Binder v4.dc.html — `snd`, `sndTone`, and the crank and capsule calls.
// The pack's `startAmbient` bed is not rendered (Ben, 24 Sept 2026). Deterministic, so a rerun reproduces the same files.
// `roll` is a soft-launch placeholder (Ben, 1 Oct 2026): a short ratchet that loops only while a pull is dispensing.
// It is not a music bed. A fixed length keeps the seam even, so the eight ticks meet the loop point on the same gap.
// Run from the repo root: `node scripts/synth-sounds.mjs` → assets/sounds/*.wav
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
const SFX_RATE = 44100;

// Band-limited oscillators (WebAudio's are): additive harmonics up to Nyquist.
function osc(type, f, t, rate) {
  const nyq = rate / 2;
  if (type === 'sine') return Math.sin(2 * Math.PI * f * t);
  let s = 0;
  for (let k = 1; k * f < nyq; k++) {
    if (type === 'square' && k % 2) s += Math.sin(2 * Math.PI * k * f * t) / k;
    else if (type === 'sawtooth') s += (k % 2 ? 1 : -1) * Math.sin(2 * Math.PI * k * f * t) / k;
    else if (type === 'triangle' && k % 2) s += (((k - 1) / 2) % 2 ? -1 : 1) * Math.sin(2 * Math.PI * k * f * t) / (k * k);
  }
  return type === 'square' ? s * 4 / Math.PI : type === 'sawtooth' ? s * 2 / Math.PI : s * 8 / (Math.PI * Math.PI);
}

// WebAudio gain automation: 0 at start, linear to `gain` after `attack`, exponential to .001 at `end`; silent after `stop`.
function env(t, start, attack, gain, end, stop) {
  if (t < start || t >= stop) return 0;
  if (t < start + attack) return gain * (t - start) / attack;
  if (t < end) return gain * Math.pow(0.001 / gain, (t - start - attack) / (end - start - attack));
  return 0.001;
}

function render(seconds, rate, voices) {
  const out = new Float64Array(Math.ceil(seconds * rate));
  for (const v of voices) {
    const from = Math.floor(v.start * rate), to = Math.min(out.length, Math.ceil(v.stop * rate));
    for (let i = from; i < to; i++) {
      const t = i / rate;
      out[i] += osc(v.type, v.f, t - v.start, rate) * env(t, v.start, v.attack, v.gain, v.end, v.stop);
    }
  }
  return out;
}

// The design's two helpers.
const tone = (f, d, type = 'sine', gain = 0.12, delay = 0) => ({ f, type, gain, start: delay, attack: 0.02, end: delay + d, stop: delay + d + 0.1 });
const sndTone = (f, delay = 0) => ({ f, type: f < 200 ? 'sine' : 'square', gain: f < 200 ? 0.12 : 0.05, start: delay, attack: 0.01, end: delay + 0.07, stop: delay + 0.12 });

const SFX = {
  click: [tone(1150, 0.06, 'square', 0.05)],
  tick: [tone(880, 0.035, 'square', 0.045)],
  pop: [tone(300, 0.12, 'triangle', 0.18), tone(520, 0.09, 'sine', 0.1, 0.03)],
  pop2: [tone(330, 0.12, 'triangle', 0.16), tone(660, 0.14, 'sine', 0.1, 0.05), tone(880, 0.12, 'sine', 0.07, 0.1)],
  shimmer: [660, 880, 1320].map((f, i) => tone(f, 0.5, 'sine', 0.08, i * 0.09)),
  chord: [262, 330, 392, 523].map((f, i) => tone(f, 1.1, 'triangle', 0.09, i * 0.05)),
  heavy: [tone(70, 0.55, 'sawtooth', 0.16), ...[523, 659, 784, 1047].map((f, i) => tone(f, 1.6, 'triangle', 0.08, 0.35 + i * 0.07))],
  land: [sndTone(160)], // the capsule lands
  // Dispense loop: eight ratchet ticks in 0.64s. The file is exactly that long, so the gap after the last tick
  // equals the gap between ticks and the loop has no click at the seam. Quieter than the land one-shot.
  roll: Array.from({ length: 8 }, (_, i) => {
    const start = i * 0.08;
    return [
      { f: 240 + (i % 2) * 40, type: 'square', gain: 0.04, start, attack: 0.003, end: start + 0.03, stop: start + 0.045 },
      { f: 80, type: 'sine', gain: 0.05, start, attack: 0.002, end: start + 0.02, stop: start + 0.04 },
    ];
  }).flat(),
  ...Object.fromEntries([140, 170, 200].map((f, i) => [`thud-${i}`, [sndTone(f)]])), // batch capsules drop (design 140–200 Hz)
  ...Object.fromEntries([900, 1000, 1100, 1200, 1300].map((f, i) => [`scratch-${i}`, [sndTone(f)]])), // scratch strokes (900–1300 Hz)
  // Crank ticks, eight a turn: a rising square (560 + travel·560) and a thump (70 + travel·40).
  ...Object.fromEntries(Array.from({ length: 8 }, (_, k) => { const travel = (k + 1) / 8; return [`crank-${k}`, [sndTone(560 + travel * 560), sndTone(70 + travel * 40)]]; })),
};

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const peak = (s) => s.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

// Effects keep the design's relative levels: one shared factor brings the loudest to 0.9.
const ROLL_LOOP_S = 0.64;
const secondsOf = (name, voices) => (name === 'roll' ? ROLL_LOOP_S : Math.max(...voices.map((v) => v.stop)));
const rendered = Object.fromEntries(Object.entries(SFX).map(([name, voices]) => [name, render(secondsOf(name, voices), SFX_RATE, voices)]));
const factor = 0.9 / Math.max(...Object.values(rendered).map(peak));

mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(rendered)) writeFileSync(join(OUT, `${name}.wav`), wav(samples.map((s) => s * factor), SFX_RATE));
console.log(`wrote ${Object.keys(rendered).length} files to ${OUT} (effects ×${factor.toFixed(2)})`);
