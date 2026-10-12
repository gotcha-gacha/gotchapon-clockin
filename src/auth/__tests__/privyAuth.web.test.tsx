// Privy on the web (W5.1), mounted directly. The picker (mock vs chunk) is authProvider.web.test.tsx.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { api, currentAccessTokenProvider, mock } from '@/api';
import { pendingEvents, resetAnalyticsForTests } from '@/analytics';
import { useAuth, type Auth } from '@/auth/context';
import { peekOAuthHandoff, resetOAuthHandoffForTests } from '@/auth/oauthHandoff';
import { PrivyWebRoot } from '@/auth/privyWebChunk';
import { solanaWalletName } from '@/auth/solanaWallets';
import { depositAsExpected } from '@/api/paymentGuard';

// The deposit's byte check (#278) is tested against the server's real builder in server/test/clientPaymentGuard.test.ts
// (jest cannot load @solana/kit); here it is a switch, and these tests hold what the app hands it: the connected wallet, the
// embedded wallet, the build's pinned mint — and that a refusal signs nothing.
const PINNED_MINT = '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547';
jest.mock('@/config/treasury', () => ({ expectedUsdcPayment: null, pinnedUsdcMint: '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547' }));
jest.mock('@/api/paymentGuard', () => ({
  ...jest.requireActual<typeof import('@/api/paymentGuard')>('@/api/paymentGuard'),
  depositAsExpected: jest.fn(() => true),
}));
const depositCheck = depositAsExpected as jest.MockedFunction<typeof depositAsExpected>;

type PrivyJest = {
  initOAuth: jest.Mock; sendCode: jest.Mock; loginWithCode: jest.Mock; logout: jest.Mock;
  createWallet: jest.Mock; getAccessToken: jest.Mock; refreshUser: jest.Mock;
  signMessage: jest.Mock; generateSiwsMessage: jest.Mock; loginWithSiws: jest.Mock; connectWallet: jest.Mock;
  signTransaction: jest.Mock;
  fundWallet: jest.Mock;
  exportWallet: jest.Mock;
  WALLET: string;
  EXTERNAL: string;
  state: { ready: boolean; user: { id?: string; linkedAccounts?: unknown[] } | null; oauthCodeSeen: string | null };
  wallets: { address: string; standardWallet?: unknown }[];
  embedded: (address: string) => { address: string; standardWallet: unknown };
  external: (address: string, name?: string) => { address: string; standardWallet: unknown };
  connectListeners: { onSuccess?: (args: { wallet: unknown }) => void; onError?: (e: unknown) => void };
  user: (k: 'google_oauth' | 'apple_oauth' | 'email', w?: string | null) => { id: string };
  reset: () => void;
};
const privy = () => (globalThis as unknown as { __gachaponPrivy: PrivyJest }).__gachaponPrivy;
type StandardConnectorJest = {
  connectorType: string;
  walletClientType?: string;
  walletBranding: { name: string; id?: string };
  connect: jest.Mock;
};
const solanaConnectors = () => (globalThis as unknown as {
  __gachaponSolanaConnectors: { connectors: StandardConnectorJest[] };
}).__gachaponSolanaConnectors.connectors;
const failOnce = (m: jest.Mock, error: unknown) => (m as unknown as { mockRejectedValueOnce: (e: unknown) => void }).mockRejectedValueOnce(error);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const live: { auth: Auth | null } = { auth: null };
const steps: string[] = [];
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    live.auth = auth;
    if (auth.stage === 'busy' && steps[steps.length - 1] !== auth.step) steps.push(auth.step);
  });
  return null;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
const mountBare = async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<PrivyWebRoot><Probe /></PrivyWebRoot>); });
};
// Captured before any test installs fake timers. Jest's fake `setTimeout` is not a `jest.fn`, so
// `isMockFunction` cannot tell them apart, and awaiting it never resolves.
const realSetTimeout = setTimeout;
const waitUntil = async (pred: () => boolean) => {
  for (let i = 0; i < 80; i++) {
    if (pred()) return;
    if (setTimeout !== realSetTimeout) {
      await act(async () => {
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        await Promise.resolve();
      });
    } else {
      await act(async () => { await new Promise((r) => realSetTimeout(r, 40)); });
    }
  }
  throw new Error(`timed out; stage=${live.auth?.stage} ready=${live.auth?.ready}`);
};
const mount = async () => { await mountBare(); await waitUntil(() => live.auth?.ready === true); };
const tick = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  privy().reset(); mock!.dev.reset(); resetAnalyticsForTests(); resetOAuthHandoffForTests();
  solanaConnectors().splice(0);
  live.auth = null; steps.length = 0;
  window.history.replaceState(null, '', '/');
});
afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  host?.remove(); host = null;
  resetOAuthHandoffForTests();
  window.history.replaceState(null, '', '/');
  const injected = window as unknown as Record<string, unknown>;
  delete injected.phantom; delete injected.jupiter; delete injected.solana; delete injected.backpack; delete injected.solflare;
  jest.useRealTimers();
});

