// Sound (F6.2): the design's effects, rendered from its WebAudio recipes by scripts/synth-sounds.mjs into assets/sounds.
// expo-audio plays files, so each effect is a small player made on first use, and a replay restarts it. The rapid sounds
// (crank ticks, scratch strokes, capsule drops) come in pitch variants, which also lets them overlap. Sound follows the
// ring/silent switch and mixes with whatever the user is listening to. The ♪ toggle silences effects. There is no ambient
// bed (Ben, 24 Sept 2026): nothing loops under an idle screen. A pull that is dispensing loops `roll` until that window
// ends (Ben, 1 Oct 2026); it is a placeholder ratchet, not a bed and not a tier fanfare. The capsule's land one-shot stays.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { Tier } from '@/api/contract';

const SOURCES = {
  click: require('../../assets/sounds/click.wav'),
  tick: require('../../assets/sounds/tick.wav'),
  pop: require('../../assets/sounds/pop.wav'),
  pop2: require('../../assets/sounds/pop2.wav'),
  shimmer: require('../../assets/sounds/shimmer.wav'),
  chord: require('../../assets/sounds/chord.wav'),
  heavy: require('../../assets/sounds/heavy.wav'),
  land: require('../../assets/sounds/land.wav'),
  roll: require('../../assets/sounds/roll.wav'),
  'thud-0': require('../../assets/sounds/thud-0.wav'),
  'thud-1': require('../../assets/sounds/thud-1.wav'),
  'thud-2': require('../../assets/sounds/thud-2.wav'),
  'scratch-0': require('../../assets/sounds/scratch-0.wav'),
  'scratch-1': require('../../assets/sounds/scratch-1.wav'),
  'scratch-2': require('../../assets/sounds/scratch-2.wav'),
  'scratch-3': require('../../assets/sounds/scratch-3.wav'),
  'scratch-4': require('../../assets/sounds/scratch-4.wav'),
  'crank-0': require('../../assets/sounds/crank-0.wav'),
  'crank-1': require('../../assets/sounds/crank-1.wav'),
  'crank-2': require('../../assets/sounds/crank-2.wav'),
  'crank-3': require('../../assets/sounds/crank-3.wav'),
  'crank-4': require('../../assets/sounds/crank-4.wav'),
  'crank-5': require('../../assets/sounds/crank-5.wav'),
  'crank-6': require('../../assets/sounds/crank-6.wav'),
  'crank-7': require('../../assets/sounds/crank-7.wav'),
} as const;
// Nothing listens to playback status, so each player reports it once a minute rather than every 500 ms (on Android the
// default runs a main-thread timer per player for the app's lifetime).
const QUIET = { updateInterval: 60_000 };

export type Sfx = keyof typeof SOURCES;

const players = new Map<Sfx, AudioPlayer>();
let muted = false;
let mode: Promise<void> | null = null;
/** The dispense window asked for the ratchet. Mute pauses it; leaving the window clears this, so unmuting later starts nothing. */
let rollOn = false;
/** We already asked this player to loop. Native `playing` updates off the status event, so it cannot be the guard. */
let rollStarted = false;

/** Set the audio mode once, before anything plays: respect the ring/silent switch and never pause the user's own music. A play
 *  that beat it would start in the default audio session, which stops other audio. */
function audioReady(): Promise<void> {
  if (!mode) mode = setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
  return mode;
}

function playerFor(name: Sfx): AudioPlayer {
  let player = players.get(name);
  if (!player) {
    player = createAudioPlayer(SOURCES[name], QUIET);
    players.set(name, player);
  }
  return player;
}

/** Play an effect from the start. Muted, nothing plays. One-shots never loop, including `roll` if something plays it once. */
export function playSfx(name: Sfx): void {
  if (muted) return;
  const p = playerFor(name);
  p.loop = false;
  void audioReady().then(() => {
    if (muted) return;
    p.loop = false;
    p.seekTo(0).then(() => p.play(), () => p.play());
  });
}

/**
 * The dispense ratchet. `on` while the pull is rolling, stopping, or dropping; off the moment that window ends.
 * Already playing and asked again: leave it, so the reel lock does not restart the file. Muted: remember the ask and
 * load nothing. The ♪ toggle pauses a loop that is already going and resumes it if the window is still open.
 */
export function setRollLoop(on: boolean): void {
  rollOn = on;
  if (!on) {
    rollStarted = false;
    const player = players.get('roll');
    if (player) {
      player.pause();
      player.loop = false;
    }
    return;
  }
  if (muted) return;
  const player = playerFor('roll');
  player.loop = true;
  if (rollStarted) return;
  rollStarted = true;
  void audioReady().then(() => {
    if (muted || !rollOn) {
      rollStarted = false;
      player.pause();
      player.loop = false;
      return;
    }
    player.loop = true;
    player.play();
  });
}

/** The reveal's sound by tier (design timing sheet): pop · pop2 · shimmer · chord · heavy. */
export const tierSfx = (tier: Tier): Sfx => ({ common: 'pop', reverse: 'pop2', holo: 'shimmer', ultra: 'chord', graded: 'heavy' } as const)[tier];

/** A crank tick for how far the crank has turned (0..1): the tone rises through the turn, eight steps a revolution. */
export const crankSfx = (travel: number): Sfx => `crank-${Math.min(7, Math.max(0, Math.round(travel * 8) - 1))}` as Sfx;

/** Scratch strokes and batch capsule drops cycle through their pitch variants (the design picks one at random). */
export const scratchSfx = (stroke: number): Sfx => `scratch-${Math.abs(stroke) % 5}` as Sfx;
export const dropSfx = (index: number): Sfx => `thud-${Math.abs(index) % 3}` as Sfx;

/** Sound off (the ♪ toggle) silences effects. A one-shot already in flight finishes; the next one does not start.
 *  The dispense loop is not a one-shot: mute pauses it, and sound on resumes it only if the pull is still dispensing. */
export function setSoundMuted(next: boolean): void {
  muted = next;
  if (next) {
    rollStarted = false;
    players.get('roll')?.pause();
  } else if (rollOn) setRollLoop(true);
}
