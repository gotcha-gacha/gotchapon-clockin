/**
 * The capsule and the foil on the web (W0.2d, #138), rendered by react-dom through react-native-web. The CanvasKit loader is the
 * production one with `fetch` and Skia's web loader stood in for; the Skia components themselves are stand-ins, because the
 * point here is which one the web file picks and what happens when Skia is missing, late or broken — not Skia's drawing.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScratchCapsule } from '../ScratchCapsule';
import { Foil } from '../Foil';
import * as skiaWeb from '../skiaWeb';

type WebLoader = typeof skiaWeb & { resetSkiaWebForTests: () => void; IDLE_START_MS: number };
const loader = skiaWeb as WebLoader;
// jest hoists these factories above the imports, so what they close over is named mock* and created before them.
const mockLoadSkiaWeb = jest.fn(async (_opts?: unknown) => {});
const mockSkia = { capsuleThrows: false };
jest.mock('@shopify/react-native-skia/lib/module/web', () => ({ LoadSkiaWeb: (o: unknown) => mockLoadSkiaWeb(o) }));
jest.mock('../SkiaScratchCapsule', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return { SkiaScratchCapsule: (p: { capProps?: { onKeyDown?: (e: object) => void } }) => { if (mockSkia.capsuleThrows) throw new Error('CanvasKit went away'); return R.createElement('div', { 'data-testid': 'skia-capsule', tabIndex: 0, onKeyDown: p.capProps?.onKeyDown }); } };
});
jest.mock('../SkiaFoil', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return { SkiaFoil: () => R.createElement('div', { 'data-testid': 'skia-foil' }) };
});
jest.mock('@/audio/sfx', () => ({ playSfx: jest.fn() }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const G = globalThis as unknown as { fetch?: unknown };
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer; // "\0asm", version 1: the header of any real module
const wasm = (ok: boolean, bytes: ArrayBuffer = WASM) => { G.fetch = jest.fn(async () => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => bytes })); return G.fetch as jest.Mock; };
// jsdom has no object URLs. Each one made is remembered with its blob, so a test can see what CanvasKit was pointed at.
const blobs = new Map<string, Blob>();
const U = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
const mount = async (ui: React.ReactElement) => { await act(async () => { root.render(ui); }); await act(async () => { await Promise.resolve(); }); };
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  blobs.clear();
  U.createObjectURL = jest.fn((b: Blob) => { const u = `blob:test/${blobs.size + 1}`; blobs.set(u, b); return u; });
  U.revokeObjectURL = jest.fn((u: string) => { blobs.delete(u); });
});
beforeEach(() => { loader.resetSkiaWebForTests(); mockLoadSkiaWeb.mockClear(); mockSkia.capsuleThrows = false; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); delete G.fetch; jest.restoreAllMocks(); });

test('CanvasKit not loaded: the capsule is the tap one; it opens on one press, only once the commit is back, and only once', async () => {
  const onCrack = jest.fn();
  await mount(<ScratchCapsule tier="holo" interactive={false} onCrack={onCrack} />);
  expect(q('skia-capsule')).toBeNull();
  await act(async () => { q('tap-capsule')!.click(); });
  expect(onCrack).not.toHaveBeenCalled(); // the commit has not returned: nothing to reveal yet
  await mount(<ScratchCapsule tier="holo" interactive onCrack={onCrack} />);
  await act(async () => { q('tap-capsule')!.click(); q('tap-capsule')!.click(); });
  expect(onCrack).toHaveBeenCalledTimes(1);
});

test('a dispensed capsule is scrolled to the middle of the window, up and down only: a short browser window leaves it under the rail (W0.3)', async () => {
  const calls: { id: string | null; opts: unknown }[] = [];
  (Element.prototype as unknown as { scrollIntoView: (o: unknown) => void }).scrollIntoView = function (this: Element, opts: unknown) { calls.push({ id: this.getAttribute('data-testid'), opts }); }; // jsdom has none
  const rect = jest.spyOn(Element.prototype, 'getBoundingClientRect');
  const at = (left: number) => rect.mockReturnValue({ left, right: left + 2, top: 0, bottom: 0, width: 2, height: 0, x: left, y: 0, toJSON: () => ({}) });
  at(-600); // the stage is on another page of the track (its box is off screen to the left)
  await mount(<ScratchCapsule key="off" tier="holo" interactive onCrack={() => {}} />);
  expect(calls).toEqual([]); // `nearest` would have dragged the whole track over to it (PR #155's review ran it)
  at(window.innerWidth + 200); // a page off to the right (a pixel of sub-pixel rounding at the edge is forgiven; a page is not)
  await mount(<ScratchCapsule key="off-right" tier="holo" interactive onCrack={() => {}} />);
  expect(calls).toEqual([]);
  const wide = window.innerWidth; window.innerWidth = 402; // a phone: the stage's middle is past half the window, so the guard must measure against the whole of it
  at(200); // on screen
  await mount(<ScratchCapsule tier="holo" interactive onCrack={() => {}} />);
  expect(calls).toEqual([{ id: 'capsule-rest', opts: { block: 'center', inline: 'nearest', behavior: 'smooth' } }]); // once, on the still box
  await mount(<ScratchCapsule tier="holo" interactive={false} onCrack={() => {}} />); // a re-render is not a new capsule
  expect(calls).toHaveLength(1);
  window.innerWidth = wide;
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
});

test('inside the desktop cabinet "on screen" is the three-page track\'s own box: a neighbouring page is off the track while well inside a 1440 px window (W1.1)', async () => {
  const calls: (string | null)[] = [];
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: Element) { calls.push(this.getAttribute('data-testid')); };
  let restLeft = 0;
  const box = (left: number, width: number) => ({ left, right: left + width, top: 0, bottom: 0, width, height: 0, x: left, y: 0, toJSON: () => ({}) });
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.getAttribute('data-testid') === 'home-pager' ? box(569, 303) : box(restLeft, 2); // the track as measured at 1440×900, scale 0.776
  });
  const wide = window.innerWidth; window.innerWidth = 1440;
  const inTrack = (key: string) => <div data-testid="home-pager"><ScratchCapsule key={key} tier="holo" interactive onCrack={() => {}} /></div>;
  restLeft = 1022; // the Pull page's box while the track is parked on Albums: inside the window, a page off the track
  await mount(inTrack('parked-on-albums'));
  expect(calls).toEqual([]); // scrolling to it would turn the page under the player
  restLeft = 266; // the page to the left of the track
  await mount(inTrack('parked-on-wallet'));
  expect(calls).toEqual([]);
  restLeft = 719; // on the track
  await mount(inTrack('on-pull'));
  expect(calls).toEqual(['capsule-rest']);
  window.innerWidth = wide;
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
});

test('the loader: a wasm that cannot be fetched is "no Skia", quietly — it never reaches CanvasKit, never rejects, and is not retried', async () => {
  const fetched = wasm(false);
  await expect(loader.loadSkiaWeb()).resolves.toBe(false);
  expect(loader.skiaWebState()).toBe('failed');
  expect(mockLoadSkiaWeb).not.toHaveBeenCalled(); // CanvasKit's own runtime aborts with an unhandled rejection when IT cannot fetch the file
  await loader.loadSkiaWeb();
  expect(fetched).toHaveBeenCalledTimes(1);
});

test('the loader: one fetch of /canvaskit.wasm; CanvasKit is pointed at those bytes (its only option is locateFile), and they are let go after', async () => {
  const fetched = wasm(true);
  let pointedAt: { url: string; blob?: Blob } | null = null;
  mockLoadSkiaWeb.mockImplementationOnce(async (o) => { // what CanvasKit does with its options: ask locateFile where the wasm is, then fetch that
    const url = (o as { locateFile: (f: string) => string }).locateFile('canvaskit.wasm');
    pointedAt = { url, blob: blobs.get(url) };
  });
  const first = loader.loadSkiaWeb(); const second = loader.loadSkiaWeb();
  expect(loader.skiaWebState()).toBe('loading');
  await expect(first).resolves.toBe(true); await expect(second).resolves.toBe(true);
  expect(fetched).toHaveBeenCalledTimes(1);
  expect(fetched).toHaveBeenCalledWith('/canvaskit.wasm'); // absolute: CanvasKit's own default is relative to the page
  expect(Object.keys(mockLoadSkiaWeb.mock.calls[0][0] as object)).toEqual(['locateFile']); // canvaskit-wasm 0.41 reads nothing else
  expect(pointedAt!.url).toMatch(/^blob:/);
  expect(pointedAt!.blob!.size).toBe(8); expect(pointedAt!.blob!.type).toBe('application/wasm'); // instantiateStreaming insists on the type
  expect(blobs.size).toBe(0); // revoked: the 8 MB is not held for the life of the page
  expect(loader.skiaWebState()).toBe('ready');
});

test('the loader: a 200 that is not WebAssembly (a captive portal, an error page) never reaches CanvasKit, whose runtime would abort the page on it', async () => {
  wasm(true, Uint8Array.from('<!doctype html><title>Sign in to Wi-Fi</title>', (c) => c.charCodeAt(0)).buffer); // jsdom has no TextEncoder
  await expect(loader.loadSkiaWeb()).resolves.toBe(false);
  expect(mockLoadSkiaWeb).not.toHaveBeenCalled();
  expect(loader.skiaWebState()).toBe('failed');
  loader.resetSkiaWebForTests();
  wasm(true, new ArrayBuffer(3)); // and a body too short to hold the header is "no Skia" too, not a rejection
  await expect(loader.loadSkiaWeb()).resolves.toBe(false);
});

test('the loader: CanvasKit failing to start is "no Skia" too, and the bytes are still let go', async () => {
  wasm(true);
  mockLoadSkiaWeb.mockImplementationOnce(async () => { throw new Error('Aborted(CompileError)'); });
  await expect(loader.loadSkiaWeb()).resolves.toBe(false);
  expect(loader.skiaWebState()).toBe('failed');
  expect(blobs.size).toBe(0);
});

test('CanvasKit ready when the capsule mounts: the Skia capsule, and space or enter on it opens it (the scratch itself is a pointer drag)', async () => {
  wasm(true); await loader.loadSkiaWeb();
  const onCrack = jest.fn();
  await mount(<ScratchCapsule tier="holo" interactive onCrack={onCrack} />);
  expect(q('tap-capsule')).toBeNull();
  const cap = q('skia-capsule')!;
  await act(async () => { cap.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
  expect(onCrack).not.toHaveBeenCalled();
  await act(async () => { cap.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true })); });
  expect(onCrack).not.toHaveBeenCalled(); // a held key is not a press (plan §7.18)
  await act(async () => { cap.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
  expect(onCrack).toHaveBeenCalledTimes(1);
  await act(async () => { cap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(onCrack).toHaveBeenCalledTimes(1); // once, like the tap capsule
});

test('space on a capsule whose commit has not returned opens nothing: there is no outcome to reveal yet', async () => {
  wasm(true); await loader.loadSkiaWeb();
  const onCrack = jest.fn();
  await mount(<ScratchCapsule tier={null} interactive={false} onCrack={onCrack} />);
  await act(async () => { q('skia-capsule')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); q('skia-capsule')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(onCrack).not.toHaveBeenCalled();
});

test('the choice is made once, at mount: CanvasKit arriving mid-capsule does not swap it (the drop would restart)', async () => {
  wasm(true);
  await mount(<ScratchCapsule tier="holo" interactive onCrack={() => {}} />);
  expect(q('tap-capsule')).not.toBeNull();
  await act(async () => { await loader.loadSkiaWeb(); });
  await mount(<ScratchCapsule tier="holo" interactive onCrack={() => {}} />);
  expect(q('tap-capsule')).not.toBeNull(); expect(q('skia-capsule')).toBeNull();
});

test('a Skia capsule that throws while rendering falls back to the tap capsule, not to a blank page: a paid pull sits behind it', async () => {
  wasm(true); await loader.loadSkiaWeb();
  mockSkia.capsuleThrows = true;
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
  const onCrack = jest.fn();
  await mount(<ScratchCapsule tier="holo" interactive onCrack={onCrack} />);
  expect(q('tap-capsule')).not.toBeNull();
  await act(async () => { q('tap-capsule')!.click(); });
  expect(onCrack).toHaveBeenCalledTimes(1);
  quiet.mockRestore();
});

test('the foil: nothing until CanvasKit is ready, nothing for a tier with no foil, the shader after', async () => {
  await mount(<Foil width={200} height={280} intensity={0.9} />);
  expect(q('skia-foil')).toBeNull();
  wasm(true); await loader.loadSkiaWeb();
  await act(async () => { root.unmount(); }); root = createRoot(host);
  await mount(<Foil width={200} height={280} intensity={0} />);
  expect(q('skia-foil')).toBeNull();
  await act(async () => { root.unmount(); }); root = createRoot(host);
  await mount(<Foil width={200} height={280} intensity={0.9} />);
  expect(q('skia-foil')).not.toBeNull();
});

// W3.5 (#142): the Pull page starts the load when the browser is idle, not at mount, so the machine is up before 3.2 MB arrive.
test('the loader, when idle: nothing is fetched until the browser is idle, and then the one load starts (timeout IDLE_START_MS)', async () => {
  const fetched = wasm(true);
  const W = globalThis as unknown as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
  const idle: { cb: (() => void) | null; opts: unknown } = { cb: null, opts: null };
  W.requestIdleCallback = jest.fn((cb: () => void, opts: unknown) => { idle.cb = cb; idle.opts = opts; return 7; });
  W.cancelIdleCallback = jest.fn();
  try {
    loader.loadSkiaWebWhenIdle();
    expect(fetched).not.toHaveBeenCalled();
    expect(loader.skiaWebState()).toBe('idle');
    expect(idle.opts).toEqual({ timeout: loader.IDLE_START_MS });
    await act(async () => { idle.cb!(); await Promise.resolve(); });
    expect(fetched).toHaveBeenCalledTimes(1);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(loader.skiaWebState()).toBe('ready');
    // A later page (a remount) joins the load: nothing scheduled, nothing fetched again.
    (W.requestIdleCallback as jest.Mock).mockClear();
    loader.loadSkiaWebWhenIdle();
    expect(W.requestIdleCallback).not.toHaveBeenCalled();
    expect(fetched).toHaveBeenCalledTimes(1);
  } finally { delete W.requestIdleCallback; delete W.cancelIdleCallback; }
});

test('the loader, when idle: a page that goes away first cancels it, and nothing is ever fetched', async () => {
  const fetched = wasm(true);
  const W = globalThis as unknown as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
  W.requestIdleCallback = jest.fn(() => 7);
  W.cancelIdleCallback = jest.fn();
  try {
    const cancel = loader.loadSkiaWebWhenIdle();
    cancel();
    expect(W.cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(fetched).not.toHaveBeenCalled();
    expect(loader.skiaWebState()).toBe('idle');
  } finally { delete W.requestIdleCallback; delete W.cancelIdleCallback; }
});

test('the loader, when idle, in a browser without requestIdleCallback (Safari): it starts IDLE_START_MS later, and not before', async () => {
  jest.useFakeTimers();
  try {
    const fetched = wasm(true);
    expect((globalThis as { requestIdleCallback?: unknown }).requestIdleCallback).toBeUndefined(); // jsdom has none, as Safari
    const cancel = loader.loadSkiaWebWhenIdle();
    await act(async () => { await jest.advanceTimersByTimeAsync(loader.IDLE_START_MS - 1); });
    expect(fetched).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(fetched).toHaveBeenCalledTimes(1);
    cancel(); // too late to matter, and harmless
    loader.resetSkiaWebForTests();
    const cancelled = loader.loadSkiaWebWhenIdle();
    cancelled();
    await act(async () => { await jest.advanceTimersByTimeAsync(loader.IDLE_START_MS * 2); });
    expect(fetched).toHaveBeenCalledTimes(1); // the cancelled one never fetched
  } finally { jest.useRealTimers(); }
});
