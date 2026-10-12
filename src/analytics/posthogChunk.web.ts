// The PostHog web chunk (#143): posthog-js and the way it is configured, reached only through `posthog.web.ts`'s `import()`.
//
// Without cookies (#143's scope; Ben, 17 Sept): `persistence: 'memory'` sets no cookie and writes nothing to localStorage or
// sessionStorage (AC-3), so the first cut needs no consent banner; the cost is that an anonymous visitor is a new person on
// every page load, which is fine because the events that matter come after `identify`. Everything that would fetch another
// script or watch the DOM is off: session recording, surveys, heatmaps, dead clicks, rage clicks, web experiments,
// autocapture (react-native-web renders divs, and the app's own events are the ones worth having) and the SDK's page views
// (the URL is a projection of state, W2.1: a page change is already `pull`/`binder`/`wallet` in the app's events).
//
// **Uncaught errors are caught by two listeners of our own, not by the SDK's `capture_exceptions` (AC-2).** posthog-js does
// not ship those wrappers in its default build: it FETCHES `exception-autocapture.js` from the CDN when the option is on,
// which `disable_external_dependency_loading` then refuses — the two options cancel out and nothing uncaught is ever
// reported (measured in review: after `init`, `__PosthogExtensions__.errorWrappingFunctions` is undefined). The build that
// inlines the wrappers, `posthog-js/full/no-external`, also inlines session replay and surveys: 208 KB gzipped against 100 KB,
// 108 KB of code this config turns off, on a chunk every web visitor fetches. So the listeners are ours and they hand the
// error to the same seam the root ErrorBoundary uses.
import { posthog } from 'posthog-js';
import { captureError, setAnalyticsSink } from './index';
import { posthogHostOverride, posthogKey } from './config';
import { usingMock } from '@/api';

/** Also the marker `scripts/bundle-budget.mjs` finds this chunk by: keep it out of anything the page loads first. */
const DEFAULT_HOST = 'https://us.i.posthog.com';

export function install(): void {
  posthog.init(posthogKey(), {
    api_host: posthogHostOverride() || DEFAULT_HOST,
    persistence: 'memory',
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    capture_exceptions: false, // it cannot work without the CDN fetch below; the listeners at the end of install() are AC-2
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true, // no script from the CDN, ever: it is what a strict CSP needs and what AC-3 implies
    capture_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
    disable_web_experiments: true,
  });
  posthog.register({ demo: usingMock });
  setAnalyticsSink({
    // `timestamp`, not just the `at` property: everything the seam buffered before this chunk finished downloading is sent
    // in one burst, and without it PostHog stamps the whole opening of a web session with the moment the flush ran — which
    // is the moment the 100 KB chunk landed. Time-to-first-pull and session duration are read off these stamps.
    send: (e) => posthog.capture(e.name, { ...e.props, at: e.at }, { timestamp: when(e.at) }),
    identify: (id) => posthog.identify(id),
    reset: () => posthog.reset(),
    captureError: (err) => posthog.captureException(err),
  });
  if (!listening) { // once per page, whatever calls install(): two listeners would report every uncaught error twice
    listening = true;
    window.addEventListener('error', (ev) => report(ev.error ?? ev.message));
    window.addEventListener('unhandledrejection', (ev) => report(ev.reason));
  }
}

/** The seam's ISO stamp as a Date, or nothing at all rather than an Invalid Date the SDK would send as null. */
const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? undefined : d; };

let listening = false;

/** One uncaught error, on its way to the same place the ErrorBoundary's go.
 *
 *  A failure inside the sink is swallowed, and that is the whole point: the browser reports a throw from an event listener
 *  as another uncaught error, which arrives back here — reporting a broken reporter with the broken reporter is a loop that
 *  ends in the tab, not in PostHog. The `reporting` flag closes the synchronous half of the same door. Nothing about
 *  analytics may ever reach the user. */
let reporting = false;
function report(e: unknown) {
  if (reporting) return;
  reporting = true;
  try { captureError(e instanceof Error ? e : new Error(String(e))); } catch { /* see above */ } finally { reporting = false; }
}