test('Google signs in through initOAuth, lands the Solana wallet, and hands the HTTP client its token', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().initOAuth).toHaveBeenCalledWith({ provider: 'google' });
  expect([live.auth!.provider, live.auth!.wallet, live.auth!.stage]).toEqual(['Google', privy().WALLET, 'onboarding']);
  expect(live.auth!.loginWallet ?? null).toBeNull();
  await expect(currentAccessTokenProvider()()).resolves.toBe('test-token');
});

test('adds the embedded-wallet signature without broadcasting from the app', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('email', { email: 'a@b.com', code: '123456' }); });
  await expect(live.auth!.signSolanaTransaction!('AQID')).resolves.toBe('BAUG');
  expect(privy().signTransaction).toHaveBeenCalledWith({
    transaction: new Uint8Array([1, 2, 3]),
    wallet: privy().wallets[0],
    chain: 'solana:mainnet',
  });
});

test('email is two steps: a code is asked for, then signed in with the code alone', async () => {
  await mount();
  await act(async () => { expect(await live.auth!.sendEmailCode('a@b.com')).toBe(true); });
  expect(privy().sendCode).toHaveBeenCalledWith({ email: 'a@b.com' });
  expect(privy().loginWithCode).not.toHaveBeenCalled();
  await act(async () => { await live.auth!.signIn('email', { email: 'a@b.com', code: '123456' }); });
  expect(privy().loginWithCode).toHaveBeenCalledWith({ code: '123456' });
  expect(live.auth!.stage).toBe('onboarding');
});

test('an address that is not one is refused before Privy is asked anything', async () => {
  await mount();
  await act(async () => { expect(await live.auth!.sendEmailCode('not-an-email')).toBe(false); });
  expect(privy().sendCode).not.toHaveBeenCalled();
  expect(live.auth!.error).not.toBeNull();
});

test('Apple is the same OAuth call, and the button is offered', async () => {
  await mount();
  expect(live.auth!.appleReady).toBe(true);
  await act(async () => { await live.auth!.signIn('Apple'); });
  expect(privy().initOAuth).toHaveBeenCalledWith({ provider: 'apple' });
  expect([live.auth!.provider, live.auth!.wallet, live.auth!.stage]).toEqual(['Apple', privy().WALLET, 'onboarding']);
});

test('the busy state is two steps, 0.9 s then 1.2 s, even when Privy answers instantly', async () => {
  jest.useFakeTimers();
  try {
    await mountBare();
    await act(async () => { void live.auth!.signIn('Google'); });
    await tick(1);
    expect([live.auth!.stage, steps]).toEqual(['busy', ['Signing in with Google…']]);
    await tick(880);
    expect(steps).toEqual(['Signing in with Google…']);
    await tick(30);
    expect(steps).toEqual(['Signing in with Google…', 'Creating your Solana wallet…']);
    await tick(1150);
    expect(live.auth!.stage).toBe('busy');
    await tick(100);
    await waitUntil(() => live.auth!.stage === 'onboarding');
  } finally { jest.useRealTimers(); }
});

test('a cancelled sign-in leaves no error card and no session', async () => {
  await mount();
  failOnce(privy().initOAuth, Object.assign(new Error('nope'), { privyErrorCode: 'exited_auth_flow' }));
  await act(async () => { await live.auth!.signIn('Google'); });
  expect([live.auth!.stage, live.auth!.provider, live.auth!.error]).toEqual(['idle', null, null]);
  expect(privy().logout).not.toHaveBeenCalled();
  failOnce(privy().initOAuth, Object.assign(new Error('nope'), { privyErrorCode: 'oauth_user_denied' }));
  await act(async () => { await live.auth!.signIn('Apple'); });
  expect([live.auth!.stage, live.auth!.provider, live.auth!.error]).toEqual(['idle', null, null]);
});

test('an OAuth call that returns with no user is a redirect: no logout, no error', async () => {
  await mount();
  privy().initOAuth.mockImplementation(async () => {});
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().logout).not.toHaveBeenCalled();
  expect([live.auth!.stage, live.auth!.error, live.auth!.provider]).toEqual(['idle', null, null]);
});

test('a failure AFTER Privy authenticated ends the session rather than stranding it', async () => {
  await mount();
  jest.spyOn(api, 'me').mockRejectedValueOnce(new Error('network is down'));
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(live.auth!.stage).toBe('idle');
  expect(live.auth!.error).not.toBeNull();
  expect(privy().logout).toHaveBeenCalled();
});

test('a restored session lands straight in the app, without showing the first screen', async () => {
  privy().state.user = privy().user('google_oauth');
  await mountBare();
  expect(live.auth!.ready).toBe(false);
  await waitUntil(() => live.auth!.ready === true);
  expect([live.auth!.wallet, live.auth!.provider, live.auth!.stage, live.auth!.error]).toEqual([privy().WALLET, 'Google', 'onboarding', null]);
});

test('a restore whose /me fails ends on the first screen with an error, never on the blank frame', async () => {
  privy().state.user = privy().user('google_oauth');
  jest.spyOn(api, 'me').mockRejectedValueOnce(new Error('network is down'));
  await mountBare();
  await waitUntil(() => live.auth!.ready === true);
  expect(live.auth!.stage).toBe('idle');
  expect(live.auth!.error).not.toBeNull();
  expect(privy().logout).toHaveBeenCalled();
});

