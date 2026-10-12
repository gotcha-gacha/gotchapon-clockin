// Sign-in through Privy (F7.4, #6), used only when an app id is in the environment. Apple, Google and email are wired.
// Session signers / `addSigners` are NOT called here: an empty policy list grants full permission, and signing for money
// waits on Dev 2's treasury (#101, #186). After Privy authenticates, `/me` still decides who the user is to this app.
//
// **Apple is the same call as Google** (Ben, 22 Sept: the dashboard is configured now). `useLoginWithOAuth` picks the flow
// itself, read off the installed SDK: on iOS with `provider: 'apple'` it calls `expo-apple-authentication`'s `signInAsync`
// for the native sheet, asking for EMAIL and FULL_NAME; everywhere else, including Android, it runs the same browser flow
// Google uses. So there is no Apple-shaped branch here, and the only thing the app owes Apple is that the package is
// installed — without it the SDK throws `configuration_error` saying exactly that, which arrives as a normal sign-in error
// rather than a crash. On Android that browser flow is refused by Apple (the mobile client's Apple id is the bundle id), so
// Android answers `appleReady: false` and its sheet offers Google and email only (11 Oct 2026).
//
// Most of what follows survived two review rounds and a mutation matrix on PR #114; the reasoning is kept with the code
// because every line of it was a bug first. What changed since: the age gate is gone (#116), and `wallet_created` no longer
// carries the address (#143) — the vendor learns who the user is through `identify`, by the API's id, not by their wallet.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useEmbeddedSolanaWallet, useLinkWithSiws, useLoginWithEmail, useLoginWithOAuth, usePrivy, type User } from '@privy-io/expo';
import { api, setAccessTokenProvider } from '@/api';
import { toApiError, type ApiError } from '@/api/errors';
import { identify, resetIdentity, track } from '@/analytics';
import { AuthCtx, type Auth, type AuthStage, type Provider, type SocialProvider } from '@/auth/context';
import { loginWalletOf, providerFromUser, solanaAddressFromUser } from '@/auth/user';
import { signEmbeddedSolanaTransaction, type NativeEmbeddedSolanaWallet } from '@/auth/nativeSolanaSigner';
import { bytesToBase64 } from '@/auth/solanaWallets';
import { readSettings, updateSettings } from '@/state/settings';

const SIGN_IN_MS = 900;
const WALLET_MS = 1200;
const BUSY_MS = SIGN_IN_MS + WALLET_MS;
/** Wall-clock cap on the cold-start blank frame. Whatever Privy, the network or `/me` do, the app reaches a screen by then. */
const HYDRATE_CAP_MS = 8000;
/** The shorter cap on Privy's own start-up, which is local work (secure storage, app config), not a network round trip.
 *  Until `isReady`, nobody knows whether there is a session to restore at all, so the app waits — but a first-ever launch
 *  has nothing to restore and should not pay the 8 s network cap to find that out (review). It releases the same one-way
 *  latch, so a session that turns up later still lands and the screen never goes back to blank. */
const INIT_CAP_MS = 2500;
/** Privy's own cancel code, read off the installed SDK. Matching a code is a contract; matching error prose is not. */
const CANCELLED = /cancelled_by_user/;
const isCancel = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CANCELLED.test(code);
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Wallets = NativeEmbeddedSolanaWallet[] | undefined;
/** The SDK's moving parts, read at call time. See the ref in the provider for why none of this is a dependency. */
type Sdk = React.RefObject<{
  user: User | null | undefined;
  logout: () => Promise<void>;
  refreshUser: () => Promise<{ user: User }>;
  wallets: Wallets;
  create: (() => Promise<unknown>) | undefined;
}>;

const addressIn = (wallets: Wallets) => wallets?.[0]?.address ?? null;

/** The user's embedded Solana address: from the user document, then the hook, and only then by creating one — and which of
 *  those it was, because `wallet_created` is an event about creating a wallet and firing it on every cold start told the
 *  dashboard a wallet was made every time an existing user opened the app (review). An external SIWS login wallet is not
 *  a funds wallet (#245): this creates the embedded one for that binder too. */
