// PostHog on a phone (#143): nothing without a key; with one, the client is built once with error tracking on and replay
// off, and the seam's events, identity and errors reach it.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { captureError, identify, resetAnalyticsForTests, resetIdentity, track } from '@/analytics';
import { installAnalytics, uninstallAnalyticsForTests } from '@/analytics/posthog';

const mockCalls = { ctor: [] as unknown[][], capture: jest.fn(), identify: jest.fn(), reset: jest.fn(), captureException: jest.fn(), register: jest.fn(async () => undefined) };
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: class PostHog {
    constructor(...args: unknown[]) { mockCalls.ctor.push(args); }
    capture = mockCalls.capture; identify = mockCalls.identify; reset = mockCalls.reset; captureException = mockCalls.captureException; register = mockCalls.register;
  },
}));
jest.mock('@/api', () => ({ usingMock: true }));

// The same `process.env` object, mutated: the preset's env plugin reads through a reference it took at load, so a test
// that swapped the object for a copy would set values nothing reads (`html.web.test.tsx` does the same).
beforeEach(() => { delete process.env.EXPO_PUBLIC_POSTHOG_KEY; delete process.env.EXPO_PUBLIC_POSTHOG_HOST; mockCalls.ctor.length = 0; jest.clearAllMocks(); });
afterEach(() => { delete process.env.EXPO_PUBLIC_POSTHOG_KEY; delete process.env.EXPO_PUBLIC_POSTHOG_HOST; resetAnalyticsForTests(); uninstallAnalyticsForTests(); });

test('no key in the environment: no client, and the seam keeps buffering', () => {
  installAnalytics();
  expect(mockCalls.ctor).toEqual([]);
  track('odds_viewed', {});
  expect(mockCalls.capture).not.toHaveBeenCalled();
});

test('with a key: one client, the default US host, lifecycle events and error autocapture on, replay off; events, identity and errors forwarded', () => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  track('session_start', { usingMock: true }); // before the vendor: buffered, replayed on install
  installAnalytics(); installAnalytics(); // twice is once
  expect(mockCalls.ctor).toHaveLength(1);
  const [key, opts] = mockCalls.ctor[0] as [string, Record<string, unknown>];
  expect(key).toBe('phc_test');
  expect(opts.host).toBe('https://us.i.posthog.com');
  expect(opts.captureAppLifecycleEvents).toBe(true);
  expect(opts.enableSessionReplay).toBe(false);
  expect(opts.errorTracking).toEqual({ autocapture: { uncaughtExceptions: true, unhandledRejections: true, console: false, nativeCrashes: false } });
  expect(mockCalls.register).toHaveBeenCalledWith({ demo: true });
  expect(mockCalls.capture).toHaveBeenCalledWith('session_start', expect.objectContaining({ usingMock: true, at: expect.any(String) }), expect.anything());
  // The buffered event carries the time it HAPPENED as the SDK's own `timestamp`, not the moment this sink installed.
  const [, first, capOpts] = mockCalls.capture.mock.calls[0] as [string, { at: string }, { timestamp?: Date }];
  expect(capOpts.timestamp?.toISOString()).toBe(first.at);
  track('pull_revealed', { rarity: 'holo', isDupe: false, source: 'crank', count: 1 });
  expect(mockCalls.capture).toHaveBeenLastCalledWith('pull_revealed', expect.objectContaining({ rarity: 'holo', source: 'crank' }), expect.anything());
  identify('user_9');
  expect(mockCalls.identify).toHaveBeenCalledWith('user_9');
  const boom = new Error('boom');
  captureError(boom);
  expect(mockCalls.captureException).toHaveBeenCalledWith(boom);
  resetIdentity();
  expect(mockCalls.reset).toHaveBeenCalledTimes(1);
});

test('the host follows the environment', () => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  process.env.EXPO_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com';
  installAnalytics();
  expect((mockCalls.ctor[0] as [string, Record<string, unknown>])[1].host).toBe('https://eu.i.posthog.com');
});
