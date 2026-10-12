/**
 * One fake timer per animation frame, the way a browser runs every frame callback in one rendering step.
 *
 * jest's fake clock (@sinonjs/fake-timers 10) gives every `requestAnimationFrame` call a timer of its own, and
 * `advanceTimersByTimeAsync` sleeps on a REAL `setTimeout` after each timer it fires (fake-timers-src.js, `doTick`). Every
 * running Reanimated animation asks for its own frame, so on the Pull page (the machine's lights, the ticker, the pile's
 * pulse, the globe's loop) about 13 timers, and 13 real sleeps of 1 ms or more, go by per 16 ms of fake time: 3,420 of
 * them in the 4 s a test spends signing in, 85% of its wall time. The sleeps stretch under load, and at a load average of 5
 * keyboard.web.test.tsx ran past jest's 15 s budget.
 *
 * Batched, a callback joins the frame fake-timers itself schedules it in (the `callAt` of the timer it would have had), so
 * it runs at the same fake millisecond, with the same timestamp, after the callbacks requested before it. A cancelled
 * callback does not run, including one cancelled by an earlier callback of its frame; one requested during a frame runs in
 * a later one; one that throws does not stop the rest, and the first error is rethrown after the frame, as fake-timers
 * rethrows a throwing timer's.
 * What changes is where a frame sits among the other timers due on its millisecond. Its callbacks run back to back as ONE
 * timer, at the place its first request took, so no other timer runs between two of them (as in a browser). A timer that
 * fake-timers would have run between two callbacks runs after the whole frame instead: it can find a callback
 * already run (a cancel it makes then comes too late), and what each requests is ordered accordingly in later frames. And
 * the microtasks one callback queues (`runOnJS`) run after the frame's last callback, where a browser runs them before the
 * next one. On keyboard.web.test.tsx's path no timer cancels a frame callback, and every mock call, phase and count lands
 * on the same fake millisecond batched or not (PR #173's review: a per-millisecond timeline of all 13 tests).
 *
 * Call it right after `jest.useFakeTimers()`. `jest.useRealTimers()` puts the originals back along with the fake clock's.
 */
type FakeClock = { now: number; timers?: Record<number, { callAt: number }> }; // `timers` appears with the first timer
type Frame = { at: number; handle: number; callbacks: Map<number, FrameRequestCallback> };
type Faked = { clock?: FakeClock; hadOwnProperty?: boolean };

let nextId = 1; // across installs: a handle kept from an earlier test never names a callback of a later one

export function batchAnimationFrames(): void {
  const g = globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame; cancelAnimationFrame: typeof cancelAnimationFrame };
  const request = g.requestAnimationFrame; const cancel = g.cancelAnimationFrame;
  const clock = (request as unknown as Faked | undefined)?.clock; // fake-timers hangs its clock on every function it fakes
  if (typeof clock?.now !== 'number') throw new Error('batchAnimationFrames: call it after jest.useFakeTimers(), which fakes requestAnimationFrame');

  let pending: Frame | null = null; // the latest frame asked for
  const frameOf = new Map<number, Frame>();

  const run = (frame: Frame, timestamp: number) => {
    let first: { error: unknown } | null = null;
    for (const [id, callback] of frame.callbacks) { // a callback cancelled by an earlier one is gone from the map, so skipped
      frame.callbacks.delete(id); frameOf.delete(id);
      try { callback(timestamp); } catch (error) { first ??= { error }; }
    }
    if (first) throw first.error;
  };

  const batched: typeof requestAnimationFrame = (callback) => {
    const frame: Frame = { at: 0, handle: 0, callbacks: new Map() };
    frame.handle = request((timestamp) => run(frame, timestamp));
    frame.at = clock.timers![frame.handle].callAt; // where fake-timers put this request
    // That frame is already asked for: join it. Its timer is read live, since jest.clearAllTimers() deletes it and
    // jest.setSystemTime() moves it (PR #173's second review: a stale copy dropped a callback, or ran it 8 ms late).
    if (pending && clock.timers![pending.handle]?.callAt === frame.at) cancel(frame.handle);
    else pending = frame;
    const id = nextId++;
    pending.callbacks.set(id, callback); frameOf.set(id, pending);
    return id;
  };
  const cancelBatched: typeof cancelAnimationFrame = (id) => {
    if (id == null) return; // the typings allow null / undefined; a browser ignores them
    const frame = frameOf.get(id);
    if (!frame) return;
    frame.callbacks.delete(id); frameOf.delete(id);
    // Nothing left to run: drop its timer too (a no-op once the frame has fired). A pending frame whose timer is gone is never
    // joined again, since the join reads the live timer and fake-timers never reuses an id.
    if (frame.callbacks.size === 0) cancel(frame.handle);
  };
  // fake-timers' uninstall puts the original back only over a function carrying its `hadOwnProperty` flag, and deletes the
  // global otherwise (fake-timers-src.js, `uninstall`): carry the fake's flag, as its own wrapper does. Not its clock, so a
  // second call under the same fake clock refuses rather than batching the batch.
  for (const [mine, theirs] of [[batched, request], [cancelBatched, cancel]] as const) {
    const { hadOwnProperty } = theirs as unknown as Faked;
    Object.assign(mine, { hadOwnProperty });
  }
  g.requestAnimationFrame = batched; g.cancelAnimationFrame = cancelBatched;
}
