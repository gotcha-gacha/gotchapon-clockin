// batchAnimationFrames: one fake timer per frame, and every callback at the fake millisecond, with the timestamp, that the
// unbatched fake clock gives it. The parity test runs one script both ways and compares what ran when; the order changes
// only against other timers due on a frame's millisecond, which the differences test pins.
import { afterEach, expect, jest, test } from '@jest/globals';
import { batchAnimationFrames } from '../batchAnimationFrames';

afterEach(() => { jest.useRealTimers(); });

type Log = string[];
/** Requests on and off the frame grid, from timers and from frame callbacks, with cancels before and inside a frame. */
function script(log: Log) {
  const t0 = jest.now();
  const at = () => jest.now() - t0;
  const frame = (name: string, then?: () => void) => requestAnimationFrame((ts) => { log.push(`${name}@${at()} ts=${ts}`); then?.(); });
  let b = 0;
  setTimeout(() => { frame('D', () => { frame('F'); }); }, 16); // fires at 16 before that frame runs: D waits for 32
  frame('A', () => { frame('E'); cancelAnimationFrame(b); }); // A cancels B, later in its own frame
  setTimeout(() => { b = frame('B'); const c = frame('C'); cancelAnimationFrame(c); }, 5);
  setTimeout(() => { const g = frame('G'); const h = frame('H'); cancelAnimationFrame(g); cancelAnimationFrame(h); frame('I'); }, 40);
  setTimeout(() => { frame('J'); }, 37);
  setTimeout(() => { const k = frame('K'); cancelAnimationFrame(k); frame('L'); }, 70); // a frame emptied before it runs, then asked for again
  jest.advanceTimersByTime(120);
}

test('batched, every callback runs at the same fake millisecond, with the same timestamp, in the same order', () => {
  jest.useFakeTimers();
  const plain: Log = []; script(plain);
  jest.useRealTimers();
  jest.useFakeTimers(); batchAnimationFrames();
  const batched: Log = []; script(batched);
  expect(batched).toEqual(plain);
  expect(plain).toEqual(['A@16 ts=16', 'D@32 ts=32', 'E@32 ts=32', 'F@48 ts=48', 'J@48 ts=48', 'I@48 ts=48', 'L@80 ts=80']); // the script did run
});

test('after jest.clearAllTimers() or jest.setSystemTime(), a request still runs where the unbatched clock runs it', () => {
  // PR #173's second review: a frame's timer copied at the frame's first request went stale when the clock deleted or moved it.
  const scripts: Record<string, () => string[]> = {
    clearAllTimers: () => { // rewinds the clock to its start and deletes every timer
      const log: string[] = []; const t0 = jest.now();
      jest.advanceTimersByTime(5); requestAnimationFrame(() => log.push('cleared'));
      jest.clearAllTimers();
      requestAnimationFrame(() => log.push(`X@${jest.now() - t0}`));
      jest.advanceTimersByTime(40);
      return log;
    },
    setSystemTimeBack: () => {
      const log: string[] = []; const t0 = jest.now();
      requestAnimationFrame(() => log.push(`A@${jest.now() - t0}`));
      jest.advanceTimersByTime(20);
      jest.setSystemTime(jest.now() - 20);
      requestAnimationFrame(() => log.push(`X@${jest.now() - t0}`));
      jest.advanceTimersByTime(40);
      return log;
    },
    setSystemTimeForward: () => { // moves the pending frame's timer 8 ms on
      const log: string[] = []; const t0 = jest.now();
      jest.advanceTimersByTime(5); requestAnimationFrame(() => log.push(`F@${jest.now() - t0}`));
      jest.setSystemTime(jest.now() + 8);
      requestAnimationFrame(() => log.push(`X@${jest.now() - t0}`));
      jest.advanceTimersByTime(40);
      return log;
    },
  };
  const plain: Record<string, string[]> = {}; const batched: Record<string, string[]> = {};
  for (const [name, script] of Object.entries(scripts)) { // each on a fresh clock, both ways
    jest.useFakeTimers(); plain[name] = script(); jest.useRealTimers();
    jest.useFakeTimers(); batchAnimationFrames(); batched[name] = script(); jest.useRealTimers();
  }
  expect(batched).toEqual(plain);
  expect(plain).toEqual({ clearAllTimers: ['X@16'], setSystemTimeBack: ['A@16', 'X@16'], setSystemTimeForward: ['X@16', 'F@24'] }); // the scripts did run
});