test('a restore that fails while logout ALSO fails still reaches the first screen', async () => {
  privy().state.user = privy().user('google_oauth');
  jest.spyOn(api, 'me').mockRejectedValueOnce(new Error('network is down'));
  privy().logout.mockImplementation(async () => { throw new Error('revoke failed'); });
  await mountBare();
  await waitUntil(() => live.auth!.ready === true);
  expect([live.auth!.stage, live.auth!.error !== null]).toEqual(['idle', true]);
});

test('a restore that never settles is released by the wall-clock cap', async () => {
  jest.useFakeTimers();
  try {
    privy().state.user = privy().user('email', null);
    privy().wallets.splice(0, 1);
    privy().createWallet.mockImplementation(() => new Promise(() => {}));
    await mountBare();
    expect(live.auth!.ready).toBe(false);
    await tick(7999);
    expect(live.auth!.ready).toBe(false);
    await tick(2);
    expect([live.auth!.ready, live.auth!.stage]).toEqual([true, 'idle']);
  } finally { jest.useRealTimers(); }
});

test('signing out clears the session and leaves no unhandled rejection when logout fails', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  failOnce(privy().logout, new Error('revoke failed'));
  await act(async () => { live.auth!.signOut(); });
  expect([live.auth!.stage, live.auth!.wallet, live.auth!.provider]).toEqual(['idle', null, null]);
});

test('a failed restore settles once: a later render does not start it again', async () => {
  const me = jest.spyOn(api, 'me').mockRejectedValue(new Error('offline'));
  me.mockClear();
  try {
    privy().logout.mockImplementation(async () => { throw new Error('offline too'); });
    privy().state.user = privy().user('google_oauth');
    await mountBare();
    await waitUntil(() => live.auth!.ready === true);
    const atSettle = me.mock.calls.length;
    for (let i = 0; i < 5; i++) await act(async () => { await live.auth!.sendEmailCode('not-an-email'); });
    expect([atSettle, me.mock.calls.length]).toEqual([1, 1]);
    expect(privy().logout.mock.calls.length).toBe(1);
  } finally { me.mockRestore(); }
});

test('wallet_created is about creating a wallet: a cold start with one already there does not fire it', async () => {
  privy().state.user = privy().user('google_oauth');
  await mountBare();
  await waitUntil(() => live.auth!.ready === true);
  expect(live.auth!.wallet).toBe(privy().WALLET);
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(0);
});

test('wallet_created fires when there was none and Privy makes one', async () => {
  privy().state.user = null;
  privy().wallets.splice(0, privy().wallets.length);
  privy().initOAuth.mockImplementation(async () => {
    privy().state.user = privy().user('google_oauth', null);
  });
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().createWallet).toHaveBeenCalled();
  expect(live.auth!.wallet).toBe(privy().WALLET);
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(1);
});

test('a leftover connected wallet never becomes a Google user\'s deposit wallet (#279)', async () => {
  // A Phantom sign-in cancelled at the signing step leaves Phantom connected: useWallets() lists it, and with no embedded
  // wallet yet it is the list's first entry. The next Google sign-in has no embedded wallet on its user document, so the
  // hook is the fallback — and `wallets[0]` handed that user Phantom as the address to fund and pay from.
  privy().state.user = null;
  privy().wallets.splice(0, privy().wallets.length, privy().external(privy().EXTERNAL));
  privy().initOAuth.mockImplementation(async () => {
    privy().state.user = privy().user('google_oauth', null);
  });
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(live.auth!.wallet).not.toBe(privy().EXTERNAL);
  expect(privy().createWallet).toHaveBeenCalledTimes(1);
  expect(live.auth!.wallet).toBe(privy().WALLET);
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(1);
});

// An extension that sets one of the SDK's two marks is still an extension: neither half alone makes it the deposit wallet
// (the SDK's own connector filter reads both, the flag and the `privy:` feature).
test.each([
  ['only the isPrivyWallet flag', { name: 'Lookalike', isPrivyWallet: true, features: {} }],
  ['only the privy: feature', { name: 'Lookalike', features: { 'privy:': {} } }],
])('a listed wallet with %s is not Privy\'s', async (_label, standardWallet) => {
  privy().state.user = null;
  privy().wallets.splice(0, privy().wallets.length, { address: privy().EXTERNAL, standardWallet });
  privy().initOAuth.mockImplementation(async () => {
    privy().state.user = privy().user('google_oauth', null);
  });
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(live.auth!.wallet).toBe(privy().WALLET);
  expect(privy().createWallet).toHaveBeenCalledTimes(1);
});

test('the hook fallback still takes an embedded wallet listed after an external one', async () => {
  // The control for the test above: the fallback is not gone, it only takes Privy's own wallets.
  privy().state.user = null;
  privy().wallets.splice(0, privy().wallets.length, privy().external(privy().EXTERNAL), privy().embedded(privy().WALLET));
  privy().initOAuth.mockImplementation(async () => {
    privy().state.user = privy().user('google_oauth', null);
  });
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(live.auth!.wallet).toBe(privy().WALLET);
  expect(privy().createWallet).not.toHaveBeenCalled();
});

