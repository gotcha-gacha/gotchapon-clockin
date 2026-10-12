// Per-test fixture reset. `jest.setup.ts` runs in `setupFiles`, before the test framework exists, so it
// cannot register hooks — this file runs in `setupFilesAfterEnv`, where it can.
//
// The Privy mock holds a mutable client (`state.user`), and a successful login now fills it as the real
// SDK does. Without a reset between tests the second test in a file inherits a signed-in client and
// renders the app instead of Sign In, which is a failure that looks like a bug in the test rather than
// leaked state (review round 2, finding 2).
import { beforeEach } from '@jest/globals';

beforeEach(() => {
  (globalThis as { __gachaponPrivy?: { reset?: () => void } }).__gachaponPrivy?.reset?.();
});
