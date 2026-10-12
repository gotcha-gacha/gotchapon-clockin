// PostHog on a phone (#143): `posthog-react-native`, installed behind the analytics seam at boot. With no project key in the
// environment nothing is constructed and the seam's buffer simply fills to its cap: a development build with no key, a
// test, a demo. The browser resolves `posthog.web.ts` instead (posthog-js, fetched as its own chunk).
//
// What is on: app lifecycle events (installed / updated / opened / backgrounded) and error tracking's autocapture of
// uncaught exceptions and unhandled rejections (AC-2: a forced error arrives with a stack). What is off: session replay
// (never on, and it needs its own native module), console capture (a `console.error` is not an error), native crash
// capture (needs `@posthog/react-native-plugin`, not installed). Persistence is the SDK's default 'file', through
// expo-file-system, which is installed; the other optional peers (expo-application, expo-device, expo-localization) are
// not, so the app properties the SDK derives from them are simply absent.
import PostHog from 'posthog-react-native';
import { setAnalyticsSink } from './index';
import { posthogHostOverride, posthogKey } from './config';
import { usingMock } from '@/api';

const DEFAULT_HOST = 'https://us.i.posthog.com';

let client: PostHog | null = null;

export function installAnalytics(): void {
  const key = posthogKey();
  if (!key || client) return;
  try { build(key); } catch { client = null; } // the SDK constructs storage at `new PostHog`, and this runs in RootLayout's
  // own effect — above the ErrorBoundary, so a throw here would unmount the app rather than lose its analytics.
}

function build(key: string): void {
  client = new PostHog(key, {
    host: posthogHostOverride() || DEFAULT_HOST,
    captureAppLifecycleEvents: true,
    enableSessionReplay: false,
    errorTracking: { autocapture: { uncaughtExceptions: true, unhandledRejections: true, console: false, nativeCrashes: false } },
  });
  // Every event says whether it came from a demo build, so the dashboards can leave those out.
  void client.register({ demo: usingMock });
  const c = client;
  setAnalyticsSink({
    // `timestamp`, not just the `at` property: the buffer is replayed in one burst when this installs, and without it every
    // event from before then is stamped with the moment of the flush (PostHog reads `timestamp`, never a property).
    send: (e) => c.capture(e.name, { ...e.props, at: e.at }, { timestamp: when(e.at) }),
    identify: (id) => c.identify(id),
    reset: () => c.reset(),
    captureError: (err) => c.captureException(err),
  });
}

/** The seam's ISO stamp as a Date, or nothing at all rather than an Invalid Date the SDK would send as null. */
const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? undefined : d; };

/** For tests. */
export function uninstallAnalyticsForTests() { client = null; }