test('one timer per frame, however many callbacks it has, and none once they are all cancelled', () => {
  jest.useFakeTimers();
  for (let i = 0; i < 13; i++) requestAnimationFrame(() => {});
  expect(jest.getTimerCount()).toBe(13);
  jest.useRealTimers();
  jest.useFakeTimers(); batchAnimationFrames();
  const ids = Array.from({ length: 13 }, () => requestAnimationFrame(() => {}));
  expect(jest.getTimerCount()).toBe(1);
  for (const id of ids) cancelAnimationFrame(id);
  expect(jest.getTimerCount()).toBe(0);
});

test('the differences, all about a timer due on a frame\'s millisecond: it no longer runs between two of the frame\'s callbacks (a browser\'s order), so a cancel it makes can come too late', () => {
  const between = () => {
    const log: string[] = [];
    jest.advanceTimersByTime(3); requestAnimationFrame(() => log.push('A'));
    jest.advanceTimersByTime(2); setTimeout(() => log.push('timer'), 11); // due at 16, like the frame
    jest.advanceTimersByTime(3); requestAnimationFrame(() => log.push('B'));
    jest.advanceTimersByTime(8);
    return log;
  };
  const lateCancel = () => { // PR #173's review
    const log: string[] = [];
    let c = 0;
    jest.advanceTimersByTime(3); requestAnimationFrame(() => log.push('A'));
    jest.advanceTimersByTime(2); setTimeout(() => { log.push('timer cancels C'); cancelAnimationFrame(c); }, 11);
    jest.advanceTimersByTime(3); c = requestAnimationFrame(() => { log.push('C'); requestAnimationFrame(() => log.push('D')); });
    jest.advanceTimersByTime(24);
    return log;
  };
  jest.useFakeTimers();
  expect([between(), lateCancel()]).toEqual([['A', 'timer', 'B'], ['A', 'timer cancels C']]);
  jest.useRealTimers();
  jest.useFakeTimers(); batchAnimationFrames();
  expect([between(), lateCancel()]).toEqual([['A', 'B', 'timer'], ['A', 'C', 'timer cancels C', 'D']]);
});

test('ids count on across installs: a handle kept from an earlier install cancels nothing in a later one', () => {
  jest.useFakeTimers(); batchAnimationFrames();
  const kept = requestAnimationFrame(() => {});
  jest.useRealTimers();
  jest.useFakeTimers(); batchAnimationFrames();
  const ran: string[] = [];
  requestAnimationFrame(() => ran.push('new'));
  cancelAnimationFrame(kept);
  jest.advanceTimersByTime(16);
  expect(ran).toEqual(['new']);
});

test('a callback that throws does not stop the rest of its frame, and the error still reaches the test', () => {
  jest.useFakeTimers(); batchAnimationFrames();
  const ran: string[] = [];
  requestAnimationFrame(() => { ran.push('X'); throw new Error('boom'); });
  requestAnimationFrame(() => { ran.push('Y'); });
  expect(() => jest.advanceTimersByTime(16)).toThrow('boom');
  expect(ran).toEqual(['X', 'Y']);
});

test('a second call under the same fake clock refuses rather than batching the batch', () => {
  jest.useFakeTimers(); batchAnimationFrames();
  expect(() => batchAnimationFrames()).toThrow('after jest.useFakeTimers()');
});

test('jest.useRealTimers() puts the originals back, as it does unbatched; without a fake clock it refuses', () => {
  const g = globalThis as unknown as { requestAnimationFrame: unknown; cancelAnimationFrame: unknown };
  const jsdom = { request: g.requestAnimationFrame, cancel: g.cancelAnimationFrame };
  // Own properties of the global, as react-native-worklets installs its jest requestAnimationFrame: a global that is deleted
  // instead of restored would otherwise fall through to jsdom's copy on the window's prototype and look restored.
  const original = { request: () => 0, cancel: () => {} };
  try {
    g.requestAnimationFrame = original.request; g.cancelAnimationFrame = original.cancel;
    jest.useFakeTimers(); batchAnimationFrames();
    jest.useRealTimers();
    expect([g.requestAnimationFrame, g.cancelAnimationFrame]).toEqual([original.request, original.cancel]);
    expect(() => batchAnimationFrames()).toThrow('after jest.useFakeTimers()');
  } finally { g.requestAnimationFrame = jsdom.request; g.cancelAnimationFrame = jsdom.cancel; }
});
