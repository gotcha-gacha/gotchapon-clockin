// Setup for the web jest project (W0.4, #122): what jsdom lacks and this app's web build reaches for at import time.
import { jest } from '@jest/globals';

// react-native-reanimated's web build asks the system for reduced motion when it is imported (ReducedMotion.ts), and jsdom
// has no matchMedia: without this every component that imports Reanimated fails to load. "No preference" is the default.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom lays nothing out: `document.documentElement.clientWidth` is 0 while `window.innerWidth` is 1024, and react-native-web's
// Dimensions (so `useWindowDimensions`) reads the former. Make the two agree, or every width-driven component sees a 0-wide window.
if (typeof document !== 'undefined') {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => window.innerWidth });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => window.innerHeight });
}

// Every browser on the floor has crypto.randomUUID (the API client keys each prepare and commit with one, through expo-crypto);
// jsdom's `crypto` does not. Node's own is the same function.
// The web bundle signs SIWS with `TextEncoder`. jsdom does not provide one; Node does.
if (typeof globalThis.TextEncoder !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require('node:util') as typeof import('node:util');
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: randomUUID });
}

// `@privy-io/react-auth` (W5.1). The web jest project does not load `jest.setup.ts`, and the real SDK does not run here.
// Motion matches the installed package, not a tidier fiction: `refreshUser` is a new arrow every call, a login puts the
// user on the client, and `createWallet` actually adds a wallet. CamelCase, because that is the web user document.
jest.mock('@privy-io/react-auth', () => {
  const React = require('react') as typeof import('react');
  const WALLET = 'PRIVYwa11etSo1anaAddr3ssForTestsOn1y00PRIVY';
  const user = (kind: 'google_oauth' | 'apple_oauth' | 'email', wallet: string | null = WALLET) => ({
    id: 'privy-user',
    linkedAccounts: [
      { type: kind },
      ...(wallet ? [{ type: 'wallet', chainType: 'solana', address: wallet,
        connectorType: 'embedded', walletClientType: 'privy' }] : []),
    ],
  });
  const state: { ready: boolean; user: ReturnType<typeof user> | null; oauthCodeSeen: string | null } = {
    ready: true, user: null, oauthCodeSeen: null,
  };
  const signedIn = (u: ReturnType<typeof user>) => { state.user = u; return u; };
  const initOAuth = jest.fn(async ({ provider }: { provider: string }) => {
    signedIn(user(provider === 'google' ? 'google_oauth' : 'apple_oauth'));
  });
  const sendCode = jest.fn(async () => {});
  const loginWithCode = jest.fn(async () => { signedIn(user('email')); });
  const logout = jest.fn(async () => { state.user = null; });
  // What `@privy-io/react-auth/solana`'s `useWallets()` hands back, in its order: Privy's embedded wallets first, then every
  // connected external wallet (read in the installed SDK, useWallets). Each is a ConnectedStandardSolanaWallet whose
  // `standardWallet` says what it is: Privy's own is a PrivyStandardWallet (`isPrivyWallet`, a `privy:` feature), an external
  // one is the extension's (#279: a bare `{ address }` list hid which was which, and a leftover Phantom became `wallets[0]`).
  type MockListedWallet = { address: string; standardWallet: { name: string; isPrivyWallet?: boolean; features: Record<string, unknown> } };
  const embedded = (address: string): MockListedWallet => ({ address, standardWallet: { name: 'Privy', isPrivyWallet: true, features: { 'privy:': {} } } });
  const external = (address: string, name = 'Phantom'): MockListedWallet => ({ address, standardWallet: { name, features: {} } });
  const isEmbedded = (w: MockListedWallet) => w.standardWallet.isPrivyWallet === true;
  const wallets: MockListedWallet[] = [embedded(WALLET)];
  const embedDepositWallet = (current: NonNullable<typeof state.user>) => {
    const kept = current.linkedAccounts.filter((a) => {
      if (a.type !== 'wallet' || a.chainType !== 'solana') return true;
      const client = 'walletClientType' in a ? (a as { walletClientType?: string }).walletClientType : undefined;
      return typeof client === 'string' && client.length > 0 && client !== 'privy';
    });
    return {
      ...current,
      linkedAccounts: [
        ...kept,
        { type: 'wallet' as const, chainType: 'solana' as const, address: WALLET, walletClientType: 'privy' as const, connectorType: 'embedded' as const },
      ],
    };
  };
  const createWallet = jest.fn(async () => {
    if (state.user) state.user = embedDepositWallet(state.user);
    if (!wallets.some(isEmbedded)) wallets.unshift(embedded(WALLET));
    return { wallet: { address: WALLET, chainType: 'solana' } };
  });
  const getAccessToken = jest.fn(async () => 'test-token');
  const refreshUser = jest.fn(async () => state.user);
  const signTransaction = jest.fn(async () => ({ signedTransaction: new Uint8Array([4, 5, 6]) }));
  const fundWallet = jest.fn(async () => {});
  const exportWallet = jest.fn(async (_options?: { address: string }) => {});
  const EXTERNAL = 'So1anaExternalWalletAddressForSiwsTest11';
  const signMessage = jest.fn(async () => ({ signature: Uint8Array.from([9, 8, 7, 6]) }));
  const generateSiwsMessage = jest.fn(async ({ address }: { address: string }) =>
    `gachapon.test wants you to sign in with your Solana account:\n${address}\n\nNonce: nonce-siws-1`);
  const loginWithSiws = jest.fn(async ({ message, walletClientType }: { message: string; walletClientType?: string }) => {
    const address = /Solana account:\s*(\S+)/.exec(message)?.[1] ?? EXTERNAL;
    const next = {
      id: 'privy-siws',
      linkedAccounts: [{ type: 'wallet' as const, chainType: 'solana' as const, address,
        connectorType: 'injected', walletClientType: walletClientType ?? 'phantom' }],
    };
    state.user = next;
    return next;
  });
  const connectListeners: {
    onSuccess?: (args: { wallet: unknown }) => void;
    onError?: (e: unknown) => void;
  } = {};
  const connectedSolanaWallet = (opts?: { walletList?: string[] }, chains = ['solana:mainnet']) => {
    const requested = opts?.walletList?.[0] ?? 'phantom';
    const walletClientType = requested === 'detected_solana_wallets' ? 'glow' : requested;
    return {
      type: 'solana', address: EXTERNAL, walletClientType, connectorType: 'injected',
      provider: {
        address: EXTERNAL,
        standardWallet: { chains },
        signMessage,
      },
    };
  };
  const connectWallet = jest.fn((opts?: { walletList?: string[] }) => {
    const wallet = connectedSolanaWallet(opts);
    if (!wallets.some((candidate) => candidate.address === EXTERNAL)) wallets.push(external(EXTERNAL));
    queueMicrotask(() => connectListeners.onSuccess?.({ wallet }));
  });
  (globalThis as { __gachaponPrivy?: unknown }).__gachaponPrivy = {
    initOAuth, sendCode, loginWithCode, logout, createWallet, getAccessToken, refreshUser, WALLET, EXTERNAL, state, wallets,
    embedded, external,
    signMessage, generateSiwsMessage, loginWithSiws, connectWallet, connectListeners, signTransaction, fundWallet, exportWallet,
    user,
    reset() {
      state.ready = true; state.user = null; state.oauthCodeSeen = null;
      wallets.splice(0, wallets.length, embedded(WALLET));
      [initOAuth, sendCode, loginWithCode, logout, createWallet, getAccessToken, refreshUser, signMessage, generateSiwsMessage, loginWithSiws, connectWallet, signTransaction, fundWallet, exportWallet]
        .forEach((f) => f.mockClear());
      initOAuth.mockImplementation(async ({ provider }: { provider: string }) => {
        signedIn(user(provider === 'google' ? 'google_oauth' : 'apple_oauth'));
      });
      loginWithCode.mockImplementation(async () => { signedIn(user('email')); });
      logout.mockImplementation(async () => { state.user = null; });
      createWallet.mockImplementation(async () => {
        if (state.user) state.user = embedDepositWallet(state.user);
        if (!wallets.some(isEmbedded)) wallets.unshift(embedded(WALLET));
        return { wallet: { address: WALLET, chainType: 'solana' } };
      });
      refreshUser.mockImplementation(async () => state.user);
      signTransaction.mockImplementation(async () => ({ signedTransaction: new Uint8Array([4, 5, 6]) }));
      exportWallet.mockReset();
      exportWallet.mockImplementation(async () => {});
      signMessage.mockImplementation(async () => ({ signature: Uint8Array.from([9, 8, 7, 6]) }));
      generateSiwsMessage.mockImplementation(async ({ address }: { address: string }) =>
        `gachapon.test wants you to sign in with your Solana account:\n${address}\n\nNonce: nonce-siws-1`);
      loginWithSiws.mockImplementation(async ({ message, walletClientType }: { message: string; walletClientType?: string }) => {
        const address = /Solana account:\s*(\S+)/.exec(message)?.[1] ?? EXTERNAL;
        const next = {
          id: 'privy-siws',
          linkedAccounts: [{ type: 'wallet' as const, chainType: 'solana' as const, address,
            connectorType: 'injected', walletClientType: walletClientType ?? 'phantom' }],
        };
        state.user = next;
        return next;
      });
      connectWallet.mockImplementation((opts?: { walletList?: string[] }) => {
        const wallet = connectedSolanaWallet(opts);
        if (!wallets.some((candidate) => candidate.address === EXTERNAL)) wallets.push(external(EXTERNAL));
        queueMicrotask(() => connectListeners.onSuccess?.({ wallet }));
      });
    },
  };
  return {
    PrivyProvider: ({ children, config }: { children: React.ReactNode; config?: unknown }) => {
      (globalThis as { __gachaponPrivyConfig?: unknown }).__gachaponPrivyConfig = config;
      return children;
    },
    usePrivy: () => ({
      ready: state.ready,
      authenticated: state.user !== null,
      user: state.user,
      error: null,
      logout,
      getAccessToken,
    }),
    // A new arrow every call, as `useUser` builds `refreshUser`. A stable jest.fn hid the restore loop on the phone.
    useUser: () => ({ user: state.user, refreshUser: () => refreshUser() }),
    useLoginWithEmail: () => ({ sendCode, loginWithCode, state: { status: 'initial' } }),
    // Records the code it sees once `ready`, the way the SDK's effect reads `privy_oauth_code` after the layout restore.
    useLoginWithOAuth: () => {
      React.useEffect(() => {
        if (!state.ready) return;
        const code = new URLSearchParams(globalThis.location.search).get('privy_oauth_code');
        if (code) state.oauthCodeSeen = code;
      }, [state.ready]);
      return { initOAuth, loading: false, state: { status: 'initial' } };
    },
    useLoginWithSiws: () => ({ generateSiwsMessage, loginWithSiws }),
    useConnectWallet: (callbacks?: { onSuccess?: (args: { wallet: unknown }) => void; onError?: (e: unknown) => void }) => {
      connectListeners.onSuccess = callbacks?.onSuccess;
      connectListeners.onError = callbacks?.onError;
      return { connectWallet };
    },
  };
});
jest.mock('@privy-io/react-auth/solana', () => {
  const p = () => (globalThis as unknown as { __gachaponPrivy: {
    wallets: { address: string }[];
    createWallet: () => Promise<unknown>;
    signTransaction: () => Promise<{ signedTransaction: Uint8Array }>;
    fundWallet: () => Promise<void>;
    exportWallet: (options?: { address: string }) => Promise<void>;
  } }).__gachaponPrivy;
  const calls: { shouldAutoConnect?: boolean }[] = [];
  const connectors: unknown[] = [];
  (globalThis as { __gachaponSolanaConnectors?: unknown }).__gachaponSolanaConnectors = { calls, connectors };
  return {
    useWallets: () => ({ ready: true, wallets: p().wallets }),
    useCreateWallet: () => ({ createWallet: p().createWallet }),
    useSignTransaction: () => ({ signTransaction: p().signTransaction }),
    useFundWallet: () => ({ fundWallet: p().fundWallet }),
    useExportWallet: () => ({ exportWallet: p().exportWallet }),
    // The real helper walks wallet-standard at import. The chunk calls it once with auto-connect off (#243).
    toSolanaWalletConnectors: (args?: { shouldAutoConnect?: boolean }) => {
      calls.push({ shouldAutoConnect: args?.shouldAutoConnect });
      // The real helper always appends Privy's WalletConnect adapter, with or without an extension.
      const walletConnect = {
        connectorType: 'solana_adapter',
        walletClientType: 'walletconnect_solana',
        walletBranding: { id: 'walletconnect_solana', name: 'WalletConnect' },
        connect: () => Promise.reject(new Error('WalletConnect is not a direct connect')),
      };
      return { onMount() {}, onUnmount() {}, get: () => [...connectors, walletConnect] };
    },
  };
});