test('a login that authenticates and THEN throws leaves no session behind', async () => {
  await mount();
  privy().initOAuth.mockImplementation(async () => {
    privy().state.user = privy().user('google_oauth');
    throw new Error('embedded_wallet_creation_error');
  });
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(privy().logout).toHaveBeenCalled();
  expect([live.auth!.stage, live.auth!.error !== null]).toEqual(['idle', true]);
});

test('Privy taking its time to start does not blank the app for the full network cap', async () => {
  jest.useFakeTimers();
  try {
    privy().state.ready = false;
    privy().state.user = null;
    await mountBare();
    expect(live.auth!.ready).toBe(false);
    await tick(2499);
    expect(live.auth!.ready).toBe(false);
    await tick(2);
    expect(live.auth!.ready).toBe(true);
    await act(async () => { privy().state.ready = true; privy().state.user = privy().user('google_oauth'); });
    expect(live.auth!.ready).toBe(true);
  } finally { jest.useRealTimers(); }
});

test('OAuth params are restored for the SDK once it is ready, then stripped, and history.state stays', async () => {
  const prior = { index: 2, id: 'pull' };
  window.history.replaceState(prior, '', '/pull?ref=mei&privy_oauth_code=abc&privy_oauth_state=s&privy_oauth_provider=google');
  const { captureOAuthHandoff } = await import('@/auth/oauthHandoff');
  captureOAuthHandoff();
  expect(window.location.search).toBe('?ref=mei');
  await mount();
  expect(privy().state.oauthCodeSeen).toBe('abc');
  expect(window.location.search).not.toContain('privy_oauth');
  expect(window.location.search).toContain('ref=mei');
  expect(window.history.state).toEqual(prior);
  expect(peekOAuthHandoff()).toBe('consumed');
});

const injectPhantom = () => { (window as unknown as { phantom?: unknown }).phantom = { solana: { isPhantom: true } }; };

test('Phantom SIWS provisions an embedded deposit wallet and does not link an email binder', async () => {
  injectPhantom();
  await mount();
  expect(live.auth!.signInWallet).toEqual(expect.any(Function));
  await act(async () => { await live.auth!.signInWallet!('phantom'); });
  expect(privy().connectWallet).toHaveBeenCalledWith({ walletList: ['phantom'], walletChainType: 'solana-only' });
  expect(privy().loginWithSiws).toHaveBeenCalledWith(expect.objectContaining({
    walletClientType: 'phantom', connectorType: 'injected',
  }));
  expect(privy().createWallet).toHaveBeenCalledTimes(1);
  expect([live.auth!.provider, live.auth!.wallet, live.auth!.stage]).toEqual(['wallet', privy().WALLET, 'onboarding']);
  expect(live.auth!.loginWallet).toEqual({ name: 'Phantom', address: privy().EXTERNAL });
  const accounts = privy().state.user?.linkedAccounts as { address?: string; walletClientType?: string }[];
  expect(accounts).toEqual(expect.arrayContaining([
    expect.objectContaining({ address: privy().EXTERNAL, walletClientType: 'phantom' }),
    expect.objectContaining({ address: privy().WALLET, walletClientType: 'privy' }),
  ]));
  const signup = pendingEvents().filter((e) => e.name === 'signup');
  expect(signup.map((e) => e.props)).toEqual([{ provider: 'wallet', wallet: 'Phantom' }]);
  const events = JSON.stringify(pendingEvents());
  expect(events).not.toContain(privy().EXTERNAL);
  expect(events).not.toContain(privy().WALLET);
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(1);
});

test('WalletConnect alone is not a detected browser wallet', async () => {
  await mount();
  expect(live.auth!.installedSolanaWallets?.()).toEqual(new Set());
  solanaConnectors().push({
    connectorType: 'solana_adapter',
    walletBranding: { name: 'Glow', id: 'glow' },
    connect: jest.fn(),
  });
  expect(live.auth!.installedSolanaWallets?.()).toEqual(new Set(['detected_solana_wallets']));
});

test('Jupiter is detected and connects through its Wallet Standard provider without the Privy chooser', async () => {
  const connect = jest.fn(async () => ({
    type: 'solana', address: privy().EXTERNAL, walletClientType: 'Jupiter Wallet', connectorType: 'solana_adapter',
    provider: {
      address: privy().EXTERNAL,
      standardWallet: { chains: ['solana:mainnet'] },
      signMessage: privy().signMessage,
    },
  }));
  solanaConnectors().push({
    connectorType: 'solana_adapter',
    walletBranding: { name: 'Jupiter Wallet' },
    connect,
  });
  await mount();
  expect(live.auth!.installedSolanaWallets?.()).toEqual(new Set(['jupiter']));
  await act(async () => { await live.auth!.signInWallet!('jupiter'); });
  expect(connect).toHaveBeenCalledWith({ showPrompt: true });
  expect(privy().connectWallet).not.toHaveBeenCalled();
  expect(privy().loginWithSiws).toHaveBeenCalledWith(expect.objectContaining({
    walletClientType: 'Jupiter Wallet', connectorType: 'solana_adapter',
  }));
  expect(live.auth!.loginWallet).toEqual({ name: 'Jupiter', address: privy().EXTERNAL });
});