async function solanaAddress(user: User | null | undefined, sdk: Sdk): Promise<{ address: string | null; created: boolean; user: User | null | undefined }> {
  const existing = solanaAddressFromUser(user);
  if (existing) return { address: existing, created: false, user };
  const externalLogin = loginWalletOf(user);
  if (!externalLogin) {
    const fromHook = addressIn(sdk.current.wallets);
    if (fromHook) return { address: fromHook, created: false, user };
  }
  const create = sdk.current.create;
  if (!create) return { address: null, created: false, user };
  let made = false;
  try {
    await create();
    made = true;
  } catch {
    made = false;
  }
  const refreshed = await sdk.current.refreshUser().catch(() => null);
  // Re-read the wallets FROM THE REF. `useEmbeddedSolanaWallet` builds a new array when the user changes and never mutates
  // the old one, so the array captured before `create()` can never learn about the wallet it just made: that fallback was
  // dead code, and a `refreshUser()` that answered stale then failed a creation which had actually worked (review). This
  // still depends on a render having landed in between, which is why the user document is asked first.
  // A SIWS login does not adopt the hook's address: that would be the connected wallet, not the deposit wallet.
  const next = refreshed?.user ?? sdk.current.user ?? user;
  const hookFallback = externalLogin ? null : addressIn(sdk.current.wallets);
  const address = solanaAddressFromUser(next) ?? hookFallback;
  return { address, created: made && !!address, user: next };
}

