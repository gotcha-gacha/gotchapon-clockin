// The crank's keyboard turn, at the crank itself (W1.2, #124): what `autoCrank()` refuses. The pulls it makes, and what a
// refused press costs (nothing), are keyboard.web.test.tsx's, against the real page.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act as reactAct, createRef, useEffect, useState } from 'react';
import { act, render } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { AUTO_TURN_MS, Crank, type CrankHandle } from '../Crank';

// The shake sensor, stood in for: the crank subscribes while it is enabled, and the test is the phone being shaken.
const shake: { feed: ((g: { x: number; y: number; z: number }) => void) | null } = { feed: null };
jest.mock('@/sensors/motion', () => ({ primeMotion: jest.fn(), watchShake: (cb: (g: { x: number; y: number; z: number }) => void) => { shake.feed = cb; return { remove: () => { shake.feed = null; } }; } }));

const spies = { onStart: jest.fn(), onRelease: jest.fn(), onActive: jest.fn(), onAbandon: jest.fn() };
/** The knob's progress, 0..1, as the crank publishes it (read after the UI-thread work has run). */
const knob: { travel: { get: () => number } | null } = { travel: null };
function Host({ handle, enabled, multi = 1 }: { handle: React.Ref<CrankHandle>; enabled: boolean; multi?: 1 | 5 | 10 }) {
  const travel = useSharedValue(0);
  useEffect(() => { knob.travel = travel; });
  return <Crank ref={handle} enabled={enabled} multi={multi} armed={enabled} travel={travel} {...spies} />;
}
beforeEach(() => { jest.useFakeTimers(); for (const s of Object.values(spies)) s.mockClear(); });
afterEach(() => { jest.useRealTimers(); });

test('one call is one turn: the start now, the release when 650 ms are up and not before, and a second call inside it is refused', async () => {
  const handle = createRef<CrankHandle>();
  await render(<Host handle={handle} enabled />);
  let first = false, second = true;
  await act(async () => { first = handle.current!.autoCrank(); second = handle.current!.autoCrank(); });
  expect([first, second]).toEqual([true, false]);
  expect(spies.onStart).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS - 40); });
  expect(spies.onRelease).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(80); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect([spies.onStart.mock.calls.length, spies.onRelease.mock.calls.length]).toEqual([1, 1]); // and nothing keeps turning
  let again = false;
  await act(async () => { again = handle.current!.autoCrank(); }); // the turn is over: the next press is a new turn, not refused for good
  expect([again, spies.onStart.mock.calls.length]).toEqual([true, 2]);
  expect(AUTO_TURN_MS).toBe(650); // plan §7.17: every wait above is written in the constant, so this is what pins the number
});

test('a crank that is off (no funds, restocking, locked, another page) refuses, and starts nothing', async () => {
  const handle = createRef<CrankHandle>();
  await render(<Host handle={handle} enabled={false} />);
  let turned = true;
  await act(async () => { turned = handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS + 200); });
  expect(turned).toBe(false);
  expect([spies.onStart.mock.calls.length, spies.onRelease.mock.calls.length]).toEqual([0, 0]);
});

// PR #158's review, defect 1. A release that lands on an idle machine (the prepare failed or was repriced inside the turn: AC-5b)
// leaves the crank on, and the knob sits at 360° for 280 ms before it springs back. The next turn used to start from there, so
// its first 16 ms step crossed 360° and released: a real pull ~100 ms into its "650 ms" turn.
test('a turn straight after a wasted one starts from zero: it releases at the end of its own 650 ms, not on its first step', async () => {
  const handle = createRef<CrankHandle>();
  await render(<Host handle={handle} enabled />);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS + 20); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1); // turn 1, on a machine that stays enabled: nothing reset the knob
  for (const gap of [10, 300, 450]) { // inside the 280 ms hold, and partway down the 320 ms spring back
    spies.onRelease.mockClear();
    await act(async () => { jest.advanceTimersByTime(gap); });
    let turned = false;
    await act(async () => { turned = handle.current!.autoCrank(); });
    expect(turned).toBe(true);
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(spies.onRelease).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS - 140); });
    expect(spies.onRelease).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(80); });
    expect(spies.onRelease).toHaveBeenCalledTimes(1);
  }
});

