// The ♪ toggle against the real session: it silences effects, is written to the device, and is still off after a
// relaunch. Turning it back on lets the next effect play. A touch loads no looping bed.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createAudioPlayer } from 'expo-audio';
import { playSfx, setRollLoop, setSoundMuted } from '@/audio/sfx';
import { SoundHost } from '@/audio/SoundHost';
import { AuthProvider } from '@/auth/AuthProvider';
import { HeaderOverlay } from '@/components/HeaderOverlay';
import { SessionProvider } from '@/state/session';
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '@/state/settings';

type Player = { loop: boolean; playing: boolean };
const created = () => jest.mocked(createAudioPlayer).mock.results.map((r) => r.value as unknown as Player);
const app = () => (
  <SafeAreaProvider>
    <AuthProvider>
      <SessionProvider>
        <SoundHost><HeaderOverlay onOpenSettings={() => {}} /></SoundHost>
      </SessionProvider>
    </AuthProvider>
  </SafeAreaProvider>
);

test('the ♪ toggle silences effects, survives a relaunch, and turning it back on lets the next effect play', async () => {
  const { unmount } = await render(app());
  const before = created().length;
  await fireEvent(screen.getByTestId('sound-host'), 'touchStart');
  expect(created()).toHaveLength(before);

  playSfx('pop');
  await waitFor(() => expect(created()[before]).toMatchObject({ loop: false, playing: true }));
  await fireEvent.press(screen.getByLabelText('Sound on'));
  expect(screen.getByLabelText('Sound off')).toBeTruthy();
  playSfx('chord');
  expect(created()).toHaveLength(before + 1); // muted: the next effect never loads
  expect(readSettings().muted).toBe(true);

  await unmount(); // a relaunch reads the setting back
  await render(app());
  expect(await screen.findByLabelText('Sound off')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Sound off'));
  expect(readSettings().muted).toBe(false);
  playSfx('tick');
  await waitFor(() => expect(created()[before + 1]).toMatchObject({ loop: false, playing: true }));
});

test('the ♪ toggle pauses the dispense loop, and turning sound back on resumes it', async () => {
  writeSettings({ ...DEFAULT_SETTINGS });
  setSoundMuted(false);
  setRollLoop(false);
  await render(app());
  const before = created().length;
  setRollLoop(true);
  await waitFor(() => expect(created()[before]).toMatchObject({ loop: true, playing: true }));
  await fireEvent.press(screen.getByLabelText('Sound on'));
  await waitFor(() => expect(created()[before]).toMatchObject({ playing: false }));
  await fireEvent.press(screen.getByLabelText('Sound off'));
  await waitFor(() => expect(created()[before]).toMatchObject({ loop: true, playing: true }));
  setRollLoop(false);
});