test('rejecting a direct connect shows that wallet\'s cancel card, not the generic sign-in failure', async () => {
  const branding: Record<string, string> = {
    phantom: 'Phantom', jupiter: 'Jupiter Wallet', backpack: 'Backpack', solflare: 'Solflare',
  };
  const dismissed = Object.assign(new Error('No Solana accounts found in wallet'), {
    type: 'connector_error', privyErrorCode: 'no_solana_accounts',
  });
  for (const key of ['phantom', 'jupiter', 'backpack', 'solflare'] as const) {
    solanaConnectors().splice(0);
    privy().connectWallet.mockClear();
    const connect = jest.fn(async () => { throw dismissed; });
    solanaConnectors().push({
      connectorType: 'solana_adapter',
      walletClientType: key,
      walletBranding: { id: key, name: branding[key]! },
      connect,
    });
    await mount();
    await act(async () => { await live.auth!.signInWallet!(key); });
    expect(connect).toHaveBeenCalledWith({ showPrompt: true });
    expect(privy().connectWallet).not.toHaveBeenCalled();
    expect(privy().loginWithSiws).not.toHaveBeenCalled();
    expect(live.auth!.walletFlow).toEqual({
      status: 'error',
      key,
      name: solanaWalletName(key),
      kind: 'cancel',
    });
    expect(live.auth!.stage).toBe('idle');
    await act(async () => { root!.unmount(); });
    root = null;
    host?.remove();
    host = null;
  }
});

test('a SIWS pull signs the embedded deposit wallet when the connected wallet is also listed', async () => {
  injectPhantom();
  await mount();
  await act(async () => { await live.auth!.signInWallet!('phantom'); });
  privy().wallets.splice(0, privy().wallets.length, { address: privy().EXTERNAL }, { address: privy().WALLET });
  await expect(live.auth!.signSolanaTransaction!('AQID')).resolves.toBe('BAUG');
  expect(privy().signTransaction).toHaveBeenCalledWith(expect.objectContaining({
    wallet: { address: privy().WALLET },
    chain: 'solana:mainnet',
  }));
});

test('Backpack SIWS takes the same embedded deposit path', async () => {
  (window as unknown as { backpack?: unknown }).backpack = {};
  await mount();
  await act(async () => { await live.auth!.signInWallet!('backpack'); });
  expect(privy().createWallet).toHaveBeenCalledTimes(1);
  expect([live.auth!.provider, live.auth!.wallet]).toEqual(['wallet', privy().WALLET]);
  expect(live.auth!.loginWallet).toEqual({ name: 'Backpack', address: privy().EXTERNAL });
  expect(JSON.stringify(pendingEvents())).not.toContain(privy().EXTERNAL);
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(1);
  await expect(live.auth!.signSolanaTransaction!('AQID')).resolves.toBe('BAUG');
  expect(privy().signTransaction).toHaveBeenCalledWith(expect.objectContaining({
    wallet: expect.objectContaining({ address: privy().WALLET }),
  }));
  expect(live.auth!.depositFromConnectedWallet).toEqual(expect.any(Function));
  const destination = privy().WALLET;
  const build = jest.spyOn(api, 'buildDeposit').mockResolvedValue({
    depositId: 'deposit-1', asset: 'USDC', amount: 2_000_000, destination,
    transactionBase64: 'AQID', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'prepared',
  });
  const submit = jest.spyOn(api, 'submitDeposit').mockResolvedValue({
    depositId: 'deposit-1', asset: 'USDC', amount: 2_000_000, destination, signature: 'signature',
  });
  await act(async () => { await live.auth!.depositFromConnectedWallet!(2_000_000, 'deposit-idem'); });
  expect(build).toHaveBeenCalledWith({ sourceWallet: privy().EXTERNAL, amount: 2_000_000, idem: 'deposit-idem' });
  expect(depositCheck).toHaveBeenLastCalledWith(
    expect.objectContaining({ depositId: 'deposit-1', amount: 2_000_000, transactionBase64: 'AQID' }),
    { source: privy().EXTERNAL, owner: privy().WALLET, mint: PINNED_MINT },
  );
  expect(privy().signTransaction).toHaveBeenLastCalledWith({
    transaction: new Uint8Array([1, 2, 3]),
    wallet: expect.objectContaining({ address: privy().EXTERNAL }),
    chain: 'solana:mainnet',
  });
  expect(submit).toHaveBeenCalledWith({
    depositId: 'deposit-1', signedTransactionBase64: 'BAUG', idem: 'deposit-idem',
  });
  build.mockRestore(); submit.mockRestore();
});

test('a wallet missed by legacy globals is still asked of Privy, and a genuine miss does not record signup', async () => {
  privy().connectWallet.mockImplementation(() => {
    queueMicrotask(() => privy().connectListeners.onError?.(new Error('Provider not found')));
  });
  await mount();
  await act(async () => { await live.auth!.signInWallet!('phantom'); });
  expect(privy().connectWallet).toHaveBeenCalledWith({ walletList: ['phantom'], walletChainType: 'solana-only' });
  expect(privy().generateSiwsMessage).not.toHaveBeenCalled();
  expect(privy().loginWithSiws).not.toHaveBeenCalled();
  expect(pendingEvents().filter((e) => e.name === 'signup')).toHaveLength(0);
  expect([live.auth!.stage, live.auth!.provider, live.auth!.wallet]).toEqual(['idle', null, null]);
  expect(live.auth!.walletFlow).toEqual({ status: 'error', key: 'phantom', name: 'Phantom', kind: 'missing' });
});

