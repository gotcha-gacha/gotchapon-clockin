// Privy's OAuth return lands on the page as three query params. Two readers race that URL:
// the desktop QR (`PhoneCard` encodes `location.href` on its first render) and Privy's own hook, which reads the same
// params once `ready` and then deletes them with `history.replaceState({}, …)` — wiping `history.state`, which is where
// expo-router keeps its index. This module runs from `entrypoint.js` before the router, so the bar is clean before either.
//
// The params are stashed, not discarded: when Privy is `ready`, a layout effect puts them back for the SDK's effect to
// read, and a later effect strips them again while keeping `history.state`. The SDK's own strip still runs afterwards
// and still passes `{}`; that wipe is a follow-up, not something this module can stop from here.
import { OAUTH_PARAM_KEYS } from '@/auth/oauthParams';

export type OAuthHandoff = { code: string; state: string; provider: string };

let handoff: OAuthHandoff | 'consumed' | null = null;

function stripFromBar(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of OAUTH_PARAM_KEYS) {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
  }
  if (!changed) return;
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/** Stash a complete handoff and take every OAuth param off the bar. Idempotent once a stash exists: a later call does
 *  not strip, so the URL put back for Privy survives until `consumeOAuthHandoff`. */
export function captureOAuthHandoff(): void {
  if (typeof window === 'undefined' || handoff !== null) return;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('privy_oauth_code');
  const state = url.searchParams.get('privy_oauth_state');
  const provider = url.searchParams.get('privy_oauth_provider');
  if (code && state && provider) handoff = { code, state, provider };
  stripFromBar();
}

/** Put a stashed handoff back on the bar for Privy's hook. No-op once consumed, or when there was nothing to restore. */
export function restoreOAuthParamsForPrivy(): void {
  if (typeof window === 'undefined' || handoff === null || handoff === 'consumed') return;
  const url = new URL(window.location.href);
  url.searchParams.set('privy_oauth_code', handoff.code);
  url.searchParams.set('privy_oauth_state', handoff.state);
  url.searchParams.set('privy_oauth_provider', handoff.provider);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/** Take the params off the bar again and forget them. A later `captureOAuthHandoff` will not strip a second time. */
export function consumeOAuthHandoff(): void {
  if (handoff === null || handoff === 'consumed') return;
  stripFromBar();
  handoff = 'consumed';
}

export function resetOAuthHandoffForTests(): void { handoff = null; }

export function peekOAuthHandoff(): OAuthHandoff | 'consumed' | null { return handoff; }

captureOAuthHandoff();
