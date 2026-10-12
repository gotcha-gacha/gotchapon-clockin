/**
 * Gestures under the sound host create no player. The web host that started the arcade loop from pointerup / keydown is gone.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SoundHost } from '@/audio/SoundHost';

const mockPlayers: unknown[] = [];
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  createAudioPlayer: jest.fn(() => { const p = { loop: false, play: jest.fn() }; mockPlayers.push(p); return p; }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const gesture = async (type: string) => { await act(async () => { window.dispatchEvent(new Event(type)); await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(async () => {
  mockPlayers.length = 0;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<SoundHost><span>page</span></SoundHost>); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

test('a click, a key, and a touch start no loop', async () => {
  await gesture('pointerup');
  await gesture('keydown');
  await gesture('touchstart');
  expect(mockPlayers).toHaveLength(0);
  expect(host.textContent).toContain('page');
});
