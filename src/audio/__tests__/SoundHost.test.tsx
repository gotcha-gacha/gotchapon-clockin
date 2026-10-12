// SoundHost is a layout wrapper. A touch under it loads no player: there is no ambient loop.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';
import { SoundHost } from '@/audio/SoundHost';

type Player = { source: unknown; loop: boolean; play: () => void };
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });
const created = () => jest.mocked(createAudioPlayer).mock.results.map((r) => r.value as unknown as Player);

test('a touch loads no audio player', async () => {
  await render(<SoundHost><Text>page</Text></SoundHost>);
  expect(created()).toHaveLength(0);
  await fireEvent(screen.getByTestId('sound-host'), 'touchStart');
  await settle();
  expect(created()).toHaveLength(0);
  expect(screen.getByText('page')).toBeTruthy();
});
