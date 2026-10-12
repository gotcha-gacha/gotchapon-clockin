// Sign-in through Privy in a browser (W5.1). The same `Auth` context as `privyAuth.tsx`; the hooks are `@privy-io/react-auth`'s,
// which are not the Expo SDK's. Reached only through `loadPrivyWeb.ts`'s `import()`, and only when the app id is set.
// A web app client is optional; when provided it is never the mobile client.
//
// What is different from the phone, read off `@privy-io/react-auth` 3.45:
// - `usePrivy().ready`, not `isReady`. `refreshUser` lives on `useUser` and resolves to the user, not `{ user }`.
// - `initOAuth({ provider })` resolves when the redirect starts and does not return the user. The return visit is the
//   SDK's own effect (`useLoginWithOAuth` reads `privy_oauth_*` once `ready`). A resolved call with no user is that
//   redirect: do not log out, or the return visit has nothing to restore.
// - Email is `loginWithCode({ code })` — the address was already sent with `sendCode`.
// - Cancel codes are `privyErrorCode` `exited_auth_flow` and `oauth_user_denied`.
// - Solana is `@privy-io/react-auth/solana`'s `useCreateWallet` / `useWallets` / `useExportWallet`, imported here
//   (one chunk). Export opens Privy's modal for the deposit address only (#352). Whitelabel
//   login does not run `createOnLogin`, so a missing wallet is created explicitly, as on the phone.
// - External Solana wallets are the same entry's `toSolanaWalletConnectors({ shouldAutoConnect: false })`, passed as
//   `externalWallets.solana.connectors` (#243). Row keys live in `solanaWallets.ts`. `shouldAutoConnect` defaults to
//   true in the SDK and can open an extension on load; false keeps a cold page quiet. Embedded `createOnLogin` for
//   Apple, Google, and email stays `users-without-wallets`. SIWS (`useLoginWithSiws`) then calls `createWallet` (#245):
//   an external wallet already on the user means `users-without-wallets` will not provision one, and the embedded
//   wallet is the deposit address. The connected wallet is only the login id. It is not linked onto an email binder.
//
// The OAuth params are restored in a layout effect and stripped in a later sibling's effect, same commit, only once
// `ready`. Paint sits between those, so the bar can flash the code for a frame; `PhoneCard` captured a filtered href
// before that and does not re-read on Privy becoming ready. See `oauthHandoff.web.ts`.
import './privyBuffer.web';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  PrivyProvider,
  useConnectWallet,
  useLoginWithEmail,
  useLoginWithOAuth,
  useLoginWithSiws,
  usePrivy,
  useUser,
  type PrivyClientConfig,
  type User,
  type WalletListEntry,
} from '@privy-io/react-auth';
import {
  toSolanaWalletConnectors,
  useCreateWallet,
  useExportWallet,
  useSignTransaction,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from '@privy-io/react-auth/solana';
import { api, setAccessTokenProvider } from '@/api';
import { toApiError, type ApiError } from '@/api/errors';
import { depositAsExpected } from '@/api/paymentGuard';
import { pinnedUsdcMint } from '@/config/treasury';
import { identify, resetIdentity, track } from '@/analytics';
import { AuthCtx, type Auth, type AuthStage, type Provider, type SocialProvider } from '@/auth/context';
import { consumeOAuthHandoff, restoreOAuthParamsForPrivy } from '@/auth/oauthHandoff';
import { privyAppId, privyClientId } from '@/auth/privy';
import { transactionBytesFromBase64, transactionBytesToBase64 } from '@/auth/solanaTransactionBytes';
import {
  CURATED_SOLANA_WALLETS,
  DETECTED_SOLANA_WALLETS,
  OTHER_SOLANA_WALLETS,
  solanaConnectWalletOptions,
  solanaWalletKeyFromClient,
  solanaWalletName,
  TRUST_SOLANA_WALLET,
  type SolanaWalletKey,
  type WalletFlow,
} from '@/auth/solanaWallets';
import { runWalletSignIn, type SiwsConnected } from '@/auth/walletSignIn';
import {
  externalSolanaWalletClientFromUser,
  isPrivyEmbeddedSolana,
  loginWalletOf,
  providerFromUser,
  solanaAddressFromUser,
  type PrivyUserLike,
} from '@/auth/user';
import { readSettings, updateSettings } from '@/state/settings';

const SIGN_IN_MS = 900;
const WALLET_MS = 1200;
const BUSY_MS = SIGN_IN_MS + WALLET_MS;
const HYDRATE_CAP_MS = 8000;
const INIT_CAP_MS = 2500;

const CANCEL = new Set(['exited_auth_flow', 'oauth_user_denied']);
const isCancel = (e: unknown) => {
  const o = e as { code?: unknown; privyErrorCode?: unknown } | null;
  for (const code of [o?.code, o?.privyErrorCode]) {
    if (typeof code !== 'string') continue;
    if (CANCEL.has(code) || /cancelled_by_user/.test(code)) return true;
  }
  return false;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Wallets = ConnectedStandardSolanaWallet[] | undefined;
type ConnectedExternalWallet = SiwsConnected & { transactionWallet: ConnectedStandardSolanaWallet };
type Sdk = React.RefObject<{
  user: User | null;
  logout: () => Promise<void>;
  refreshUser: () => Promise<{ user: User | null }>;
  wallets: Wallets;
  create: (() => Promise<{ address?: string } | null | undefined>) | undefined;
  getAccessToken: () => Promise<string | null>;
  initOAuth: (args: { provider: 'google' | 'apple' }) => Promise<void>;
  loginWithCode: (args: { code: string }) => Promise<void>;
  sendCode: (args: { email: string }) => Promise<void>;
  generateSiwsMessage: (args: { address: string }) => Promise<string>;
  loginWithSiws: (args: { signature: string; message: string; walletClientType?: string }) => Promise<User>;
  connectWallet: (options: { walletList: readonly string[]; walletChainType: 'solana-only' }) => void;
  signTransaction: (input: {
    transaction: Uint8Array;
    wallet: ConnectedStandardSolanaWallet;
    chain: 'solana:mainnet';
  }) => Promise<{ signedTransaction: Uint8Array }>;
  /** Privy's modal. Always called with the deposit address; the SDK's default is walletIndex 0. */
  exportWallet: (options: { address: string }) => Promise<void>;
}>;

/** Whether a listed wallet is Privy's own embedded one. `useWallets()` lists Privy's embedded wallets AND every connected
 *  external one (Phantom, Backpack, …), so its first entry is an external wallet whenever the embedded one does not exist
 *  yet: a Phantom left connected by a cancelled wallet sign-in became a Google user's deposit address (#279, reproduced).
 *  The test is the SDK's own (its connector filter): a PrivyStandardWallet has `isPrivyWallet` and a `privy:` feature. */
function isEmbeddedWallet(wallet: ConnectedStandardSolanaWallet): boolean {
  const standard = (wallet as { standardWallet?: { isPrivyWallet?: unknown; features?: Record<string, unknown> } }).standardWallet;
  return standard?.isPrivyWallet === true && standard.features?.['privy:'] !== undefined;
}
/** The first of Privy's embedded wallets in the hook's list, never an external one. */
const addressIn = (wallets: Wallets) => wallets?.find(isEmbeddedWallet)?.address ?? null;
const addressOf = (made: { address?: string } | null | undefined) =>
  made && typeof made.address === 'string' && made.address.length > 0 ? made.address : null;

/** Privy's connect callback returns the connector wrapper; SIWS signs through its Wallet Standard provider. */
function connectedSiwsWallet(value: unknown): ConnectedExternalWallet | null {
  const wallet = value as {
    type?: unknown;
    address?: unknown;
    walletClientType?: unknown;
    connectorType?: unknown;
    provider?: {
      address?: unknown;
      standardWallet?: { chains?: unknown };
      signMessage?: (input: { message: Uint8Array }) => Promise<{ signature: Uint8Array | string }>;
    };
  } | null;
  if (!wallet || wallet.type !== 'solana' || typeof wallet.address !== 'string') return null;
  const provider = wallet.provider;
  if (!provider || typeof provider.signMessage !== 'function') return null;
  if (typeof provider.address === 'string' && provider.address !== wallet.address) return null;
  const rawChains = provider.standardWallet?.chains;
  const chains = Array.isArray(rawChains) ? rawChains.filter((chain): chain is string => typeof chain === 'string') : undefined;
  return {
    address: wallet.address,
    chains,
    walletClientType: typeof wallet.walletClientType === 'string' ? wallet.walletClientType : undefined,
    connectorType: typeof wallet.connectorType === 'string' ? wallet.connectorType : undefined,
    signMessage: (input) => provider.signMessage!(input),
    transactionWallet: provider as ConnectedStandardSolanaWallet,
  };
}

async function solanaAddress(user: PrivyUserLike, sdk: Sdk): Promise<{ address: string | null; created: boolean; user: PrivyUserLike }> {
  // Funds address only. A Phantom (or other) login wallet does not count, so SIWS falls through to `create()`.
  const existing = solanaAddressFromUser(user);
  if (existing) return { address: existing, created: false, user };
  // The hook lists embedded wallets. Skip it when the document already has an external login: a seeded hook
  // address must not be treated as this binder's deposit wallet, and `create()` is what provisions one.
  const externalLogin = loginWalletOf(user);
  if (!externalLogin) {
    const fromHook = addressIn(sdk.current.wallets);
    if (fromHook) return { address: fromHook, created: false, user };
  }
  const create = sdk.current.create;
  if (!create) return { address: null, created: false, user };
  const made = await create().catch(() => null);
  const refreshed = await sdk.current.refreshUser().catch(() => null);
  const next = refreshed?.user ?? sdk.current.user ?? user;
  // The hook's array is whatever the last render stored. `createWallet()` resolves with the new wallet before that
  // render, so the return value is asked before the ref. Same bug as the phone's dead post-create fallback.
  const madeAddress = addressOf(made);
  const hookFallback = externalLogin ? null : addressIn(sdk.current.wallets);
  const address = solanaAddressFromUser(next) ?? madeAddress ?? hookFallback;
  return { address, created: madeAddress != null && address != null, user: next };
}

/** The bundle-budget marker. It has to be a live write in this module: a string nothing reads is stripped, and a
 *  string that also lives in the entry chunk fails the "not in the first paint" check. */
function markPrivyChunk(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.gachaponPrivyWeb = 'gachapon-privy-web-only';
}
markPrivyChunk();

// Once, at load. A fresh object per render would re-subscribe the wallet-standard listeners.
const SOLANA_CONNECTORS = toSolanaWalletConnectors({ shouldAutoConnect: false });

/**
 * Privy's `toSolanaWalletConnectors().get()` always ends with its built-in WalletConnect adapter,
 * even when nothing is installed (`walletBranding.id` `walletconnect_solana`, name `WalletConnect`).
 * That name is not a curated row, so it used to resolve to `detected_solana_wallets` and the
 * "Choose browser wallet" row read Detected for every visitor. It is also not a wallet the user installed.
 */
function isWalletConnectSolanaConnector(connector: {
  walletClientType?: string;
  walletBranding: { name: string; id?: string };
}): boolean {
  const flagged = connector as { isWalletConnectSolana?: boolean; wallet?: { isWalletConnectSolana?: boolean } };
  if (flagged.isWalletConnectSolana || flagged.wallet?.isWalletConnectSolana) return true;
  const client = connector.walletClientType?.toLowerCase() ?? '';
  const id = connector.walletBranding.id?.toLowerCase() ?? '';
  const name = connector.walletBranding.name.trim().toLowerCase();
  return client === 'walletconnect_solana' || client === 'walletconnect' || client === 'wallet_connect'
    || id === 'walletconnect_solana' || id === 'walletconnect'
    || name === 'walletconnect';
}

function standardConnectorFor(key: SolanaWalletKey) {
  if (key === DETECTED_SOLANA_WALLETS) return null;
  return SOLANA_CONNECTORS.get().find((connector) => connector.connectorType === 'solana_adapter'
    && !isWalletConnectSolanaConnector(connector)
    && solanaWalletKeyFromClient(connector.walletBranding.name) === key) ?? null;
}

function installedSolanaWallets(): ReadonlySet<SolanaWalletKey> {
  const found = new Set<SolanaWalletKey>();
  for (const connector of SOLANA_CONNECTORS.get()) {
    if (connector.connectorType !== 'solana_adapter') continue;
    if (isWalletConnectSolanaConnector(connector)) continue;
    found.add(solanaWalletKeyFromClient(connector.walletBranding.name));
  }
  return found;
}

const WEB_CONFIG: PrivyClientConfig = {
  loginMethods: ['email', 'google', 'apple'],
  appearance: {
    walletChainType: 'solana-only',
    walletList: [
      ...CURATED_SOLANA_WALLETS,
      ...OTHER_SOLANA_WALLETS,
      // Trust's wallet-standard id. The 3.45 union has no Trust member; the connector matcher still pairs it.
      TRUST_SOLANA_WALLET as WalletListEntry,
      DETECTED_SOLANA_WALLETS,
    ],
  },
  externalWallets: {
    solana: { connectors: SOLANA_CONNECTORS },
  },
  embeddedWallets: {
    ethereum: { createOnLogin: 'off' },
    solana: { createOnLogin: 'users-without-wallets' },
    showWalletUIs: false,
  },
};

function OAuthRestore() {
  const { ready } = usePrivy();
  useLayoutEffect(() => {
    if (ready) restoreOAuthParamsForPrivy();
  }, [ready]);
  return null;
}

function OAuthStrip() {
  const { ready } = usePrivy();
  useEffect(() => {
    if (ready) consumeOAuthHandoff();
  }, [ready]);
  return null;
}

export function PrivyAuthProvider({ children }: { children: React.ReactNode }) {
  const { ready: privyReady, user, logout, getAccessToken } = usePrivy();
  const userApi = useUser();
  const { initOAuth } = useLoginWithOAuth();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const solana = useWallets();
  const { createWallet } = useCreateWallet();
  const siws = useLoginWithSiws();
  const { signTransaction } = useSignTransaction();
  const { exportWallet } = useExportWallet();
  // Callbacks stay stable and read the waiter at call time. A fresh object each render is how the social hooks
  // rebuilt themselves, and listing that object restarted a failed restore.
  const walletWait = useRef<{ resolve: (w: ConnectedExternalWallet) => void; reject: (e: unknown) => void } | null>(null);
  const onConnectSuccess = useCallback((args: { wallet: unknown }) => {
    const waiter = walletWait.current;
    walletWait.current = null;
    if (!waiter) return;
    const wallet = connectedSiwsWallet(args.wallet);
    if (wallet) waiter.resolve(wallet);
    else waiter.reject(new Error('Connected wallet does not support Solana message signing'));
  }, []);
  const onConnectError = useCallback((e: unknown) => {
    const waiter = walletWait.current;
    walletWait.current = null;
    waiter?.reject(e);
  }, []);
  const { connectWallet: openWalletConnect } = useConnectWallet({ onSuccess: onConnectSuccess, onError: onConnectError });

  const [stage, setStage] = useState<AuthStage>('idle');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [step, setStep] = useState('');
  const [wallet, setWallet] = useState<string | null>(null);
  const [loginWallet, setLoginWallet] = useState<{ name: string; address: string } | null>(null);
  const [walletFlow, setWalletFlow] = useState<WalletFlow | null>(null);
  const walletFlowRef = useRef<WalletFlow | null>(null);
  useEffect(() => { walletFlowRef.current = walletFlow; });
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [capped, setCapped] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gen = useRef(0);
  const landedId = useRef<string | null>(null);
  const signingOut = useRef(false);

  // Same ref as `privyAuth.tsx`: `refreshUser` is a new arrow every render, and an effect that listed it restarted a
  // failed restore forever. Read at call time. `initOAuth` / `loginWithCode` live here too so `signIn` does not.
  const sdk = useRef<Sdk['current']>({
    user, logout,
    refreshUser: async () => ({ user: await userApi.refreshUser() }),
    wallets: solana.wallets,
    create: () => createWallet().then((made) => made.wallet),
    getAccessToken, initOAuth, loginWithCode, sendCode,
    generateSiwsMessage: (args) => siws.generateSiwsMessage(args),
    loginWithSiws: (args) => siws.loginWithSiws(args),
    connectWallet: (options) => { openWalletConnect(options as never); },
    signTransaction,
    exportWallet,
  });
  useEffect(() => {
    sdk.current = {
      user, logout,
      refreshUser: async () => ({ user: await userApi.refreshUser() }),
      wallets: solana.wallets,
      create: () => createWallet().then((made) => made.wallet),
      getAccessToken, initOAuth, loginWithCode, sendCode,
      generateSiwsMessage: (args) => siws.generateSiwsMessage(args),
      loginWithSiws: (args) => siws.loginWithSiws(args),
      connectWallet: (options) => { openWalletConnect(options as never); },
      signTransaction,
      exportWallet,
    };
  });

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    gen.current += 1;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setCapped(true), HYDRATE_CAP_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (privyReady) return;
    const t = setTimeout(() => setCapped(true), INIT_CAP_MS);
    return () => clearTimeout(t);
  }, [privyReady]);

  useEffect(() => {
    setAccessTokenProvider(() => sdk.current.getAccessToken());
    return () => setAccessTokenProvider(async () => null);
  }, []);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const land = useCallback(async (p: Provider, signedIn: PrivyUserLike, mine: number) => {
    const found = await solanaAddress(signedIn, sdk);
    if (!found.address) throw new Error('We could not create a wallet. Try again.');
    if (mine !== gen.current) return null;
    const me = await api.me();
    if (mine !== gen.current) return null;
    if (signedIn?.id) landedId.current = signedIn.id;
    // Login id for a wallet binder. Social land passes null. The connected address is not `found.address`.
    const login = p === 'wallet' ? loginWalletOf(found.user ?? signedIn) : null;
    return { p, address: found.address, id: me.id, created: found.created, login };
  }, []);

  const apply = useCallback((landed: { p: Provider; address: string; id: string; created: boolean; login: { name: string; address: string } | null }) => {
    setHydrated(true);
    if (landed.created) track('wallet_created', {});
    identify(landed.id);
    setProvider(landed.p);
    setWallet(landed.address);
    setLoginWallet(landed.login);
    setStage(readSettings().onboarded ? 'done' : 'onboarding');
    setStep('');
  }, []);

  useEffect(() => {
    if (!privyReady || !user || signingOut.current) return;
    if (landedId.current === user.id) return;
    if (stage !== 'idle') { landedId.current = user.id; return; }
    landedId.current = user.id;
    const mine = ++gen.current;
    const p = providerFromUser(user) ?? 'email';
    land(p, user, mine).then(
      (landed) => { if (landed && mine === gen.current) apply(landed); },
      (e) => {
        setHydrated(true);
        if (mine !== gen.current) return;
        landedId.current = null;
        void sdk.current.logout().catch(() => {});
        setError(toApiError(e));
        setStage('idle');
        setStep('');
      },
    );
  }, [privyReady, user, stage, land, apply]);

  const sendEmailCode = useCallback(async (email: string) => {
    setError(null);
    const address = email.trim();
    if (!address.includes('@')) {
      setError(toApiError(new Error('Enter your email.')));
      return false;
    }
    try {
      await sdk.current.sendCode({ email: address });
    } catch (e) {
      setError(toApiError(e));
      return false;
    }
    return true;
  }, []);

  const signIn = useCallback(async (p: SocialProvider, opts?: { email?: string; code?: string }) => {
    setError(null);
    setWalletFlow(null);
    track('signup', { provider: p });
    const mine = ++gen.current;
    const started = Date.now();
    setProvider(p);
    setStage('busy');
    setStep(`Signing in with ${p}…`);
    clearTimers();
    timers.current.push(setTimeout(() => { if (mine === gen.current) setStep('Creating your Solana wallet…'); }, SIGN_IN_MS));

    let authenticated = false;
    try {
      let signedIn: User | null = null;
      if (p === 'email') {
        await sdk.current.loginWithCode({ code: opts?.code?.trim() ?? '' });
        authenticated = true;
        if (mine !== gen.current) return;
        const refreshed = await sdk.current.refreshUser().catch(() => null);
        signedIn = refreshed?.user ?? sdk.current.user;
        if (!signedIn) throw new Error('We could not sign in. Try again.');
      } else {
        await sdk.current.initOAuth({ provider: p === 'Apple' ? 'apple' : 'google' });
        if (mine !== gen.current) return;
        const refreshed = await sdk.current.refreshUser().catch(() => null);
        signedIn = refreshed?.user ?? sdk.current.user;
        // Redirect started. The document is about to go; the return visit's restore effect lands the session.
        if (!signedIn) {
          setStage('idle');
          setStep('');
          setProvider(null);
          return;
        }
        authenticated = true;
      }
      if (signedIn.id) landedId.current = signedIn.id;
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
        setProvider(null);
        return;
      }
      // Same rule as the phone: log out unless Privy said the user backed out. A login that fills the store and then
      // throws leaves a session the restore effect would skip forever.
      landedId.current = null;
      void sdk.current.logout().catch(() => {});
      setError(toApiError(e));
    } finally {
      if (mine === gen.current) clearTimers();
    }
  }, [apply, land]);

  const connectExternal = useCallback(async (key: SolanaWalletKey): Promise<ConnectedExternalWallet> => {
    // Named Wallet Standard rows can connect their registered provider directly. In particular,
    // Jupiter is Wallet Standard-only and does not expose the legacy window.jupiter global that
    // Privy's named-wallet modal uses for its Installed state.
    const standard = standardConnectorFor(key);
    if (standard) {
      const connected = connectedSiwsWallet(await standard.connect({ showPrompt: true }));
      if (!connected) throw new Error('Connected wallet does not support Solana message signing');
      return connected;
    }
    return new Promise<ConnectedExternalWallet>((resolve, reject) => {
      if (walletWait.current) {
        reject(new Error('A wallet connection is already in progress.'));
        return;
      }
      walletWait.current = { resolve, reject };
      try {
        sdk.current.connectWallet(solanaConnectWalletOptions(key));
      } catch (e) {
        walletWait.current = null;
        reject(e);
      }
    });
  }, []);

  // Connect → SIWS sign → ok chip → embedded deposit wallet → the same land as Google.
  const signInWallet = useCallback(async (key: SolanaWalletKey) => {
    setError(null);
    setWalletFlow(null);
    const mine = ++gen.current;
    setStep('');
    clearTimers();
    const outcome = await runWalletSignIn({
      key,
      connect: connectExternal,
      generateMessage: (address) => sdk.current.generateSiwsMessage({ address }),
      login: (input) => sdk.current.loginWithSiws(input),
      onPhase: (next) => {
        if (mine !== gen.current) return;
        setWalletFlow(next);
        // Busy (the sheet stays up) only while the extension is in front of the user. An error is idle,
        // so the card can be dismissed. Set before the first real wait, or a restore could land twice.
        if (next.status === 'error') setStage('idle');
        else setStage('busy');
      },
      onConnect: () => track('signup', { provider: 'wallet', wallet: solanaWalletName(key) }),
      cancelled: () => mine !== gen.current,
      wait: sleep,
    });
    if (mine !== gen.current) return;
    if (!outcome.ok) {
      setStage('idle');
      setStep('');
      // A session only exists once SIWS login resolved, or the SDK wrote a user and then threw.
      if (outcome.authenticated || sdk.current.user) {
        landedId.current = null;
        void sdk.current.logout().catch(() => {});
      }
      return;
    }
    try {
      if (mine !== gen.current) return;
      const refreshed = await sdk.current.refreshUser().catch(() => null);
      const signedIn = refreshed?.user ?? sdk.current.user;
      if (!signedIn) throw new Error('We could not sign in. Try again.');
      if (signedIn.id) landedId.current = signedIn.id;
      const landed = await land('wallet', signedIn, mine);
      if (mine !== gen.current || !landed) return;
      // The user document is the source of the login wallet. If refresh dropped it, the address we just signed is the fallback.
      if (!landed.login) landed.login = { name: solanaWalletName(key), address: outcome.address };
      apply(landed);
      setWalletFlow(null);
    } catch (e) {
      if (mine !== gen.current) return;
      setWalletFlow(null);
      setStage('idle');
      setStep('');
      landedId.current = null;
      void sdk.current.logout().catch(() => {});
      setError(toApiError(e));
    }
  }, [apply, connectExternal, land]);

  const dismissWalletFlow = useCallback(() => {
    const current = walletFlowRef.current;
    gen.current += 1;
    const waiter = walletWait.current;
    walletWait.current = null;
    waiter?.reject(Object.assign(new Error('cancelled'), { code: 'exited_auth_flow' }));
    clearTimers();
    setStage('idle');
    setStep('');
    setError(null);
    // Cancel during connect / sign is its own card. From that card, or from any other error, this
    // returns to Apple / Google / email.
    if (current && (current.status === 'connect' || current.status === 'sign')) {
      setWalletFlow({ status: 'error', key: current.key, name: current.name, kind: 'cancel' });
    } else {
      setWalletFlow(null);
    }
  }, []);

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
    setWalletFlow(null);
    setOnboardingIndex(0);
    setError(null);
    const waiter = walletWait.current;
    walletWait.current = null;
    waiter?.reject(Object.assign(new Error('cancelled'), { code: 'exited_auth_flow' }));
    resetIdentity();
    void sdk.current.logout().catch(() => {}).finally(() => { signingOut.current = false; });
  }, []);

  const finishOnboarding = useCallback(() => { updateSettings({ onboarded: true }); setStage('done'); }, []);

  const signSolanaTransaction = useCallback(async (transactionBase64: string) => {
    // Same signer as Apple / Google / email: the embedded deposit wallet. A connected Phantom can also
    // sit in this list after SIWS; it is the login id, so it is not the wallet that signs a pull.
    const list = sdk.current.wallets ?? [];
    const selected = wallet ? list.find((item) => item.address === wallet) : list[0];
    if (!selected) throw new Error('Your Solana wallet is not ready. Try signing in again.');
    let transaction: Uint8Array;
    try {
      transaction = transactionBytesFromBase64(transactionBase64);
    } catch {
      throw new Error('The payment transaction was invalid. Try again.');
    }
    const signed = await sdk.current.signTransaction({
      transaction,
      wallet: selected,
      chain: 'solana:mainnet',
    });
    return transactionBytesToBase64(signed.signedTransaction);
  }, [wallet]);

  const depositFromConnectedWallet = useCallback(async (amountBase: number, idem: string) => {
    if (provider !== 'wallet' || !wallet || !loginWallet) {
      throw new Error('Your connected and deposit wallets are not ready. Try signing in again.');
    }
    let selected = sdk.current.wallets?.find((candidate) => candidate.address === loginWallet.address);
    if (!selected) {
      const reconnectKey = solanaWalletKeyFromClient(externalSolanaWalletClientFromUser(sdk.current.user));
      const reconnected = await connectExternal(reconnectKey);
      if (reconnected.address !== loginWallet.address) {
        throw new Error('Reconnect the same wallet you used to sign in.');
      }
      selected = reconnected.transactionWallet;
    }
    const built = await api.buildDeposit({ sourceWallet: loginWallet.address, amount: amountBase, idem });
    if (built.amount !== amountBase || built.destination !== wallet) {
      throw new Error('The built deposit did not match your request.');
    }
    // The status decides whether anything is signed, so it is matched exhaustively: `buildDeposit` is a typed cast with no
    // runtime check, and a guard keyed on `=== 'prepared'` let a response with no status, or any other value, skip the byte
    // check and still reach the signature (PR #290's review, reproduced).
    if (built.status === 'committed') return;
    if (built.status === 'signed') {
      // Nothing is signed here: the server broadcasts the bytes the user signed on an earlier attempt.
      await api.submitDeposit({ depositId: built.depositId, idem });
      return;
    }
    // The bytes the wallet signs, not only the JSON beside them (#278): exactly this transfer, from the wallet the user signed
    // in with, into their embedded wallet, of the build's pinned mint. Every expected value comes from the session or the
    // build, none from the response being checked. Anything but 'prepared' is refused here too.
    if (built.status !== 'prepared' || !depositAsExpected(built, pinnedUsdcMint
      ? { source: loginWallet.address, owner: wallet, mint: pinnedUsdcMint }
      : null)) {
      throw new Error('The built deposit did not match your request.');
    }
    let transaction: Uint8Array;
    try {
      transaction = transactionBytesFromBase64(built.transactionBase64);
    } catch {
      throw new Error('The deposit transaction was invalid. Try again.');
    }
    const signed = await sdk.current.signTransaction({ transaction, wallet: selected, chain: 'solana:mainnet' });
    await api.submitDeposit({
      depositId: built.depositId,
      signedTransactionBase64: transactionBytesToBase64(signed.signedTransaction),
      idem,
    });
  }, [connectExternal, loginWallet, provider, wallet]);

  const ready = capped || (privyReady && (!user || hydrated || stage !== 'idle'));

  // Privy's modal, for this deposit address only. A second embedded wallet must not fall through to
  // walletIndex 0, and a Phantom / Jupiter login wallet must not be the address passed in.
  const exportDepositWallet = useCallback(async () => {
    const address = wallet;
    if (!address || !isPrivyEmbeddedSolana(sdk.current.user, address)) {
      throw new Error('The export window did not finish.');
    }
    track('export_clicked', {});
    try {
      await sdk.current.exportWallet({ address });
    } catch {
      // MFA, when the user has it, is challenged inside Privy's modal. A dismiss rejects.
      // The original error stays here: it is not shown and it is not an analytics property.
      throw new Error('The export window did not finish.');
    }
    track('export_completed', {});
  }, [wallet]);

  const value = useMemo<Auth>(() => ({
    ready,
    stage, provider, step, wallet, loginWallet, onboardingIndex, error,
    // Web Apple is a Services ID on the dashboard (docs/PRIVY_SETUP.md §3c), not a second code path. The button is
    // offered; a dashboard that has no Apple client answers the tap with the error card.
    appleReady: true,
    signIn, sendEmailCode, signInWallet, installedSolanaWallets, walletFlow, dismissWalletFlow, signSolanaTransaction,
    depositFromConnectedWallet: provider === 'wallet' ? depositFromConnectedWallet : null,
    // Hidden unless this exact pubkey is a Privy embedded Solana wallet. SIWS qualifies once that
    // deposit wallet exists; a connected Phantom or Jupiter alone does not.
    ...(wallet && isPrivyEmbeddedSolana(user, wallet) ? { exportDepositWallet } : {}),
    signOut,
    nextSheet: () => { if (onboardingIndex >= 2) finishOnboarding(); else setOnboardingIndex((i) => i + 1); },
    skipOnboarding: finishOnboarding,
  }), [ready, stage, provider, step, wallet, loginWallet, walletFlow, onboardingIndex, error, signIn, sendEmailCode, signInWallet, dismissWalletFlow, signSolanaTransaction, depositFromConnectedWallet, exportDepositWallet, user, signOut, finishOnboarding]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function PrivyWebRoot({ children }: { children: React.ReactNode }) {
  const clientId = privyClientId();
  return (
    <PrivyProvider appId={privyAppId()} {...(clientId ? { clientId } : {})} config={WEB_CONFIG}>
      {/* Restore (layout) → the provider's `useLoginWithOAuth` effect reads → strip (passive, later sibling). */}
      <OAuthRestore />
      <PrivyAuthProvider>{children}</PrivyAuthProvider>
      <OAuthStrip />
    </PrivyProvider>
  );
}
