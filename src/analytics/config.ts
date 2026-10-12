// PostHog's public project key and host, by env only (CLAUDE.md "Deployment"; #143). Read when asked, not at import: an
// `EXPO_PUBLIC_*` value is inlined at build time wherever it is read, and a test can set one before calling. The default
// host lives with each SDK's install (`posthog.ts`, `posthogChunk.web.ts`), not here: this file is in the web's first
// paint and the budget (`scripts/bundle-budget.mjs`) finds the web SDK by that host string.
export const posthogKey = () => process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
/** An ingestion host other than the default US cloud: the EU cloud, or a reverse proxy. Empty means the default. */
export const posthogHostOverride = () => process.env.EXPO_PUBLIC_POSTHOG_HOST || '';
