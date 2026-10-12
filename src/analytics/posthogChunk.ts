// The web chunk's native twin, for the typechecker only: `tsc` resolves `posthog.web.ts`'s `import('./posthogChunk')` without
// platform extensions, while Metro picks `posthogChunk.web.ts` in a browser and never bundles this file on a phone
// (`posthog.ts`, the phone's, does not import it). Same shape as `skiaWeb.ts` beside `skiaWeb.web.ts`.
export function install(): void {}
