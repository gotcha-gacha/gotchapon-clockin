// PostHog in a browser (#143): `posthog-js`, in its own chunk. It is about 100 KB gzipped, five times the entry chunk's
// headroom (`scripts/bundle-budget.mjs`), and nothing about analytics is needed for the first paint: the seam buffers what
// happens until the chunk is in. One `import()` for the library AND its configuration (`posthogChunk.web.ts`), so neither
// lands in what the page loads first (CLAUDE.md: two imports that share code put it in `__common`; the budget checks the
// marker stays out of the eager scripts). With no key the chunk is never asked for. A chunk that fails to load (a blip, an
// old tab after a deploy) is simply not there: the buffer fills to its cap and the app runs on.
import { posthogKey } from './config';

let asked = false;

export function installAnalytics(): void {
  if (!posthogKey() || asked) return;
  asked = true;
  void import('./posthogChunk').then((m) => m.install()).catch(() => { asked = false; });
}

/** For tests. */
export function uninstallAnalyticsForTests() { asked = false; }