// Defect 2. The ×N chips come back the moment a prepare fails, while the knob is still turning. The turn used to be fed as
// deltas geared for the multi it started with: a change to ×5 in mid-turn shrank every later delta, the knob stopped at 0.68
// of a turn, and the release never came: the pull prepared at the start sat armed for good.
type Multi = 1 | 5 | 10;
test.each<[Multi, Multi]>([[1, 5], [1, 10], [10, 1]])('a change of multi in mid-turn (×%i → ×%i) changes nothing: one release, at the end', async (from, to) => {
  const handle = createRef<CrankHandle>();
  const view = await render(<Host handle={handle} enabled multi={from} />);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(200); });
  await view.rerender(<Host handle={handle} enabled multi={to} />);
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS - 240); });
  expect(spies.onRelease).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(80); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

// The machine goes off in mid-turn (the page changed, a takeover came up): the turn stops with it and releases nothing, the
// pager is handed back exactly once, and when the machine is back the next press is a whole new turn.
test('the machine going off in mid-turn stops the turn: no release, the pager handed back once, and the next press works', async () => {
  const handle = createRef<CrankHandle>();
  const view = await render(<Host handle={handle} enabled />);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(300); });
  await view.rerender(<Host handle={handle} enabled={false} />);
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS + 500); });
  expect(spies.onRelease).not.toHaveBeenCalled();
  expect(spies.onActive.mock.calls.map((c) => c[0])).toEqual([true, false]);
  await view.rerender(<Host handle={handle} enabled />);
  let turned = false;
  await act(async () => { turned = handle.current!.autoCrank(); });
  expect(turned).toBe(true);
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS - 40); });
  expect(spies.onRelease).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(80); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

// PR #158's second review. The latch reopened over a knob still held at the last turn's 360° is a release waiting for any delta,
// and the shake listener is subscribed the whole time: one motion sample just over the threshold (a phone merely held reads
// 9.8 of the 10), landing between the press and the turn's first step, released the pull 8 ms into its 650.
test('a motion sample between the press and the turn\'s first step releases nothing: the new turn starts from zero, not from the last one\'s 360°', async () => {
  const handle = createRef<CrankHandle>();
  await render(<Host handle={handle} enabled />);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS + 20); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1); // turn 1, wasted: the machine stays enabled and the knob is held at 360°
  // The control: with no new turn in flight the same sample is refused by the latch. So what follows is the new turn's doing.
  await act(async () => { shake.feed!({ x: 10.05, y: 0, z: 0 }); jest.advanceTimersByTime(8); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(52); });
  spies.onRelease.mockClear();
  await act(async () => { handle.current!.autoCrank(); }); // turn 2, 80 ms after turn 1 ended
  await act(async () => { jest.advanceTimersByTime(4); shake.feed!({ x: 10.05, y: 0, z: 0 }); jest.advanceTimersByTime(8); });
  expect(spies.onRelease).not.toHaveBeenCalled(); // 12 ms in: not released by a tremor
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS - 60); });
  expect(spies.onRelease).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1); // its own, at the end
});

// One turn, one release, whoever finishes it. A hard shake in the middle of the keyboard's turn takes the knob past 360° and
// releases; the keyboard's turn, still running, must not release again when its own 650 ms are up.
test('a shake that finishes the turn first is the only release: the keyboard\'s turn adds no second one', async () => {
  const handle = createRef<CrankHandle>();
  await render(<Host handle={handle} enabled />);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(200); });
  expect(spies.onRelease).not.toHaveBeenCalled();
  await act(async () => { shake.feed!({ x: 110, y: 0, z: 0 }); jest.advanceTimersByTime(10); }); // (110 − 10) × 0.12 rad × 0.8: more than a whole turn in one sample (handed to the UI thread: a tick away)
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS + 500); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