test('a devnet wallet stops before the SIWS message', async () => {
  injectPhantom();
  privy().connectWallet.mockImplementation(() => {
    queueMicrotask(() => privy().connectListeners.onSuccess?.({
      wallet: {
        type: 'solana', address: privy().EXTERNAL, walletClientType: 'phantom', connectorType: 'injected',
        provider: {
          address: privy().EXTERNAL,
          standardWallet: { chains: ['solana:devnet'] },
          signMessage: privy().signMessage,
        },
      },
    }));
  });
  await mount();
  await act(async () => { await live.auth!.signInWallet!('phantom'); });
  expect(privy().generateSiwsMessage).not.toHaveBeenCalled();
  expect(privy().loginWithSiws).not.toHaveBeenCalled();
  expect(privy().createWallet).not.toHaveBeenCalled();
  expect(live.auth!.walletFlow).toMatchObject({ status: 'error', kind: 'network' });
  expect(JSON.stringify(pendingEvents())).not.toContain(privy().EXTERNAL);
});

test('the browser-wallet row uses the actual connector metadata and its provider to sign', async () => {
  await mount();
  await act(async () => { await live.auth!.signInWallet!('detected_solana_wallets'); });
  expect(privy().connectWallet).toHaveBeenCalledWith({
    walletList: ['detected_solana_wallets'], walletChainType: 'solana-only',
  });
  expect(privy().signMessage).toHaveBeenCalled();
  expect(privy().loginWithSiws).toHaveBeenCalledWith(expect.objectContaining({
    walletClientType: 'glow', connectorType: 'injected',
  }));
  expect([live.auth!.provider, live.auth!.wallet, live.auth!.stage]).toEqual([
    'wallet', privy().WALLET, 'onboarding',
  ]);
  expect(live.auth!.loginWallet).toEqual({ name: 'connected wallet', address: privy().EXTERNAL });
});

test('a rejected signature stays on the rejected card and does not land', async () => {
  injectPhantom();
  failOnce(privy().signMessage, Object.assign(new Error('User rejected the request'), { code: 4001 }));
  await mount();
  await act(async () => { await live.auth!.signInWallet!('phantom'); });
  expect(privy().loginWithSiws).not.toHaveBeenCalled();
  expect(privy().createWallet).not.toHaveBeenCalled();
  expect(live.auth!.walletFlow).toMatchObject({ status: 'error', kind: 'rejected' });
  expect(live.auth!.stage).toBe('idle');
});

test('cancelling the extension is the cancel card, with no session', async () => {
  injectPhantom();
  privy().connectWallet.mockImplementation(() => {
    queueMicrotask(() => privy().connectListeners.onError?.(Object.assign(new Error('closed'), { privyErrorCode: 'exited_auth_flow' })));
  });
  await mount();
  await act(async () => { await live.auth!.signInWallet!('phantom'); });
  expect(privy().loginWithSiws).not.toHaveBeenCalled();
  expect(privy().logout).not.toHaveBeenCalled();
  expect(live.auth!.walletFlow).toMatchObject({ status: 'error', kind: 'cancel' });
  expect([live.auth!.stage, live.auth!.wallet]).toEqual(['idle', null]);
});

test('a restored external-wallet session provisions the embedded deposit wallet', async () => {
  privy().state.user = {
    id: 'privy-siws',
    linkedAccounts: [{ type: 'wallet', chainType: 'solana', address: privy().EXTERNAL, walletClientType: 'phantom' }],
  };
  await mountBare();
  await waitUntil(() => live.auth!.ready === true);
  expect(privy().createWallet).toHaveBeenCalledTimes(1);
  expect([live.auth!.provider, live.auth!.wallet, live.auth!.stage]).toEqual(['wallet', privy().WALLET, 'onboarding']);
  expect(live.auth!.loginWallet).toEqual({ name: 'Phantom', address: privy().EXTERNAL });
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(1);
  expect(JSON.stringify(pendingEvents())).not.toContain(privy().EXTERNAL);
});

test('a restored SIWS session that already has an embedded wallet does not create another', async () => {
  privy().state.user = {
    id: 'privy-siws',
    linkedAccounts: [
      { type: 'wallet', chainType: 'solana', address: privy().EXTERNAL, walletClientType: 'phantom' },
      { type: 'wallet', chainType: 'solana', address: privy().WALLET, walletClientType: 'privy', connectorType: 'embedded' },
    ],
  };
  await mountBare();
  await waitUntil(() => live.auth!.ready === true);
  expect(privy().createWallet).not.toHaveBeenCalled();
  expect([live.auth!.provider, live.auth!.wallet]).toEqual(['wallet', privy().WALLET]);
  expect(live.auth!.loginWallet).toEqual({ name: 'Phantom', address: privy().EXTERNAL });
  expect(pendingEvents().filter((e) => e.name === 'wallet_created')).toHaveLength(0);
});

