// Sound engine (F6.2) against a recorded expo-audio: an effect plays from the start on its own player, nothing plays while
// muted, idle loads no looping bed, and every rendered file plays by its name.
import { expect, jest, test } from '@jest/globals';
import { readdirSync } from 'fs';
import path from 'path';
import type { Tier } from '@/api/contract';

type Player = { source: unknown; loop: boolean; volume: number; playing: boolean; play: jest.Mock; pause: jest.Mock; seekTo: jest.Mock };
type Sound = typeof import('@/audio/sfx');
type Audio = typeof import('expo-audio');

// jest-expo turns every asset into the same `1`, so each sound file gets its own name here: a player's source says which file it plays.
const DIR = path.join(__dirname, '../../../assets/sounds');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.wav')).sort();

/** A fresh engine (its module state starts unmuted, nothing loaded) with its own recorded expo-audio. */
function load() {
  let loaded!: { sound: Sound; audio: Audio; players: () => Player[] };
  jest.isolateModules(() => {
    for (const f of FILES) jest.doMock(path.join(DIR, f), () => ({ file: f }));
    const audio = jest.requireMock<Audio>('expo-audio');
    const players = () => jest.mocked(audio.createAudioPlayer).mock.results.map((r) => r.value as unknown as Player);
    loaded = { sound: jest.requireActual<Sound>('@/audio/sfx'), audio, players };
  });
  return loaded;
}
const flush = () => new Promise((done) => setTimeout(done, 0));

test('an effect plays from the start on its own player, a replay restarts that player, and muting silences every effect', async () => {
  const { sound, audio, players } = load();
  sound.playSfx('pop');
  await flush();
  expect(players()).toHaveLength(1);
  const pop = players()[0]!;
  expect(pop.source).toEqual({ file: 'pop.wav' });
  expect(pop.seekTo).toHaveBeenCalledWith(0);
  expect(pop.play).toHaveBeenCalledTimes(1);
  expect(pop.seekTo.mock.invocationCallOrder[0]).toBeLessThan(pop.play.mock.invocationCallOrder[0]!);
  expect(audio.setAudioModeAsync).toHaveBeenCalledWith({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });

  sound.playSfx('pop');
  await flush();
  expect(players()).toHaveLength(1);
  expect(pop.seekTo).toHaveBeenCalledTimes(2);
  expect(pop.play).toHaveBeenCalledTimes(2);

  sound.setSoundMuted(true);
  sound.playSfx('pop');
  sound.playSfx('chord');
  await flush();
  expect(pop.play).toHaveBeenCalledTimes(2);
  expect(players()).toHaveLength(1); // muted: the chord never even loads
});

test('idle and the mute toggle load no looping bed', async () => {
  const { sound, players } = load();
  sound.setSoundMuted(false); // the session applies the saved setting at launch: that alone starts nothing
  sound.setSoundMuted(true);
  sound.setSoundMuted(false);
  expect(players()).toHaveLength(0);
  expect(FILES).toContain('roll.wav'); // the dispense ratchet is a file; it does not start at idle
  expect(FILES).not.toContain('ambient.wav');
});

test('the dispense loop plays roll.wav until the window closes, and mute pauses it without starting a bed', async () => {
  const { sound, players } = load();
  sound.setRollLoop(true);
  await flush();
  expect(players()).toHaveLength(1);
  const roll = players()[0]!;
  expect(roll.source).toEqual({ file: 'roll.wav' });
  expect(roll.loop).toBe(true);
  expect(roll.play).toHaveBeenCalledTimes(1);

  sound.setRollLoop(true); // still dispensing: the reel lock must not restart the file
  await flush();
  expect(players()).toHaveLength(1);
  expect(roll.play).toHaveBeenCalledTimes(1);

  sound.setSoundMuted(true);
  expect(roll.playing).toBe(false);
  sound.playSfx('land');
  await flush();
  expect(players()).toHaveLength(1); // muted: the land one-shot never loads
  expect(roll.play).toHaveBeenCalledTimes(1);

  sound.setSoundMuted(false); // the pull is still dispensing, so the ratchet comes back
  await flush();
  expect(roll.playing).toBe(true);
  expect(roll.loop).toBe(true);
  expect(roll.play).toHaveBeenCalledTimes(2);

  sound.setRollLoop(false);
  expect(roll.playing).toBe(false);
  expect(roll.loop).toBe(false);
  sound.setSoundMuted(false); // the window is closed: unmute does not start a bed
  await flush();
  expect(roll.playing).toBe(false);
  expect(players()).toHaveLength(1);
});

test('a roll that starts muted loads nothing until sound is on', async () => {
  const { sound, players } = load();
  sound.setSoundMuted(true);
  sound.setRollLoop(true);
  await flush();
  expect(players()).toHaveLength(0);
  sound.setSoundMuted(false);
  await flush();
  expect(players()).toHaveLength(1);
  expect(players()[0]).toMatchObject({ source: { file: 'roll.wav' }, loop: true, playing: true });
});

test('a roll stopped before the audio mode is ready never plays', async () => {
  const { sound, audio, players } = load();
  let modeSet!: () => void;
  jest.mocked(audio.setAudioModeAsync).mockImplementationOnce(() => new Promise<void>((resolve) => { modeSet = resolve; }));
  sound.setRollLoop(true);
  await flush();
  expect(players()).toHaveLength(1);
  expect(players()[0]!.play).not.toHaveBeenCalled();
  expect(players()[0]!.loop).toBe(true);
  sound.setRollLoop(false);
  modeSet();
  await flush();
  expect(players()[0]!.play).not.toHaveBeenCalled();
  expect(players()[0]!.playing).toBe(false);
});

test('nothing plays until the audio mode is set, so the first sound can never stop the user’s own music', async () => {
  const { sound, audio, players } = load();
  let modeSet!: () => void;
  jest.mocked(audio.setAudioModeAsync).mockImplementationOnce(() => new Promise<void>((resolve) => { modeSet = resolve; }));
  sound.playSfx('tick');
  await flush();
  expect(players()).toHaveLength(1);
  const tick = players()[0]!;
  expect(tick.play).not.toHaveBeenCalled();
  expect(tick.loop).toBe(false);
  modeSet();
  await flush();
  expect(tick.play).toHaveBeenCalledTimes(1);
  expect(players().every((p) => p.loop === false)).toBe(true);
});

test('every rendered effect file plays by its name, and each tier, crank notch, scratch stroke and drop picks one of them', async () => {
  const { sound, players } = load();
  expect((['common', 'reverse', 'holo', 'ultra', 'graded'] as Tier[]).map(sound.tierSfx)).toEqual(['pop', 'pop2', 'shimmer', 'chord', 'heavy']);
  expect([0, 0.125, 0.5, 1, 1.4].map(sound.crankSfx)).toEqual(['crank-0', 'crank-0', 'crank-3', 'crank-7', 'crank-7']);
  expect([1, 2, 6].map(sound.scratchSfx)).toEqual(['scratch-1', 'scratch-2', 'scratch-1']);
  expect([0, 4].map(sound.dropSfx)).toEqual(['thud-0', 'thud-1']);

  const names = FILES.map((f) => f.replace(/\.wav$/, '')) as Parameters<Sound['playSfx']>[0][];
  expect(names).toEqual(expect.arrayContaining(['tick', 'pop', 'pop2', 'shimmer', 'chord', 'heavy', 'thud-0', 'click', 'land', 'roll']));
  for (const n of names) sound.playSfx(n);
  await flush();
  expect(players().map((p) => p.source)).toEqual(names.map((n) => ({ file: `${n}.wav` })));
});
