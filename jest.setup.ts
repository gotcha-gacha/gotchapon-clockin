// Jest setup for component tests (#64): the native modules jest-expo cannot load are replaced by the
// mocks their packages ship, plus small hand mocks for the Expo sensor/haptic/clipboard modules.
import { jest } from '@jest/globals';
import 'react-native-gesture-handler/jestSetup';

// Skia's own jestSetup builds its mock around global.CanvasKit, which this node environment does not
// load; the factories the app touches at render time (shader, path) get inert stubs instead.
jest.mock('@shopify/react-native-skia', () => {
  jest.mock('@shopify/react-native-skia/lib/commonjs/Platform', () => {
    const noop = () => undefined;
    return { OS: 'web', PixelRatio: 1, requireNativeComponent: noop, resolveAsset: noop, findNodeHandle: noop, NativeModules: noop, View: noop };
  });
  jest.mock('@shopify/react-native-skia/lib/commonjs/skia/core/Font', () => ({ useFont: () => null, matchFont: () => null, listFontFamilies: () => [], useFonts: () => null }));
  const mock = require('@shopify/react-native-skia/lib/module/mock').Mock((global as { CanvasKit?: unknown }).CanvasKit);
  const path = (): Record<string, unknown> => ({ addCircle: () => undefined, reset: () => undefined, moveTo: () => undefined, lineTo: () => undefined, copy: () => path() });
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      addCircle() { return b; },
      addPath() { return b; },
      reset() { return b; },
      build: path,
    };
    return b;
  };
  return { ...mock, Skia: { ...mock.Skia, RuntimeEffect: { Make: () => null }, Path: { Make: path }, PathBuilder: { Make: builder, MakeFromPath: builder } } };
});

require('react-native-reanimated').setUpTests();

// Async queries (findBy*, waitFor) wait up to 5 s, not 1 s: page tests run several mock round trips before their first
// assertion, and a loaded parallel run stretches that past a second (a burn test and an account sheet test each timed out so).
require('@testing-library/react-native/pure').configure({ asyncUtilTimeout: 5000 });

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('react-native-pager-view', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Pager = React.forwardRef((props: { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({ setPage: () => {} }));
    return React.createElement(View, null, props.children);
  });
  Pager.displayName = 'PagerViewMock';
  return { __esModule: true, default: Pager };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Rigid: 'rigid', Soft: 'soft' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-sensors', () => {
  const sensor = () => ({ setUpdateInterval: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })), isAvailableAsync: jest.fn(async () => false) });
  return { DeviceMotion: sensor(), Gyroscope: sensor(), Accelerometer: sensor() };
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn(async () => '') }));

// Share (F2.11): the capture writes a real file on a device, so tests read the calls instead — `captureRef` hands back a
// file uri and `shareAsync` records what was handed to the system sheet.
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/gachapon-share.png') }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined) }));

// jest-expo's generic mock of expo-crypto returns undefined from randomUUID; idempotency keys must be real strings.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));

// expo-file-system's File API in memory (state/pendingPulls): a file written before a remount is still there after it, as on a
// device across launches. One store per test file, like the in-app mock.
jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/'); }
    get exists() { return files.has(this.uri); }
    create() { files.set(this.uri, ''); }
    textSync() { const t = files.get(this.uri); if (t === undefined) throw new Error(`No file at ${this.uri}`); return t; }
    write(content: string) { files.set(this.uri, content); }
  }
  return { File, Paths: { document: { uri: 'file:///document' } } };
});

