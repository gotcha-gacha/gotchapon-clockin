// Sign-in without Privy (F7.4): the implementation that has carried the app since week 1, and still carries every build
// with no `EXPO_PUBLIC_PRIVY_APP_ID` — the in-app mock, demo deploys, TestFlight, and both jest projects.
//
// `signIn(provider)` runs the design's two-step busy state ("Signing in with X…" 0.9 s → "Creating your Solana wallet…"
// 1.2 s) and lands in onboarding the first time on this device (`settings.onboarded`; there is no age confirmation, #116).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setAccessTokenProvider, usingMock } from '@/api';
import { toApiError, type ApiError } from '@/api/errors';
import { identify, resetIdentity, track } from '@/analytics';
import { AuthCtx, type Auth, type AuthStage, type Provider, type SocialProvider } from '@/auth/context';
import { privyConfigured } from '@/auth/privy';
import { readSettings, updateSettings } from '@/state/settings';

/** What the mock sign-in hands the HTTP client when a development build talks to a real API: the local worker
 *  (`pnpm server:dev`, `AUTH_MODE=dev`) answers every request as `demo-user` (or the `x-dev-user` header) and never reads
 *  the token, but the client refuses to send a request without one — so before this, a development build pointed at the
 *  local worker could not sign in at all (found running Batch B's ritual, 25 Sept). Never in a release build (`__DEV__`
 *  false): there, no Privy ids means no one can sign in, and any deployed worker verifies a Privy token and refuses this. */
export const LOCAL_DEV_TOKEN = 'local-dev-auth';
// At import, not in an effect: the session loads in its own mount effect, and a child's effects run before its parent's, so
// a token installed by this provider's effect arrived after the first load had already failed as signed out (seen in the
// browser, 25 Sept). This module is imported by every AuthProvider, Privy or not, and Privy installs its own provider only on
// mount, after the session's first load: so a build with Privy configured never installs this at all (PR #257's review).
if (__DEV__ && !usingMock && !privyConfigured()) setAccessTokenProvider(async () => LOCAL_DEV_TOKEN);

export function MockAuthProvider({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<AuthStage>('idle');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [step, setStep] = useState('');
  const [wallet, setWallet] = useState<string | null>(null);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // `opts` is the email and code Privy needs; the mock has neither an inbox nor a code to check, so it ignores them.
  const signIn = useCallback(async (p: SocialProvider, _opts?: { email?: string; code?: string }) => {
    track('signup', { provider: p });
    setError(null);
    setProvider(p);
    setStage('busy');
    setStep(`Signing in with ${p}…`);
    timers.current.push(setTimeout(() => setStep('Creating your Solana wallet…'), 900));
    timers.current.push(setTimeout(() => {
      api.me().then(
        (me) => { track('wallet_created', {}); identify(me.id); setWallet(me.wallet); setStage(readSettings().onboarded ? 'done' : 'onboarding'); },
        (e) => { setError(toApiError(e)); setStage('idle'); setStep(''); }, // never park the user on the busy card
      );
    }, 2100));
  }, []);

  const signOut = useCallback(() => {
    timers.current.forEach(clearTimeout); timers.current = [];
    setStage('idle'); setProvider(null); setStep(''); setWallet(null); setOnboardingIndex(0);
    resetIdentity();
  }, []);

  /** The sheets are seen once per device: finishing or skipping them is remembered, signing out does not forget it. */
  const finishOnboarding = useCallback(() => { updateSettings({ onboarded: true }); setStage('done'); }, []);

  const value = useMemo<Auth>(() => ({
    ready: true, // nothing to restore: there is no session outside this process
    stage, provider, step, wallet, onboardingIndex, error,
    appleReady: true, // the mock has no dashboard to configure
    signIn,
    // No inbox to send to, so this IS the sign-in, and the screen is told not to ask for a code.
    sendEmailCode: async (email: string) => { await signIn('email', { email }); return false; },
    signSolanaTransaction: null,
    depositFromConnectedWallet: null,
    signOut,
    nextSheet: () => { if (onboardingIndex >= 2) finishOnboarding(); else setOnboardingIndex((i) => i + 1); },
    skipOnboarding: finishOnboarding,
  }), [stage, provider, step, wallet, onboardingIndex, error, signIn, signOut, finishOnboarding]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
