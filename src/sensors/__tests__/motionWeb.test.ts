// The web half of the sensor seam (W0.5, #135), driven through a stand-in `window`. It runs in the native jest project on
// purpose: motion.web.ts reaches the browser only through `globalThis.window`, so the file under test is the production one.
import { afterEach, expect, jest, test } from '@jest/globals';
import { primeMotion, resetMotionForTests, watchShake, watchTilt } from '../motion.web';

type Listener = (e: unknown) => void;
function fakeWindow(deviceMotionEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> }) {
  const listeners = new Map<string, Set<Listener>>();
  const w = {
    innerWidth: 1000, innerHeight: 500,
    DeviceMotionEvent: deviceMotionEvent,
    // Like the real thing, a listener is known by (type, callback, capture): removing with a different capture flag removes nothing.
    addEventListener: (type: string, fn: Listener, capture?: boolean) => { const k = `${type}|${!!capture}`; if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(fn); },
    removeEventListener: (type: string, fn: Listener, capture?: boolean) => { listeners.get(`${type}|${!!capture}`)?.delete(fn); },
  };
  (globalThis as unknown as { window?: unknown }).window = w;
  return {
    count: (type: string) => (listeners.get(`${type}|true`)?.size ?? 0) + (listeners.get(`${type}|false`)?.size ?? 0),
    fire: (type: string, e: unknown) => { [`${type}|true`, `${type}|false`].forEach((k) => [...(listeners.get(k) ?? [])].forEach((fn) => fn(e))); },
  };
}
const shakeEvent = (x: number | null, y: number | null, z: number | null) => ({ accelerationIncludingGravity: { x, y, z }, rotationRate: null });
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => { resetMotionForTests(); delete (globalThis as unknown as { window?: unknown }).window; });

test('a browser that asks nothing (Android Chrome, a desktop): samples flow as soon as someone listens, and stop when nobody does', () => {
  const w = fakeWindow({});
  const got: unknown[] = [];
  const sub = watchShake((g) => got.push(g));
  expect(w.count('devicemotion')).toBe(1);
  w.fire('devicemotion', shakeEvent(1, 2, 12));
  w.fire('devicemotion', shakeEvent(null, 2, 12)); // a sensor with a missing axis is not a sample
  w.fire('devicemotion', { accelerationIncludingGravity: null });
  expect(got).toEqual([{ x: 1, y: 2, z: 12 }]);
  sub.remove();
  expect(w.count('devicemotion')).toBe(0);
  w.fire('devicemotion', shakeEvent(1, 2, 12));
  expect(got).toHaveLength(1);
});

test('iOS Safari: nothing is asked at load; a touch on the crank only arms the question, and the release of that touch asks it', async () => {
  const stacks: string[] = [];
  let inRelease = false;
  const requestPermission = jest.fn(async () => { stacks.push(inRelease ? 'inside the release handler' : 'somewhere else'); return 'granted' as const; });
  const w = fakeWindow({ requestPermission });
  const got: unknown[] = [];
  watchShake((g) => got.push(g));
  expect(requestPermission).not.toHaveBeenCalled(); // never at load: the browser refuses the question outside a gesture
  expect(w.count('devicemotion')).toBe(0);
  primeMotion(); // what the crank does on touch-down. On the web it arrives in a microtask, off any handler's stack:
  await settle();
  expect(requestPermission).not.toHaveBeenCalled(); // …so it must not be what asks
  expect(w.count('pointerup')).toBe(1); expect(w.count('touchend')).toBe(1);
  inRelease = true; w.fire('pointerup', { type: 'pointerup' }); inRelease = false; // the browser's own handler: synchronous, on its stack
  expect(stacks).toEqual(['inside the release handler']);
  expect(w.count('pointerup')).toBe(0); expect(w.count('touchend')).toBe(0); // one shot, both listeners gone
  await settle();
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(w.count('devicemotion')).toBe(1);
  w.fire('devicemotion', shakeEvent(0, 0, 15));
  expect(got).toEqual([{ x: 0, y: 0, z: 15 }]);
});

test('iOS Safari: a refusal leaves the crank to the hand and is not asked again this session', async () => {
  const requestPermission = jest.fn(async () => 'denied' as const);
  const w = fakeWindow({ requestPermission });
  watchShake(() => {});
  primeMotion(); w.fire('touchend', {}); // touchend asks too: whichever release event the browser sends first
  await settle();
  primeMotion(); primeMotion(); w.fire('pointerup', {}); w.fire('touchend', {});
  await settle();
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(w.count('devicemotion')).toBe(0);
  expect(w.count('pointerup')).toBe(0); // a refusal is final: later touches arm nothing
});