test('a deposit whose bytes are not the requested transfer is refused before anything is signed (#278)', async () => {
  (window as unknown as { backpack?: unknown }).backpack = {};
  await mount();
  await act(async () => { await live.auth!.signInWallet!('backpack'); });
  const destination = privy().WALLET;
  const build = jest.spyOn(api, 'buildDeposit').mockResolvedValue({
    depositId: 'deposit-bad', asset: 'USDC', amount: 2_000_000, destination,
    transactionBase64: 'AQID', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'prepared',
  });
  const submit = jest.spyOn(api, 'submitDeposit');
  privy().signTransaction.mockClear();
  depositCheck.mockClear();
  depositCheck.mockReturnValueOnce(false);
  let failure: unknown;
  await act(async () => {
    try { await live.auth!.depositFromConnectedWallet!(2_000_000, 'bad-idem'); } catch (e) { failure = e; }
  });
  expect(failure).toEqual(new Error('The built deposit did not match your request.'));
  // The JSON beside the bytes was right (amount, destination): only the byte check refused it.
  expect(depositCheck).toHaveBeenCalledTimes(1);
  expect(privy().signTransaction).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  build.mockRestore(); submit.mockRestore();
});

// A status the app does not know is not a pass: with the guard switched to refuse, none of these may reach a signature.
test.each([['no status', undefined], ['another case', 'Prepared'], ['an unknown value', 'pending']])(
  'a deposit with %s is refused before anything is signed, whatever the byte check would say', async (_label, status) => {
    (window as unknown as { backpack?: unknown }).backpack = {};
    await mount();
    await act(async () => { await live.auth!.signInWallet!('backpack'); });
    const destination = privy().WALLET;
    const build = jest.spyOn(api, 'buildDeposit').mockResolvedValue({
      depositId: 'deposit-odd', asset: 'USDC', amount: 2_000_000, destination,
      transactionBase64: 'AQID', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: status as 'prepared',
    });
    const submit = jest.spyOn(api, 'submitDeposit');
    privy().signTransaction.mockClear();
    depositCheck.mockClear();
    depositCheck.mockReturnValue(false);
    let failure: unknown;
    await act(async () => {
      try { await live.auth!.depositFromConnectedWallet!(2_000_000, 'odd-idem'); } catch (e) { failure = e; }
    });
    depositCheck.mockReturnValue(true);
    expect(failure).toEqual(new Error('The built deposit did not match your request.'));
    expect(privy().signTransaction).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    build.mockRestore(); submit.mockRestore();
  },
);

test('a deposit the server already holds signed is submitted without a byte check or a signature', async () => {
  (window as unknown as { backpack?: unknown }).backpack = {};
  await mount();
  await act(async () => { await live.auth!.signInWallet!('backpack'); });
  const destination = privy().WALLET;
  const build = jest.spyOn(api, 'buildDeposit').mockResolvedValue({
    depositId: 'deposit-signed', asset: 'USDC', amount: 2_000_000, destination,
    transactionBase64: 'AQID', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'signed',
  });
  const submit = jest.spyOn(api, 'submitDeposit').mockResolvedValue({
    depositId: 'deposit-signed', asset: 'USDC', amount: 2_000_000, destination, signature: 'signature',
  });
  privy().signTransaction.mockClear();
  depositCheck.mockClear();
  await act(async () => { await live.auth!.depositFromConnectedWallet!(2_000_000, 'signed-idem'); });
  expect(depositCheck).not.toHaveBeenCalled();
  expect(privy().signTransaction).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledWith({ depositId: 'deposit-signed', idem: 'signed-idem' });
  build.mockRestore(); submit.mockRestore();
});

test('a restored external-wallet session reconnects its signer before building a deposit', async () => {
  privy().state.user = {
    id: 'privy-siws',
    linkedAccounts: [
      { type: 'wallet', chainType: 'solana', address: privy().EXTERNAL, walletClientType: 'phantom' },
      { type: 'wallet', chainType: 'solana', address: privy().WALLET, walletClientType: 'privy' },
    ],
  };
  await mount();
  const destination = privy().WALLET;
  const build = jest.spyOn(api, 'buildDeposit').mockResolvedValue({
    depositId: 'restored-deposit', asset: 'USDC', amount: 2_000_000, destination,
    transactionBase64: 'AQID', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'prepared',
  });
  const submit = jest.spyOn(api, 'submitDeposit').mockResolvedValue({
    depositId: 'restored-deposit', asset: 'USDC', amount: 2_000_000, destination, signature: 'signature',
  });

  await act(async () => { await live.auth!.depositFromConnectedWallet!(2_000_000, 'restored-idem'); });

  expect(privy().connectWallet).toHaveBeenCalledWith({
    walletList: ['phantom'], walletChainType: 'solana-only',
  });
  expect(build).toHaveBeenCalledWith({ sourceWallet: privy().EXTERNAL, amount: 2_000_000, idem: 'restored-idem' });
  expect(privy().signTransaction).toHaveBeenCalledWith({
    transaction: new Uint8Array([1, 2, 3]),
    wallet: expect.objectContaining({ address: privy().EXTERNAL }),
    chain: 'solana:mainnet',
  });
  expect(submit).toHaveBeenCalledWith({
    depositId: 'restored-deposit', signedTransactionBase64: 'BAUG', idem: 'restored-idem',
  });
  build.mockRestore(); submit.mockRestore();
});

