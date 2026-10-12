// The only static import of the Privy web chunk. `AuthProvider.web.tsx` calls it from an effect when the app id and the
// web client id are set, so the SDK stays out of the entry chunk (the same shape as `posthog.web.ts`). Tests replace
// this module.
export function loadPrivyWebChunk() {
  return import('./privyWebChunk');
}