// Privy (F7.4): native SDK + secure storage stay out of jest. AuthProvider talks to these hooks.
//
// `usePrivy` reads a MUTABLE state object rather than closing over constants, so a test can put a user
// on the client before mount and drive the cold-start restore, or hold `isReady` false. With the
// constant `user: null` this mock shipped with, the restore effect ran zero times in the whole suite
// and `ready` was a constant true, so the blank-frame branch was unreachable from any test (review MF4).
// `privyState()` resets it; `privyUser()` builds a user document.
jest.mock('@privy-io/expo', () => {
  // Deliberately NOT the in-app mock's own wallet (src/api/mock/index.ts). They were the same string,
  // which let a test asserting "the Privy address is shown" pass on the mock's address (review N7).
  const WALLET = 'PRIVYwa11etSo1anaAddr3ssForTestsOn1y00PRIVY';
  const user = (kind: 'google_oauth' | 'apple_oauth' | 'email', wallet: string | null = WALLET) => ({
    id: 'privy-user',
    linked_accounts: [
      { type: kind },
      ...(wallet ? [{ type: 'wallet', chain_type: 'solana', connector_type: 'embedded', address: wallet }] : []),
    ],
  });
  const state: { isReady: boolean; user: unknown } = { isReady: true, user: null };
  // A successful login PUTS THE USER ON THE CLIENT, as the real SDK does: `usePrivy().user` reads a
  // zustand store that `auth.oauth.loginWithCode` fills before the promise resolves. The mock used to
  // only return the document, so `user` stayed null through every sign-in and no test in the suite ever
  // rendered a signed-in Privy client — which is how a blank screen across the whole busy state and
  // onboarding passed 267 tests and a 14/14 mutation matrix (review round 2, finding 2).
  const signedIn = (u: ReturnType<typeof user>) => { state.user = u; return u; };
  const login = jest.fn(async ({ provider }: { provider: string }) =>
    signedIn(user(provider === 'google' ? 'google_oauth' : 'apple_oauth')));
  const sendCode = jest.fn(async () => ({}));
  const loginWithCode = jest.fn(async () => signedIn(user('email')));
  const logout = jest.fn(async () => { state.user = null; });
  const providerRequest = jest.fn(async (input: { params: { transaction: { signatures: Uint8Array[] } } }) => {
    // Privy's provider mutates the supplied web3.js transaction by filling the embedded wallet's
    // signer slot and returns that same transaction object.
    input.params.transaction.signatures[0] = new Uint8Array(64).fill(7);
    return { signedTransaction: input.params.transaction };
  });
  const embeddedWallet = () => ({
    address: WALLET,
    getProvider: async () => ({ request: providerRequest }),
  });
  // Creating a wallet really creates one: it lands on the user document and in `wallets`, which is what the SDK does
  // (`embeddedWallet.add` returns the updated user). With a `create` that resolved null and changed nothing, no test in the
  // suite ever took the creation path, so `wallet_created` firing on every cold start and a dead post-create fallback both
  // survived review round after review round (review).
  const addEmbedded = (current: unknown) => {
    const doc = current as { id?: string; linked_accounts?: { type?: string; chain_type?: string; connector_type?: string; wallet_client_type?: string; address?: string }[] } | null;
    if (!doc || !Array.isArray(doc.linked_accounts)) return user('email', WALLET);
    const kept = doc.linked_accounts.filter((a) => {
      if (a.type !== 'wallet' || a.chain_type !== 'solana') return true;
      const embedded = a.wallet_client_type === 'privy' || a.connector_type === 'embedded';
      const external = (typeof a.wallet_client_type === 'string' && a.wallet_client_type !== 'privy')
        || (typeof a.connector_type === 'string' && a.connector_type !== 'embedded');
      return external && !embedded;
    });
    return {
      ...doc,
      linked_accounts: [...kept, { type: 'wallet', chain_type: 'solana', connector_type: 'embedded', wallet_client_type: 'privy', address: WALLET }],
    };
  };
  const provision = async () => {
    if (state.user) state.user = addEmbedded(state.user);
    if (wallets.length === 0) wallets.push(embeddedWallet());
    return null;
  };
  const create = jest.fn(provision);
  const getAccessToken = jest.fn(async () => 'test-token');
  const refreshUser = jest.fn(async () => ({ user: state.user }));
  const wallets = [embeddedWallet()];
  // SIWS linking (a wallet app on Android, Mobile Wallet Adapter): a successful link puts the wallet on the user, as the SDK does.
  const generateSiwsMessage = jest.fn(async ({ wallet }: { wallet: { address: string } }) =>
    ({ message: `gotchapon.fun wants you to sign in with your Solana account:\n${wallet.address}` }));
  const linkSiws = jest.fn(async ({ message }: { message: string; signature: string }) => {
    const address = message.split('\n')[1];
    if (state.user) {
      const doc = state.user as { linked_accounts: object[] };
      state.user = { ...doc, linked_accounts: [...doc.linked_accounts, { type: 'wallet', chain_type: 'solana', connector_type: 'mobile_wallet_adapter', wallet_client_type: 'mobile_wallet_adapter', address }] } as typeof state.user;
    }
    return state.user;
  });
  (globalThis as { __gachaponPrivy?: unknown }).__gachaponPrivy = {
    login, sendCode, loginWithCode, logout, create, getAccessToken, refreshUser, providerRequest, WALLET, state, wallets,
    generateSiwsMessage, linkSiws,
    user,
    reset() {
      state.isReady = true; state.user = null;
      wallets.splice(0, wallets.length, embeddedWallet());
      [login, sendCode, loginWithCode, logout, create, getAccessToken, refreshUser, providerRequest, generateSiwsMessage, linkSiws].forEach((f) => f.mockClear());
      login.mockImplementation(async ({ provider }: { provider: string }) =>
        signedIn(user(provider === 'google' ? 'google_oauth' : 'apple_oauth')));
      loginWithCode.mockImplementation(async () => signedIn(user('email')));
      logout.mockImplementation(async () => { state.user = null; });
      create.mockImplementation(provision);
      refreshUser.mockImplementation(async () => ({ user: state.user }));
    },
  };
  return {
    PrivyProvider: ({ children }: { children: unknown }) => children,
    // `refreshUser` is a NEW ARROW on every call, exactly as the SDK builds it
    // (`usePrivy` → `refreshUser:()=>n.user.refreshUser()`). A stable `jest.fn` here made the provider's callbacks look
    // stable too, so the restore effect ran once in every test — and a restore that fails restarting itself on every
    // render went unseen by all 17 of them (review). The spy is still called, so assertions keep working.
    usePrivy: () => ({ isReady: state.isReady, user: state.user, error: null, logout, getAccessToken, refreshUser: () => refreshUser() }),
    useLoginWithOAuth: () => ({ login, state: { status: 'initial' } }),
    useLoginWithEmail: () => ({ sendCode, loginWithCode }),
    useEmbeddedSolanaWallet: () => ({ status: 'connected', wallets, create }),
    // A new object every render, as the SDK's hook returns: the provider must read it through its ref.
    useLinkWithSiws: () => ({ generateMessage: (args: { wallet: { address: string } }) => generateSiwsMessage(args), link: (opts: { message: string; signature: string }) => linkSiws(opts) }),
  };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })), maybeCompleteAuthSession: jest.fn() }));
// expo-apple-authentication is deliberately NOT installed (MF2): it is an optional Privy peer whose
// only import is dynamic and Apple-path-only, and installing it adds the Sign in with Apple entitlement.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: View, WebView: View };
});
jest.mock('react-native-passkeys', () => ({ isSupported: () => false }));
jest.mock('@privy-io/expo-native-extensions', () => ({}));

// expo-audio (F6.2): players that record what they were asked to do. Tests read the calls through
// `jest.mocked(createAudioPlayer).mock.results`.
jest.mock('expo-audio', () => {
  type MockPlayer = { source: unknown; loop: boolean; volume: number; playing: boolean; play: () => void; pause: () => void; seekTo: (s: number) => Promise<void>; remove: () => void };
  const createAudioPlayer = jest.fn((source: unknown) => {
    const p: MockPlayer = {
      source, loop: false, volume: 1, playing: false,
      play: jest.fn(() => { p.playing = true; }),
      pause: jest.fn(() => { p.playing = false; }),
      seekTo: jest.fn(async () => {}),
      remove: jest.fn(),
    };
    return p;
  });
  return { createAudioPlayer, setAudioModeAsync: jest.fn(async () => {}) };
});