export function PrivyAuthProvider({ children }: { children: React.ReactNode }) {
  const { isReady, user, logout, getAccessToken, refreshUser } = usePrivy();
  const { login: loginOAuth } = useLoginWithOAuth();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const solana = useEmbeddedSolanaWallet();
  const siwsLink = useLinkWithSiws();

  const [stage, setStage] = useState<AuthStage>('idle');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [step, setStep] = useState('');
  const [wallet, setWallet] = useState<string | null>(null);
  const [loginWallet, setLoginWallet] = useState<{ name: string; address: string } | null>(null);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  // `hydrated` latches once the cold-start restore has settled ANY way (landed, failed, or there was nothing to restore);
  // `capped` latches on the wall clock. Both are one-way, so `ready` below goes false at most once and always reaches true.
  const [hydrated, setHydrated] = useState(false);
  const [capped, setCapped] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gen = useRef(0);
  const landedId = useRef<string | null>(null);
  const signingOut = useRef(false);

  // Everything the SDK hands back whose identity changes between renders, in one ref that the callbacks below read at call
  // time. **This is load-bearing, not tidiness.** `usePrivy` returns `refreshUser: () => client.user.refreshUser()` — a
  // fresh arrow on EVERY render (read off the installed SDK) — and `useEmbeddedSolanaWallet` rebuilds `wallets` through a
  // `useMemo` on the user. A `useCallback` listing them changed identity every render, so the restore effect that listed
  // that callback re-ran every render; and because its failure handler writes state, a restore that fails restarts itself
  // forever. Measured, offline, before this ref: 53,000 `/me` calls and 53,000 `logout()`s in 15 seconds, still climbing.
  // `user` is not one of these — it comes from a store selector and is stable until it really changes — but it is kept
  // here anyway so an async handler can ask what Privy holds NOW rather than what it held when the closure was made.
  const sdk = useRef({ user, logout, refreshUser, wallets: solana.wallets, create: solana.create, siwsLink });
  useEffect(() => { sdk.current = { user, logout, refreshUser, wallets: solana.wallets, create: solana.create, siwsLink }; });

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    gen.current += 1; // drop an in-flight login if the tree unmounts
  }, []);

  // The caps. The write lands inside the timeout, never in the effect body, so this does not trip react-hooks/set-state-in-effect.
  useEffect(() => {
    const t = setTimeout(() => setCapped(true), HYDRATE_CAP_MS);
    return () => clearTimeout(t);
  }, []);

  // Privy's own start-up, on the shorter fuse. It writes the SAME one-way latch rather than a second flag, and that is the
  // whole design: a separate term would go true at 2.5 s and then false again the moment Privy answered WITH a session to
  // restore, blanking a screen the user was already looking at. `capped` only ever goes up, so the app cannot un-draw.
  // The timer is cancelled the moment Privy is ready, so an app that starts normally never touches it.
  useEffect(() => {
    if (isReady) return;
    const t = setTimeout(() => setCapped(true), INIT_CAP_MS);
    return () => clearTimeout(t);
  }, [isReady]);

  useEffect(() => {
    setAccessTokenProvider(() => getAccessToken());
    return () => setAccessTokenProvider(async () => null);
  }, [getAccessToken]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const land = useCallback(async (p: Provider, signedIn: User | null | undefined, mine: number) => {
    const found = await solanaAddress(signedIn, sdk);
    if (!found.address) throw new Error('We could not create a wallet. Try again.');
    if (mine !== gen.current) return null;
    const me = await api.me();
    if (mine !== gen.current) return null;
    if (signedIn?.id) landedId.current = signedIn.id;
    const login = p === 'wallet' ? loginWalletOf(found.user ?? signedIn) : null;
    return { p, address: found.address, id: me.id, created: found.created, login };
  }, []);

  const apply = useCallback((landed: { p: Provider; address: string; id: string; created: boolean; login: { name: string; address: string } | null }) => {
    // A fresh sign-in never reaches the restore effect's settle handlers (it sets `landedId` first, so the effect
    // early-returns), so landing is the other place `hydrated` has to latch.
    setHydrated(true);
    if (landed.created) track('wallet_created', {}); // only a wallet that was made here; a cold start is not a creation
    identify(landed.id);
    setProvider(landed.p);
    setWallet(landed.address);
    setLoginWallet(landed.login);
    setStage(readSettings().onboarded ? 'done' : 'onboarding');
    setStep('');
  }, []);

  // Restore a Privy session after a cold start. Skipped while a live sign-in owns the flow, and after sign-out until Privy's
  // user is actually cleared (logout is async).
  useEffect(() => {
    if (!isReady || !user || signingOut.current) return;
    if (landedId.current === user.id) return;
    if (stage !== 'idle') { landedId.current = user.id; return; } // signIn already owns this session
    landedId.current = user.id;
    const mine = ++gen.current;
    const p = providerFromUser(user) ?? 'email';
    land(p, user, mine).then(
      // No latch here: `apply` does it, and a null `landed` means a newer generation owns the flow and latches on its own.
      (landed) => { if (landed && mine === gen.current) apply(landed); },
      (e) => {
        setHydrated(true); // before the generation guard: a superseded restore must still un-blank the app
        if (mine !== gen.current) return;
        landedId.current = null;
        void sdk.current.logout().catch(() => {});
        setError(toApiError(e));
        setStage('idle');
        setStep('');
      },
    );
    // `land` and `apply` are stable (no dependencies) and the SDK is reached through the ref, so this effect runs when
    // Privy's own state changes and at no other time. Listing anything the SDK rebuilds per render is the loop above.
  }, [isReady, user, stage, land, apply]);

  const sendEmailCode = useCallback(async (email: string) => {
    setError(null);
    const address = email.trim();
    if (!address.includes('@')) {
      setError(toApiError(new Error('Enter your email.')));
      return false;
    }
    try {
      await sendCode({ email: address });
    } catch (e) {
      setError(toApiError(e));
      return false;
    }
    return true; // a code is on its way: the screen asks for it
  }, [sendCode]);

  const signIn = useCallback(async (p: SocialProvider, opts?: { email?: string; code?: string }) => {
    setError(null);
    track('signup', { provider: p });
    const mine = ++gen.current;
    const started = Date.now();
    setProvider(p);
    setStage('busy');
    setStep(`Signing in with ${p}…`);
    clearTimers();
    timers.current.push(setTimeout(() => { if (mine === gen.current) setStep('Creating your Solana wallet…'); }, SIGN_IN_MS));

    // Whether Privy actually authenticated before the throw. This, not the error's text, decides whether a live session is
    // left behind — which was the dangerous case a review found.
    let authenticated = false;
    try {
      const signedIn = p === 'email'
        ? await loginWithCode({ email: opts?.email?.trim() ?? '', code: opts?.code?.trim() ?? '' })
        : await loginOAuth({ provider: p === 'Apple' ? 'apple' : 'google' });
      authenticated = true;
      if (mine !== gen.current) return;
      if (signedIn?.id) landedId.current = signedIn.id;
      // Step 2 belongs to the timer above, not to this line. Setting it here as well meant a login that answered in under
      // 0.9 s skipped step 1 entirely — React batched both writes into one render, and the user only ever saw step 2. #6
      // asks for 0.9 s then 1.2 s, so the pacing has to be independent of how fast Privy answers.
      const landed = await land(p, signedIn, mine);
      if (mine !== gen.current || !landed) return;
      const wait = BUSY_MS - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      if (mine !== gen.current) return;
      apply(landed);
    } catch (e) {
      if (mine !== gen.current) return;
      setStage('idle');
      setStep('');
      if (!authenticated && isCancel(e)) {
        setProvider(null); // Privy signed nobody in and says the user backed out: no error card, no session left behind
        return;
      }
      // **Every other failure ends the session, whether or not this code saw one begin.** The provider asks Privy for a
      // Solana wallet at login (`createOnLogin: 'users-without-wallets'`), so Privy can authenticate and THEN fail creating
      // it — the promise rejects with `authenticated` still false while Privy's store already holds the user. That stranded
      // the session: the restore effect had pinned `landedId` to that id while the stage was busy, so it early-returned on
      // it forever and the app never adopted a session Privy was still holding (review).
      //
      // The SDK cannot be asked either, and that is the point: it fills its store DURING the call that then rejects, and
      // the render that would put it in the ref above has not necessarily committed by the time this line runs. So the
      // rule is the safe one — log out unless Privy itself said the user backed out (handled above, which returns). Asking
      // Privy to end a session it never began is harmless; leaving one the app cannot see is not.
      landedId.current = null;
      void sdk.current.logout().catch(() => {});
      setError(toApiError(e));
    } finally {
      if (mine === gen.current) clearTimers();
    }
  }, [apply, land, loginOAuth, loginWithCode]);

  const signOut = useCallback(() => {
    gen.current += 1;
    signingOut.current = true;
    landedId.current = null;
    clearTimers();
    setStage('idle');
    setProvider(null);
    setStep('');
    setWallet(null);
    setLoginWallet(null);
    setOnboardingIndex(0);
    setError(null);
    resetIdentity();
    // `.catch` before `.finally`: `void p.finally()` attaches no rejection handler, so a logout that rejects escaped as an
    // unhandled rejection.
    void logout().catch(() => {}).finally(() => { signingOut.current = false; });
  }, [logout]);

  const finishOnboarding = useCallback(() => { updateSettings({ onboarded: true }); setStage('done'); }, []);

  const signSolanaTransaction = useCallback(async (transactionBase64: string) => {
    // Sign with the embedded funds/deposit wallet. For SIWS users the external wallet is only the
    // login identity, so select by the address the app landed rather than taking an arbitrary wallet.
    const wallets = sdk.current.wallets ?? [];
    const selected = wallet ? wallets.find((candidate) => candidate.address === wallet) : wallets[0];
    return signEmbeddedSolanaTransaction(selected, transactionBase64);
  }, [wallet]);

  // Link a wallet app's account (Mobile Wallet Adapter, Android) to this account, so the server builds deposits from it and
  // the faucet may send to it: both accept only a linked external Solana wallet (server `requireLinkedExternalSolanaWallet`).
  // The SIWS message names the public site; the wallet app signs it, Privy checks it.
  const linkWalletApp = useCallback(async (address: string, signMessage: (message: Uint8Array) => Promise<Uint8Array>) => {
    const linked = sdk.current.user?.linked_accounts.some((account) => account.type === 'wallet'
      && 'chain_type' in account && account.chain_type === 'solana' && account.address === address);
    if (linked) return;
    const { generateMessage, link } = sdk.current.siwsLink;
    const { message } = await generateMessage({ wallet: { address }, from: { domain: 'gotchapon.fun', uri: 'https://gotchapon.fun' } });
    const signature = await signMessage(new TextEncoder().encode(message));
    await link({
      message,
      signature: bytesToBase64(signature),
      wallet: { walletClientType: 'mobile_wallet_adapter', connectorType: 'mobile_wallet_adapter' },
    });
    await sdk.current.refreshUser().catch(() => null);
  }, []);

  // The app waits only while a COLD-START restore is genuinely in flight, which is `stage === 'idle'` and nothing else. The
  // other stages are the app's own flow — busy is the two-step sign-in, onboarding and done are screens — and blanking any
  // of them is the bug this guard exists to prevent. An earlier `capped || (isReady && (!user || hydrated))` read as bounded
  // and was, but Privy puts the user on the client the moment it authenticates, so `ready` went true → false at the start of
  // every sign-in and the whole busy sequence rendered as nothing until the 8 s cap.
  const ready = capped || (isReady && (!user || hydrated || stage !== 'idle'));

  const value = useMemo<Auth>(() => ({
    ready,
    stage, provider, step, wallet, loginWallet, onboardingIndex, error,
    // Apple is the same call as Google here. The web answers `appleReady` in `privyWebChunk.tsx` (a Services ID, §3c). Not on
    // Android (11 Oct 2026): the browser flow there carries the mobile client's Apple client id, the iOS bundle id, which Apple
    // rejects as a web client. The sheet draws no Apple button on Android at all.
    appleReady: Platform.OS !== 'android',
    signIn, sendEmailCode, signOut,
    signSolanaTransaction,
    // Export stays unset. `exportWallet` is the browser React SDK's modal (#352). The phone does not
    // reveal a key and does not call Privy's REST export.
    depositFromConnectedWallet: null,
    linkWalletApp,
    nextSheet: () => { if (onboardingIndex >= 2) finishOnboarding(); else setOnboardingIndex((i) => i + 1); },
    skipOnboarding: finishOnboarding,
  }), [ready, stage, provider, step, wallet, loginWallet, onboardingIndex, error, signIn, sendEmailCode, signOut, signSolanaTransaction, linkWalletApp, finishOnboarding]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
