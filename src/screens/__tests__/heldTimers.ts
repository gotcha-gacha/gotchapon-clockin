// Holding a transient overlay's self-erase still, so a test can assert it without racing it.
//
// `PullPage` has two overlays that take themselves away 3.8 s after they appear — the share failure line (`sayShare`) and
// the deposit toast — and RNTL's budget for *finding* either is the 5 s `asyncUtilTimeout` from `jest.setup.ts`. The budget
// is larger than the window it waits on, so an assertion that starts more than 3.8 s after the overlay was set can never
// succeed: the remaining 1.2 s is spent polling for text that has already been cleared. That went red on 13 Sept at load
// ~100 in `share.test.tsx` (113 s against its 33 s standalone), and PRs #94 / #96 fixed it there.
//
// The fix is to take that one timer off the wall clock: `heldTimers(3800)` replaces `setTimeout`/`clearTimeout` so a timer
// armed for exactly that long is *held* — recorded, not scheduled — behind a handle `clearTimeout` still understands. Every
// other timer keeps the real clock, so animations, the ritual's timings and the tests' own waits are untouched.
//
// It is not a longer deadline for the same race; there is no deadline. And it does not soften what the timer is worth,
// which is the other half of why this exists: `pending()` reports what is armed *and for how long*, so a page that stops
// arming one or arms a different life fails on that rather than going quietly flaky; cancellation is honoured, so a timer
// the page cancelled does nothing when fired; and `fire()` runs what is due, which is how a test asserts the overlay
// expiring without sleeping past it. A wall-clock sleep can only ever show that *something* took the overlay away by the
// time it woke up.
//
// Deliberately opt-in per file rather than installed in `jest.setup.ts`: that file is loaded by all 50 suites, and a global
// hold would silently change any test that relies on a 3.8 s timer firing — starting with the two here that assert exactly
// that. Opting in at the top of a file also keeps the reason visible where the overlay is asserted.
//
// The cost of opting in is that it has to be remembered. One implementation stops the *implementation* drifting between
// files; it does not stop a third file forgetting to adopt it, and nothing in the gate will say so. The rule, for whoever
// writes that file: **a test that asserts any overlay which erases itself inside the 5 s `asyncUtilTimeout` should call
// `heldTimers(<its life>)` at its top level.** Today those are the deposit toast at `PullPage.tsx:72` and the share failure
// line at `:109`, both 3800 ms, and the Wallet's `Copied` flag at `WalletPage.tsx:67` at 1600 ms, the worst
// budget-to-window ratio of the three. All three are held where they are asserted: `pull.test.tsx`, `share.test.tsx` and
// `wallet.test.tsx`. Without the hold, an assertion that starts later than the overlay's life fails with `Unable to find
// an element with text`, and the gap that does it can be as ordinary as an `await` added above the assertion — for
// "Copied", measured, a bare 1.8 s one.
import { act } from '@testing-library/react-native';
import { afterEach, beforeEach } from '@jest/globals';

type Held = { ms: number; run: () => void; cleared: boolean; fired: boolean };

export type HeldTimers = {
  /** The timers the page has armed and not cancelled, with the life each was armed for. Keyed on the delay, so a file that
   *  triggers two overlays sharing one life sees both here — no test does today, and it would fail loudly on the length
   *  rather than pass quietly. */
  pending: () => { ms: number }[];
  /** Run every held timer that is due, as the wall clock would have `ms` after each was armed. */
  fire: () => Promise<void>;
  /** Assert `check` across the next `ms` — at the start and then every 250 ms, not only at the ends. Two samples are two
   *  instants: a state that goes wrong and comes right again strictly *between* them passes, which is exactly the shape of
   *  a clear that defers or an overlay that flickers back, so sampling the ends is not enough. Polling is what makes "it
   *  stays gone" mean most of what it says — the residual is that a flicker narrower than one 250 ms gap can still fall
   *  between samples, so this pins a window, not every instant in it. Measured: 250 ms cadence, gaps 225-254 ms. */
  holds: (ms: number, check: () => void) => Promise<void>;
};

/** Call once at the top level of a test file. Registers its own `beforeEach`/`afterEach`. */
export function heldTimers(ms: number): HeldTimers {
  let held: Held[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  beforeEach(() => {
    held = [];
    globalThis.setTimeout = ((run: () => void, delay?: number, ...rest: unknown[]) => {
      if (delay !== ms) return realSetTimeout(run, delay, ...rest);
      const one: Held = { ms: delay, run, cleared: false, fired: false };
      held.push(one);
      return one; // the page hands this straight back to `clearTimeout`, and nothing else ever looks at it
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((handle?: unknown) => {
      const one = held.find((h) => h === handle);
      if (one) { one.cleared = true; return; }
      realClearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]);
    }) as unknown as typeof globalThis.clearTimeout;
  });
  afterEach(() => { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; });

  const pending = () => held.filter((h) => !h.cleared && !h.fired);
  const settle = (wait: number) => act(async () => { await new Promise((done) => realSetTimeout(done, wait)); });
  return {
    pending: () => pending().map((h) => ({ ms: h.ms })),
    fire: () => act(async () => {
      for (const one of pending()) { one.fired = true; one.run(); }
      await new Promise((done) => realSetTimeout(done, 0));
    }),
    holds: async (window: number, check: () => void) => {
      const until = Date.now() + window;
      check();
      while (Date.now() < until) { await settle(Math.min(250, until - Date.now())); check(); }
    },
  };
}