// While the keyboard turns the knob the hand's pan is off: a finger landing in mid-turn would add its own travel, and lifting
// it would abandon the key's pull. Read from the gesture's own config, which is what gesture-handler acts on.
test('the pan is off for the length of a keyboard turn, and back on after it', async () => {
  const handle = createRef<CrankHandle>();
  await render(<Host handle={handle} enabled />);
  const panOn = () => (getByGestureTestId('crank-pan') as unknown as { config: { enabled?: boolean } }).config.enabled;
  expect(panOn()).toBe(true);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(panOn()).toBe(false);
  await act(async () => { jest.advanceTimersByTime(AUTO_TURN_MS); });
  expect(panOn()).toBe(true);
});

// Not here: "a press with a finger on the crank is refused" (`hand`). gesture-handler's jest utilities run a whole gesture per
// call (onBegin to onFinalize), so a finger cannot be held down across an `autoCrank()` call. The guard was walked instead
// (PR #158): with the pan off for the length of a keyboard turn, a press that got past it would abandon its own pull at once.
// (They DO fire onBegin: the hand tests below use them. An earlier comment here said they did not; PR #166's review.)

// #163 (PR #158's third review). A keyboard placement is queued for the UI thread every 16 ms; one already on its way when
// the machine goes off used to land after the spring-back had begun, park the knob at 0.985 of a turn and leave the latch
// open, and when the machine came back a phone merely held (10.05) released a pull. The cancel now runs in the same queue,
// after that placement, and closes the latch.
test('a placement already queued when the machine goes off parks nothing: when it is back, held-phone samples release no pull', async () => {
  const handle = createRef<CrankHandle>();
  const view = await render(<Host handle={handle} enabled />);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(16 * 40 - 1); }); // 39 steps (16 ms apart) and their placements
  expect(knob.travel!.get()).toBeCloseTo(0.96, 2); // the window is really recreated: 624 / 650 of a turn
  await act(async () => { jest.advanceTimersToNextTimer(); }); // step 40 runs and queues its placement (0.985 of a turn), not yet placed
  expect(knob.travel!.get()).toBeCloseTo(0.96, 2);
  await view.rerender(<Host handle={handle} enabled={false} />); // the machine goes off right then
  await act(async () => { jest.advanceTimersByTime(1000); }); // UNDER FAKE TIMERS the cancel lands first here (a timer created outside a timer callback fires 1 ms earlier): this case guards the latch; the next one runs the production order
  expect(spies.onRelease).not.toHaveBeenCalled();
  expect(knob.travel!.get()).toBe(0); // not parked at 0.985
  expect(spies.onAbandon).toHaveBeenCalledTimes(1); // what a hand letting go sends: the prepared pull is given up
  await view.rerender(<Host handle={handle} enabled />);
  for (let i = 0; i < 60; i++) await act(async () => { shake.feed!({ x: 10.05, y: 0, z: 0 }); jest.advanceTimersByTime(18); }); // 20 would finish a parked turn
  expect(spies.onRelease).not.toHaveBeenCalled();
});

// ---- The hand, and the cancel in production order (PR #166's review) ----------------------------------------------------
/** A Host whose `enabled` the test flips from inside a timer, as a machine going off does in production. */
const ctl: { travel: { get: () => number } | null; setEnabled: ((b: boolean) => void) | null } = { travel: null, setEnabled: null };
function StatefulHost({ handle }: { handle: React.Ref<CrankHandle> }) {
  const travel = useSharedValue(0);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { ctl.travel = travel; ctl.setEnabled = setEnabled; }, [travel]);
  return <Crank ref={handle} enabled={enabled} multi={1} armed={enabled} travel={travel} {...spies} />;
}
/** A hand on the socket sweeping `sweep` degrees clockwise from twelve o'clock (the knob turns 0.8 of that). */
const pt = (deg: number) => ({ x: 44 + 30 * Math.sin((deg * Math.PI) / 180), y: 44 - 30 * Math.cos((deg * Math.PI) / 180) });
const hand = (sweep: number, from = 0) => {
  const n = Math.max(1, Math.round(sweep / 6)); const pts = Array.from({ length: n + 1 }, (_, i) => pt(from + (sweep * i) / n));
  fireGestureHandler(getByGestureTestId('crank-pan'), [{ state: State.BEGAN, ...pts[0] }, { state: State.ACTIVE, ...pts[0] }, ...pts.slice(1), { state: State.END }]);
};

