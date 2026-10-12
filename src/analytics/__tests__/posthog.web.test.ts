// PostHog in a browser (#143): the chunk is asked for only with a key, configured without cookies or storage
// (`persistence: 'memory'`), with every DOM-watching and script-loading feature off; the seam's events, identity and errors
// reach it once it is in, carrying the time they HAPPENED, and an uncaught error reaches it through the two listeners
// install() adds (the SDK's own `capture_exceptions` cannot work here: it fetches its wrappers from the CDN, which is off). That the real SDK then sets no cookie and writes nothing to
// localStorage (AC-3) is the SDK's own promise for 'memory' persistence, read in a browser, not something this mock can show.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { captureError, identify, resetAnalyticsForTests, track } from '@/analytics';
import { installAnalytics, uninstallAnalyticsForTests } from '@/analytics/posthog';

const mockPh = { init: jest.fn(), capture: jest.fn(), identify: jest.fn(), reset: jest.fn(), captureException: jest.fn(), register: jest.fn() };
jest.mock('posthog-js', () => ({ __esModule: true, default: mockPh, posthog: mockPh }));
jest.mock('@/api', () => ({ usingMock: false }));

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
// The same `process.env` object, mutated, never swapped for a copy (see posthog.test.ts).
beforeEach(() => { delete process.env.EXPO_PUBLIC_POSTHOG_KEY; delete process.env.EXPO_PUBLIC_POSTHOG_HOST; jest.clearAllMocks(); });
afterEach(() => { delete process.env.EXPO_PUBLIC_POSTHOG_KEY; delete process.env.EXPO_PUBLIC_POSTHOG_HOST; resetAnalyticsForTests(); uninstallAnalyticsForTests(); });

test('no key: the chunk is never asked for', async () => {
  installAnalytics();
  await flush();
  expect(mockPh.init).not.toHaveBeenCalled();
});

test('with a key: init without cookies or storage, nothing that watches the DOM or loads a script, exceptions on; then the seam is wired', async () => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_web';
  track('session_start', { usingMock: false }); // before the chunk: buffered
  identify('user_3');
  installAnalytics(); installAnalytics();
  await flush();
  expect(mockPh.init).toHaveBeenCalledTimes(1);
  const [key, opts] = mockPh.init.mock.calls[0] as [string, Record<string, unknown>];
  expect(key).toBe('phc_web');
  expect(opts).toEqual(expect.objectContaining({
    api_host: 'https://us.i.posthog.com',
    persistence: 'memory',
    person_profiles: 'identified_only',
    capture_pageview: false,
    autocapture: false,
    capture_exceptions: false, // the SDK's own is a CDN fetch this config refuses; the listeners below are what answers AC-2
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
  }));
  expect(mockPh.register).toHaveBeenCalledWith({ demo: false });
  expect(mockPh.capture).toHaveBeenCalledWith('session_start', expect.objectContaining({ usingMock: false }), expect.anything());
  expect(mockPh.identify).toHaveBeenCalledWith('user_3'); // signed in before the chunk arrived
  const boom = new Error('boom');
  captureError(boom);
  expect(mockPh.captureException).toHaveBeenCalledWith(boom);
});

test('a buffered event keeps the time it happened, not the time the chunk landed', async () => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_web';
  const before = new Date();
  track('session_start', { usingMock: false });
  installAnalytics();
  await flush();
  const [, props, opts] = mockPh.capture.mock.calls[0] as [string, Record<string, unknown>, { timestamp?: Date }];
  expect(opts.timestamp).toBeInstanceOf(Date);
  // The stamp is the seam's own `at`, taken when track() ran — never `new Date()` at the flush.
  expect(opts.timestamp?.toISOString()).toBe(props.at);
  expect(opts.timestamp!.getTime()).toBeGreaterThanOrEqual(before.getTime());
});

test('an uncaught error and an unhandled rejection reach PostHog (AC-2), and a sink that throws cannot loop', async () => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_web';
  installAnalytics();
  await flush();

  const boom = new Error('from a timer');
  window.dispatchEvent(new ErrorEvent('error', { error: boom, message: 'from a timer' }));
  expect(mockPh.captureException).toHaveBeenCalledWith(boom);

  // A rejection with a non-Error reason still arrives, as an Error, because that is what a stack can be read off.
  const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
  rejection.reason = 'just a string';
  window.dispatchEvent(rejection);
  expect((mockPh.captureException.mock.calls.at(-1) as [Error])[0].message).toBe('just a string');

  // A sink that throws: reported once, the failure swallowed (in a browser a throw out of a listener is itself an uncaught
  // error, which would arrive back here), and the guard does not latch — the next real error still gets through.
  mockPh.captureException.mockClear();
  mockPh.captureException.mockImplementationOnce(() => { throw new Error('the sink itself failed'); });
  expect(() => window.dispatchEvent(new ErrorEvent('error', { error: new Error('the one that broke the sink') }))).not.toThrow();
  expect(mockPh.captureException).toHaveBeenCalledTimes(1);
  const after = new Error('the next one');
  window.dispatchEvent(new ErrorEvent('error', { error: after }));
  expect(mockPh.captureException).toHaveBeenLastCalledWith(after);
});