test('before sign-in there is no deposit key to export', async () => {
  await mount();
  expect(live.auth!.exportDepositWallet).toBeUndefined();
  expect(privy().exportWallet).not.toHaveBeenCalled();
});

test('Google export opens Privy’s modal for the deposit address and records no key material', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  expect(live.auth!.exportDepositWallet).toEqual(expect.any(Function));
  resetAnalyticsForTests();
  await act(async () => { await live.auth!.exportDepositWallet!(); });
  expect(privy().exportWallet).toHaveBeenCalledTimes(1);
  expect(privy().exportWallet).toHaveBeenCalledWith({ address: privy().WALLET });
  expect(pendingEvents().map((e) => e.name)).toEqual(['export_clicked', 'export_completed']);
  const dumped = JSON.stringify(pendingEvents());
  expect(dumped).not.toContain(privy().WALLET);
  expect(dumped).not.toContain('private');
});

test('a dismissed export does not count as completed and can be tried again', async () => {
  await mount();
  await act(async () => { await live.auth!.signIn('Google'); });
  resetAnalyticsForTests();
  failOnce(privy().exportWallet, Object.assign(new Error('mfa challenge declined'), { privyErrorCode: 'mfa_timeout' }));
  let failure: unknown;
  await act(async () => {
    try { await live.auth!.exportDepositWallet!(); } catch (e) { failure = e; }
  });
  expect(failure).toEqual(new Error('The export window did not finish.'));
  expect(String(failure)).not.toContain('mfa');
  expect(pendingEvents().map((e) => e.name)).toEqual(['export_clicked']);
  expect(live.auth!.stage).toBe('onboarding');
  await act(async () => { await live.auth!.exportDepositWallet!(); });
  expect(privy().exportWallet).toHaveBeenLastCalledWith({ address: privy().WALLET });
  expect(pendingEvents().map((e) => e.name)).toEqual(['export_clicked', 'export_clicked', 'export_completed']);
});

test('SIWS export passes the Privy deposit address and not the Phantom or Jupiter login key', async () => {
  injectPhantom();
  await mount();
  await act(async () => { await live.auth!.signInWallet!('phantom'); });
  expect(live.auth!.loginWallet).toEqual({ name: 'Phantom', address: privy().EXTERNAL });
  expect(live.auth!.wallet).toBe(privy().WALLET);
  resetAnalyticsForTests();
  privy().exportWallet.mockClear();
  await act(async () => { await live.auth!.exportDepositWallet!(); });
  expect(privy().exportWallet).toHaveBeenCalledTimes(1);
  expect(privy().exportWallet).toHaveBeenCalledWith({ address: privy().WALLET });
  const args = JSON.stringify(privy().exportWallet.mock.calls);
  expect(args).not.toContain(privy().EXTERNAL);
  expect(args).not.toContain('jupiter');
  expect(JSON.stringify(pendingEvents())).not.toContain(privy().WALLET);
  expect(JSON.stringify(pendingEvents())).not.toContain(privy().EXTERNAL);
});

test('a deposit wallet that is not marked privy is not exportable', async () => {
  privy().state.user = {
    id: 'privy-user',
    linkedAccounts: [
      { type: 'google_oauth' },
      { type: 'wallet', chainType: 'solana', address: privy().WALLET, connectorType: 'embedded' },
    ],
  };
  await mountBare();
  await waitUntil(() => live.auth!.wallet === privy().WALLET);
  expect(live.auth!.exportDepositWallet).toBeUndefined();
  expect(privy().exportWallet).not.toHaveBeenCalled();
});

test('a Phantom login with no Privy deposit wallet cannot export that login key', async () => {
  privy().state.user = {
    id: 'privy-siws',
    linkedAccounts: [
      { type: 'wallet', chainType: 'solana', address: privy().EXTERNAL, walletClientType: 'phantom' },
    ],
  };
  privy().createWallet.mockImplementation(async () => null);
  await mountBare();
  await waitUntil(() => live.auth!.ready === true);
  expect(live.auth!.exportDepositWallet).toBeUndefined();
  expect(privy().exportWallet).not.toHaveBeenCalled();
  const asked = JSON.stringify(privy().exportWallet.mock.calls);
  expect(asked).not.toContain(privy().EXTERNAL);
});

test('a handoff is not restored, and not consumed, until Privy is ready', async () => {
  privy().state.ready = false;
  window.history.replaceState({ index: 1 }, '', '/?privy_oauth_code=abc&privy_oauth_state=s&privy_oauth_provider=google&ref=mei');
  const { captureOAuthHandoff } = await import('@/auth/oauthHandoff');
  captureOAuthHandoff();
  await mountBare();
  expect(privy().state.oauthCodeSeen).toBeNull();
  expect(window.location.search).not.toContain('privy_oauth');
  expect(peekOAuthHandoff()).toEqual({ code: 'abc', state: 's', provider: 'google' });
});