// #161. A hand turn whose release lands on an idle machine (the machine stays on) leaves the knob held at 360°; the next touch
// used to reopen the latch over it, and its first movement released a pull.
test('#161: a 45° flick straight after a wasted hand release releases nothing; a whole turn after it releases once', async () => {
  await render(<StatefulHost handle={createRef()} />);
  await act(async () => { hand(480); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1); // the wasted one
  await act(async () => { hand(45); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1000); });
  await act(async () => { hand(480); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(2);
});

// Only after a release does a grab start from zero. A knob a shake has part-turned, or one springing back after a let-go, is
// carried on from where it is (the design's crankDown; zeroing every grab wiped a shake's progress: PR #166's review).
test('a hand that grabs a knob a shake has part-turned carries it on: the two together make one release', async () => {
  await render(<StatefulHost handle={createRef()} />);
  for (let i = 0; i < 4; i++) await act(async () => { shake.feed!({ x: 20, y: 0, z: 0 }); jest.advanceTimersByTime(10); }); // ≈ 0.61 of a turn
  expect(ctl.travel!.get()).toBeGreaterThan(0.55);
  expect(spies.onRelease).not.toHaveBeenCalled();
  await act(async () => { hand(220); jest.advanceTimersByTime(10); }); // ≈ 0.49 of a turn more: short of a turn on its own
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

test('a hand that re-grabs a knob springing back after a let-go carries it on from where it is', async () => {
  await render(<StatefulHost handle={createRef()} />);
  await act(async () => { hand(300); jest.advanceTimersByTime(150); }); // let go at ≈ 0.67: springing back, part-way home
  const left = ctl.travel!.get();
  expect(left).toBeGreaterThan(0.2);
  expect(left).toBeLessThan(0.67);
  await act(async () => { hand(((1 - left) * 360) / 0.8 + 12); jest.advanceTimersByTime(10); }); // just what that leaves, and a little
  expect(spies.onRelease).toHaveBeenCalledTimes(1); // carried on: from zero the same sweep would be short of a turn
});

// #163 in the order production runs it: the placement step 40 queued, THEN the cancel (runOnUI is FIFO on the web and on
// native). Under fake timers a timer created inside a timer callback fires 1 ms later, so the machine is switched off from
// inside one. This is the case that guards the cancel's spring-back: the placement has parked the knob at 0.985 when the
// cancel runs, and only the spring-back brings it home (without it the knob stayed parked and a held phone released a pull,
// in the browser too).
test('#163 in production order: the placement lands, then the cancel springs the knob home; a held phone then releases nothing', async () => {
  const handle = createRef<CrankHandle>();
  await render(<StatefulHost handle={handle} />);
  await act(async () => { handle.current!.autoCrank(); });
  await act(async () => { jest.advanceTimersByTime(16 * 40 - 1); });
  setTimeout(() => { reactAct(() => { ctl.setEnabled!(false); }); }, 1);
  jest.advanceTimersByTime(1);
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(ctl.travel!.get()).toBe(0);
  expect([spies.onRelease.mock.calls.length, spies.onAbandon.mock.calls.length]).toEqual([0, 1]);
  await act(async () => { ctl.setEnabled!(true); });
  for (let i = 0; i < 60; i++) await act(async () => { shake.feed!({ x: 10.05, y: 0, z: 0 }); jest.advanceTimersByTime(18); });
  expect(spies.onRelease).not.toHaveBeenCalled();
});

test('the machine going off with no keyboard turn running gives up nothing and leaves the latch alone', async () => {
  await render(<StatefulHost handle={createRef()} />);
  await act(async () => { ctl.setEnabled!(false); jest.advanceTimersByTime(500); });
  await act(async () => { ctl.setEnabled!(true); });
  expect(spies.onAbandon).not.toHaveBeenCalled();
  await act(async () => { hand(480); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

// ---- PR #166's second review: every way the latch reopens over a knob a release left at 360° -------------------------
// The hold is 280 ms at 360°, the ease back 320 ms: a flick anywhere in the ~600 ms after a wasted release, however the latch
// came to be open, must not release.
test.each([10, 300, 350])('#161 across the whole window: a flick %i ms after a wasted hand release releases nothing', async (ms) => {
  await render(<StatefulHost handle={createRef()} />);
  await act(async () => { hand(480); });
  await act(async () => { jest.advanceTimersByTime(ms); });
  await act(async () => { hand(45); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

test('the shake idle timer reopening the latch inside the hold does not leave a spent knob to a flick', async () => {
  await render(<StatefulHost handle={createRef()} />);
  await act(async () => { shake.feed!({ x: 10.05, y: 0, z: 0 }); jest.advanceTimersByTime(2300); }); // one light jolt
  await act(async () => { hand(480); jest.advanceTimersByTime(10); }); // a wasted release at ≈ 2310 ms
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(200); }); // the idle timer fires at ≈ 2500, inside the 280 ms hold
  await act(async () => { hand(45); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

test('held-phone samples right after the idle timer reopened the latch inside the hold release no second pull', async () => {
  const handle = createRef<CrankHandle>();
  await render(<StatefulHost handle={handle} />);
  await act(async () => { shake.feed!({ x: 10.05, y: 0, z: 0 }); jest.advanceTimersByTime(1660); }); // one light jolt at 0
  await act(async () => { handle.current!.autoCrank(); jest.advanceTimersByTime(AUTO_TURN_MS + 10); }); // a wasted release at ≈ 2316 (the last 16 ms step)
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(2510 - 2320); }); // the idle timer (2.5 s after the jolt) fires inside the 280 ms hold
  for (let i = 0; i < 40; i++) await act(async () => { shake.feed!({ x: 10.05, y: 0, z: 0 }); jest.advanceTimersByTime(18); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1); // the first of these met a knob still at 360° when the timer only reopened the latch
});

test('after a wasted release is re-grabbed from zero, a let-go part-turn is carried on again (the knob is no longer spent)', async () => {
  await render(<StatefulHost handle={createRef()} />);
  await act(async () => { hand(480); jest.advanceTimersByTime(10); }); // wasted
  await act(async () => { hand(300); jest.advanceTimersByTime(150); }); // re-grabbed: from zero, ≈ 0.67, let go, springing back
  const left = ctl.travel!.get();
  expect(left).toBeGreaterThan(0.2);
  await act(async () => { hand(((1 - left) * 360) / 0.8 + 12); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(2); // carried on from the part-turn, not zeroed again
});

test('the machine going off and straight back on after a release starts the new ritual at rest: a flick releases nothing', async () => {
  await render(<StatefulHost handle={createRef()} />);
  await act(async () => { hand(480); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
  await act(async () => { ctl.setEnabled!(false); jest.advanceTimersByTime(60); });
  await act(async () => { ctl.setEnabled!(true); });
  expect(ctl.travel!.get()).toBe(0);
  await act(async () => { hand(45); jest.advanceTimersByTime(10); });
  expect(spies.onRelease).toHaveBeenCalledTimes(1);
});

test('after a keyboard turn is cancelled the hand\u2019s pan is back on when the machine is', async () => {
  const handle = createRef<CrankHandle>();
  await render(<StatefulHost handle={handle} />);
  const panOn = () => (getByGestureTestId('crank-pan') as unknown as { config: { enabled?: boolean } }).config.enabled;
  await act(async () => { handle.current!.autoCrank(); jest.advanceTimersByTime(200); });
  expect(panOn()).toBe(false);
  await act(async () => { ctl.setEnabled!(false); jest.advanceTimersByTime(50); });
  await act(async () => { ctl.setEnabled!(true); });
  expect(panOn()).toBe(true);
});
