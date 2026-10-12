// The sky in a browser (#211): what it starts, what it refuses to start, and the one case the pack warns about — a canvas
// whose box has not arrived yet, which must wait for a size rather than give up on the loop.
//
// jsdom draws nothing, so what this measures is the wiring: which frames are asked for, and what the first one does once the
// canvas has a box. That the picture is right, and that it moves, is measured in a real browser against a served export.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HeroSky } from '@/screens/firstScreen/HeroSky';
import { makeMutable } from 'react-native-reanimated';

/** A pointer that never moves: the lean is slice C's and is measured there. */
const tilt = { x: makeMutable(0), y: makeMutable(0) };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const mount = async (ui: React.ReactElement) => { await act(async () => { root.render(ui); }); };
const canvas = () => document.querySelector('[data-testid="sky-canvas"]') as HTMLCanvasElement | null;

/** Just enough 2D context for the draw loop to run to the end; every call is recorded so the test can see it ran. */
function fakeContext() {
  const gradient = { addColorStop: jest.fn() };
  return {
    calls: { clearRect: 0, fillRect: 0, arc: 0 },
    createLinearGradient: () => gradient, createRadialGradient: () => gradient, createPattern: () => null,
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => {},
    clearRect() { this.calls.clearRect++; }, fillRect() { this.calls.fillRect++; },
    save: () => {}, restore: () => {}, beginPath: () => {}, moveTo: () => {}, closePath: () => {}, fill: () => {}, translate: () => {},
    drawImage: () => {},
    arc() { this.calls.arc++; },
    fillStyle: '' as unknown, globalAlpha: 1, globalCompositeOperation: '' as unknown,
  };
}
/** `getContext` is overloaded, so a spy on it types as the WebGPU one: the cast is here, once, and not at each call. */
const stubContext = (ctx: unknown) => jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

/** A canvas whose box is `size`; 0 × 0 is what a browser reports for the frame before layout lands. */
const withBox = (el: HTMLElement, size: { width: number; height: number }) => {
  el.getBoundingClientRect = () => ({ width: size.width, height: size.height, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON: () => ({}) });
};

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); jest.restoreAllMocks(); });

test('reduced motion draws no canvas at all: the poster is the whole sky', async () => {
  const raf = jest.spyOn(window, 'requestAnimationFrame');
  await mount(<HeroSky reduced calm={false} tilt={tilt} />);
  expect(canvas()).toBeNull();
  expect(document.querySelector('[data-testid="still-sky"]')).not.toBeNull();
  expect(raf).not.toHaveBeenCalled();
});

test('a browser that will not give a 2D context keeps the poster and starts nothing', async () => {
  const raf = jest.spyOn(window, 'requestAnimationFrame');
  stubContext(null);
  await mount(<HeroSky reduced={false} calm={false} tilt={tilt} />);
  expect(canvas()).not.toBeNull(); // the element is there; nothing is driving it
  expect(document.querySelector('[data-testid="still-sky"]')).not.toBeNull();
  expect(raf).not.toHaveBeenCalled();
});

test('a canvas with no box yet asks for another frame instead of giving up, and draws once it has one', async () => {
  const ctx = fakeContext();
  stubContext(ctx);
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });

  await mount(<HeroSky reduced={false} calm={false} tilt={tilt} />);
  const el = canvas()!;
  withBox(el, { width: 0, height: 0 }); // jsdom's own answer, and a real browser's for one frame
  await act(async () => { frames.shift()!(0); });
  expect([ctx.calls.clearRect, frames.length]).toEqual([0, 1]); // nothing drawn, but the loop is still alive

  withBox(el, { width: 390, height: 844 });
  await act(async () => { frames.shift()!(16); });
  expect(ctx.calls.clearRect).toBe(1);
  expect(ctx.calls.arc).toBeGreaterThan(48); // the particles and the sweeps' wedges
  expect(frames.length).toBe(1); // and it asked for the next one
});

test('calm thins the particles out', async () => {
  const ctx = fakeContext();
  stubContext(ctx);
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
  await mount(<HeroSky reduced={false} calm tilt={tilt} />);
  withBox(canvas()!, { width: 390, height: 844 });
  await act(async () => { frames.shift()!(16); });
  const calm = ctx.calls.arc;

  await act(async () => { root.unmount(); });
  root = createRoot(host);
  const full = fakeContext();
  stubContext(full);
  frames.length = 0;
  await mount(<HeroSky reduced={false} calm={false} tilt={tilt} />);
  withBox(canvas()!, { width: 390, height: 844 });
  await act(async () => { frames.shift()!(16); });
  expect(full.calls.arc - calm).toBe(26); // 48 particles against 22, the pack's two counts
});

test('the auth sheet does not start the sky', async () => {
  const raf = jest.spyOn(window, 'requestAnimationFrame');
  await mount(<HeroSky reduced={false} calm={false} tilt={tilt} paused />);
  expect(canvas()).not.toBeNull();
  expect(raf).not.toHaveBeenCalled();
});

test('a hidden tab does not keep the sky painting', async () => {
  jest.useFakeTimers();
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
  const ctx = fakeContext();
  stubContext(ctx);
  const hidden = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  try {
    await mount(<HeroSky reduced={false} calm={false} tilt={tilt} />);
    withBox(canvas()!, { width: 390, height: 844 });
    expect(frames.length).toBe(1); // the effect asked for a frame; the draw itself must not chain another while hidden
    await act(async () => { frames.shift()!(16); });
    expect(frames.length).toBe(0);
    await act(async () => { jest.advanceTimersByTime(1200); });
    expect(frames.length).toBe(0);
    hidden.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(frames.length).toBe(1);
  } finally {
    jest.useRealTimers();
    hidden.mockRestore();
  }
});

test('a phone paints fewer dots', async () => {
  const ctx = fakeContext();
  stubContext(ctx);
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
  const media = jest.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('max-width') || query.includes('pointer'),
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
  try {
    await mount(<HeroSky reduced={false} calm={false} tilt={tilt} />);
    withBox(canvas()!, { width: 390, height: 700 });
    await act(async () => { frames.shift()!(16); });
    // 22 dots and two sweeps of two wedges. A desktop frame is 48 dots and eight wedges.
    expect(ctx.calls.arc).toBe(22 + 4);
  } finally { media.mockRestore(); }
});
