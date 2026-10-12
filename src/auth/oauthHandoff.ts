// Native has no OAuth return in the address bar. The web module (`oauthHandoff.web.ts`) is the one `entrypoint.js` loads
// before the router; this file exists so that import resolves on iOS and Android.
export function captureOAuthHandoff(): void {}
export function restoreOAuthParamsForPrivy(): void {}
export function consumeOAuthHandoff(): void {}
export function resetOAuthHandoffForTests(): void {}
export function peekOAuthHandoff(): null { return null; }
