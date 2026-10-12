// On the web the globe's 22 capsules used to step on the JS thread forever: the floor injects a little
// velocity every frame, so the pile never rests and every shadow repaints. It now sleeps, and a nudge or a
// kick wakes it. Native keeps the old loop (reducedMotion.test.tsx is the control that it does not stop).
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Reanimated from 'react-native-reanimated';
import { CapsuleGlobe } from '@/components/machine/CapsuleGlobe';

type Frame = { timestamp: number; timeSincePreviousFrame: number; timeSinceFirstFrame: number };
const activeLog: boolean[] = [];
let loop: ((frame: Frame) => void) | null = null;

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    __esModule: true,
    ...actual,
    useFrameCallback: jest.fn((cb: (frame: Frame) => void) => {
      loop = cb;
      return { setActive: (on: boolean) => { activeLog.push(on); }, isActive: true, callbackId: 0 };
    }),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLElement;

beforeEach(() => {
  activeLog.length = 0;
  loop = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  jest.useRealTimers();
});

test('the pile sleeps once it is still, and an idle nudge wakes it', async () => {
  const globe = { kick: Reanimated.makeMutable(0) };
  await act(async () => { root.render(<CapsuleGlobe globe={globe} idle count={22} />); });
  expect(loop).not.toBeNull();
  const step = loop!;
  for (let t = 16; t <= 20000; t += 16) step({ timestamp: t, timeSincePreviousFrame: 16, timeSinceFirstFrame: t });
  await act(async () => { await Promise.resolve(); });
  expect(activeLog).toContain(false);

  activeLog.length = 0;
  await act(async () => { jest.advanceTimersByTime(2600); });
  expect(globe.kick.get()).toBeGreaterThan(0);
  expect(activeLog).toContain(true);
});