test('a question the browser rejects for not being a gesture is not an answer: the next touch may ask, and nothing throws', async () => {
  let calls = 0;
  const requestPermission = jest.fn(() => { calls += 1; return calls === 1 ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve('granted' as const); });
  const w = fakeWindow({ requestPermission });
  watchShake(() => {});
  primeMotion(); w.fire('pointerup', {});
  await settle();
  expect(w.count('devicemotion')).toBe(0);
  primeMotion(); w.fire('pointerup', {});
  await settle();
  expect(requestPermission).toHaveBeenCalledTimes(2);
  expect(w.count('devicemotion')).toBe(1);
});

test('a requestPermission that throws on the spot, or hands back something that is no promise, takes nothing down and leaves the seam askable', async () => {
  const api: { requestPermission: () => Promise<'granted' | 'denied'> } = { requestPermission: () => { throw new Error('SecurityError'); } };
  const w = fakeWindow(api);
  watchShake(() => {});
  primeMotion();
  expect(() => w.fire('pointerup', {})).not.toThrow();
  api.requestPermission = (() => 'granted') as unknown as () => Promise<'granted'>; // an old WebKit answering synchronously
  primeMotion(); // the throw was not an answer, so this touch arms again
  expect(() => w.fire('pointerup', {})).not.toThrow();
  await settle();
  expect(w.count('devicemotion')).toBe(1);
});

test('two touches before the first is released, and a second release while the question is up: one question', async () => {
  let answer!: (a: 'granted') => void;
  const requestPermission = jest.fn(() => new Promise<'granted' | 'denied'>((r) => { answer = r; }));
  const w = fakeWindow({ requestPermission });
  watchShake(() => {});
  primeMotion(); primeMotion();
  expect(w.count('pointerup')).toBe(1); // armed once, not twice
  w.fire('pointerup', {});
  primeMotion(); w.fire('pointerup', {}); // the prompt is still up
  expect(requestPermission).toHaveBeenCalledTimes(1);
  answer('granted');
  await settle();
  expect(w.count('devicemotion')).toBe(1);
});

test('a browser with no DeviceMotionEvent, and no window at all (the server render): nothing listens and nothing throws', () => {
  const w = fakeWindow(undefined);
  const sub = watchShake(() => {});
  expect(() => primeMotion()).not.toThrow();
  expect(w.count('devicemotion')).toBe(0);
  sub.remove();
  resetMotionForTests();
  delete (globalThis as unknown as { window?: unknown }).window;
  expect(() => { const s = watchShake(() => {}); const t = watchTilt(() => {}); primeMotion(); s.remove(); t.remove(); }).not.toThrow();
});

test('the foil tilt: a phone reports rotation rate in deg/s and the filter is fed rad/s; a mouse stands in on a desktop, a finger does not', () => {
  const w = fakeWindow({});
  const got: { x: number; y: number }[] = [];
  const sub = watchTilt((t) => got.push(t));
  w.fire('devicemotion', { accelerationIncludingGravity: null, rotationRate: { alpha: 0, beta: 180, gamma: -90 } });
  expect(got[0].x).toBeCloseTo(Math.PI); expect(got[0].y).toBeCloseTo(-Math.PI / 2);
  w.fire('pointermove', { pointerType: 'mouse', clientX: 1000, clientY: 0 }); // top-right corner of a 1000 × 500 window
  expect(got[1]).toEqual({ x: -1, y: 1 });
  w.fire('pointermove', { pointerType: 'touch', clientX: 0, clientY: 0 });
  expect(got).toHaveLength(2);
  const second = watchTilt(() => {}); // two foils can be live at once: the reveal's card and a card detail sheet
  sub.remove();
  expect(w.count('pointermove')).toBe(1); // the first one leaving does not take the mouse away from the second
  expect(w.count('devicemotion')).toBe(1);
  second.remove();
  expect(w.count('pointermove')).toBe(0);
  expect(w.count('devicemotion')).toBe(0);
});

test('a touch the browser cancels (it became a scroll, a system gesture) disarms: the question does not land on a later, unrelated tap', async () => {
  const requestPermission = jest.fn(async () => 'granted' as const);
  const w = fakeWindow({ requestPermission });
  watchShake(() => {});
  primeMotion();
  w.fire('pointercancel', { type: 'pointercancel' });
  expect(['pointerup', 'touchend', 'pointercancel', 'touchcancel'].map((t) => w.count(t))).toEqual([0, 0, 0, 0]);
  w.fire('pointerup', { type: 'pointerup' }); // a tap somewhere else, later
  await settle();
  expect(requestPermission).not.toHaveBeenCalled();
  primeMotion(); w.fire('touchend', { type: 'touchend' }); // the next crank touch arms and asks as usual
  await settle();
  expect(requestPermission).toHaveBeenCalledTimes(1);
});
