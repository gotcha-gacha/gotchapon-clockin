// The marks have to arrive in the DOM as vectors, not as the letter the button used to say. A native testID does not
// show that react-native-svg actually painted the four Google fills.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth, type Auth } from '@/auth/AuthProvider';
import type { WalletFlow } from '@/auth/solanaWallets';
import { PRIVACY_URL, TERMS_URL } from '@/legal/urls';
import { AuthSheet } from '@/screens/firstScreen/AuthSheet';
import { color } from '@/theme/tokens';

jest.mock('@/auth/AuthProvider', () => ({ useAuth: jest.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const fills = (id: string) => [...document.querySelectorAll(`[data-testid="${id}"] path`)].map((p) => p.getAttribute('fill'));

function authStub(over: Partial<Auth> = {}): Auth {
  return {
    ready: true, stage: 'idle', provider: null, step: '', wallet: null, onboardingIndex: 0, error: null,
    appleReady: true,
    signIn: jest.fn(async () => {}),
    sendEmailCode: jest.fn(async () => true),
    signSolanaTransaction: null,
    depositFromConnectedWallet: null,
    signOut: jest.fn(),
    nextSheet: jest.fn(),
    skipOnboarding: jest.fn(),
    ...over,
  };
}

const button = (label: string) => [...document.querySelectorAll('[role="button"]')].find((b) => b.textContent?.includes(label)) ?? null;
const click = async (el: Element | null) => {
  if (!el) throw new Error('missing control');
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const renderSheet = async () => {
  await act(async () => { root.render(<SafeAreaProvider><AuthSheet onClose={onClose} /></SafeAreaProvider>); });
};
const borderColor = (id: string) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!).borderTopColor;
const wipeInjected = () => {
  const w = window as unknown as Record<string, unknown>;
  delete w.phantom; delete w.jupiter; delete w.solana; delete w.backpack; delete w.solflare; delete w.okxwallet; delete w.coinbaseSolana; delete w.trustwallet;
};

let onClose: jest.Mock;

beforeEach(() => {
  onClose = jest.fn();
  jest.mocked(useAuth).mockReturnValue(authStub());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  window.history.replaceState(null, '', '/');
  wipeInjected();
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  window.history.replaceState(null, '', '/');
  wipeInjected();
});

test('the sheet insets the title and the Apple, Google, and email row from the rim', async () => {
  await renderSheet();
  const body = document.querySelector('[data-testid="auth-sheet-body"]');
  if (!body) throw new Error('missing sheet body');
  const pad = getComputedStyle(body);
  for (const side of [pad.paddingLeft, pad.paddingRight]) expect(Number.parseFloat(side)).toBeGreaterThanOrEqual(24);
  expect(Number.parseFloat(pad.paddingTop)).toBeGreaterThanOrEqual(22);
  expect(document.querySelector('[data-testid="auth-sheet"]')?.querySelector('[role="button"]')).not.toBeNull();
  // Still a scroller: a tall wallet list has somewhere to go. The first-pull panel behind the sheet is unchanged.
  let scroller: Element | null = body.parentElement;
  while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  expect(scroller).not.toBeNull();
});

test('the sheet paints the Apple silhouette and the four-colour Google G', async () => {
  await renderSheet();
  expect(fills('apple-mark')).toEqual([color.room]);
  expect(fills('google-mark').sort()).toEqual(['#34A853', '#4285F4', '#EA4335', '#FBBC05']);
  for (const id of ['apple-mark', 'google-mark']) {
    expect(document.querySelector(`[data-testid="${id}"]`)?.closest('[aria-hidden="true"]')).not.toBeNull();
  }
  const buttons = [...document.querySelectorAll('[role="button"]')].map((b) => b.textContent);
  expect(buttons).toEqual(expect.arrayContaining(['Continue with Apple', 'Continue with Google']));
  expect(buttons.some((t) => /^G\s/.test(t ?? ''))).toBe(false);
});

test('social and email stay above one collapsed wallet toggle, and the footer drops 18+', async () => {
  window.history.replaceState(null, '', '/?ref=mei');
  await renderSheet();
  const text = document.body.textContent ?? '';
  const at = (s: string) => text.indexOf(s);
  expect(at('Sign in to pull')).toBeGreaterThanOrEqual(0);
  expect(at('Sign in to pull')).toBeLessThan(at('Continue with Apple'));
  expect(text).not.toContain('Invited by'); // ?ref is ignored until W4 (Ben, 11 Oct)
  expect(at('Continue with Apple')).toBeLessThan(at('Continue with Google'));
  expect(at('Continue with Google')).toBeLessThan(at('Send code'));
  expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('or your email');
  expect([...document.querySelectorAll('*')].some((el) => el.childNodes.length === 1 && el.textContent === 'or')).toBe(true);
  expect(at('Connect a wallet')).toBeGreaterThan(at('Send code'));
  expect(text).toContain('Phantom · Jupiter · Backpack · more');
  expect(document.querySelector('[data-testid="wallet-row-phantom"]')).toBeNull();
  expect(document.querySelectorAll('input')).toHaveLength(1);
  expect(text).toContain('Apple, Google, email, or your wallet');
  expect(text).toContain('Privy');
  expect(text).not.toContain('18+');
  expect(text).not.toMatch(/link a wallet/i);
});

test('the wallet toggle expands with a gold border, Detected and Install tags, and More', async () => {
  (window as unknown as { phantom?: unknown }).phantom = { solana: { isPhantom: true } };
  jest.mocked(useAuth).mockReturnValue(authStub({ installedSolanaWallets: () => new Set(['jupiter']) }));
  await renderSheet();
  const toggle = document.querySelector('[data-testid="wallet-toggle"]');
  expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  await click(toggle);
  expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  expect(borderColor('wallet-toggle').replace(/\s/g, '')).toContain('255,210,63');
  const markFile: Record<string, string> = {
    phantom: 'phantom.svg', jupiter: 'jupiter.svg', backpack: 'backpack.svg', solflare: 'solflare.svg',
  };
  for (const [id, file] of Object.entries(markFile)) {
    const mark = document.querySelector(`[data-testid="wallet-row-${id}"] [data-testid="wallet-mark-${id}"]`);
    expect(mark?.tagName).toBe('IMG');
    expect(mark?.getAttribute('src')).toBe(`/wallets/${file}`);
    expect(mark?.getAttribute('width')).toBe('36');
    expect(mark?.getAttribute('height')).toBe('36');
  }
  const stacked = [...document.querySelectorAll('[data-testid="wallet-toggle"] img')].map((el) => el.getAttribute('src'));
  expect(stacked).toEqual(['/wallets/phantom.svg', '/wallets/backpack.svg', '/wallets/solflare.svg']);
  expect(document.querySelector('[data-testid="wallet-row-phantom"]')?.textContent).toContain('Detected');
  expect(document.querySelector('[data-testid="wallet-row-jupiter"]')?.textContent).toContain('Detected');
  expect(document.querySelector('[data-testid="wallet-row-backpack"]')?.textContent).toContain('Install');
  expect(document.querySelector('[data-testid="wallet-row-solflare"]')?.textContent).toContain('Install');
  expect(document.body.textContent).toContain("Free to sign · can't move funds");
  await click(document.querySelector('[data-testid="wallet-more"]'));
  expect(document.body.textContent).toContain('Browser wallets');
  expect(document.querySelector('[data-testid="wallet-row-detected_solana_wallets"]')?.textContent).toContain('Choose browser wallet');
  expect(document.querySelector('[data-testid="wallet-row-detected_solana_wallets"]')?.textContent).toContain('Choose');
  expect(document.body.textContent).not.toContain('No other wallet in this browser');
  const moreMarks: Record<string, string> = {
    okx_wallet: 'okx.svg', coinbase_wallet: 'coinbase.svg', trust_wallet: 'trust.svg',
  };
  for (const [id, file] of Object.entries(moreMarks)) {
    const row = document.querySelector(`[data-testid="wallet-row-${id}"]`);
    expect(row?.textContent).toContain('Install');
    const mark = row?.querySelector(`[data-testid="wallet-mark-${id}"]`);
    expect(mark?.getAttribute('src')).toBe(`/wallets/${file}`);
    expect(mark?.getAttribute('width')).toBe('36');
  }
  expect(document.querySelector('[data-testid="wallet-row-detected_solana_wallets"] [data-testid="wallet-mark-detected"]')).not.toBeNull();
  expect(document.body.textContent).toContain('WalletConnect · coming soon');
  await click(toggle);
  expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('[data-testid="wallet-row-phantom"]')).toBeNull();
});

test('Choose browser wallet stays Choose when no real wallet is registered', async () => {
  jest.mocked(useAuth).mockReturnValue(authStub({ installedSolanaWallets: () => new Set() }));
  await renderSheet();
  await click(document.querySelector('[data-testid="wallet-toggle"]'));
  await click(document.querySelector('[data-testid="wallet-more"]'));
  const row = document.querySelector('[data-testid="wallet-row-detected_solana_wallets"]');
  expect(row?.textContent).toContain('Choose browser wallet');
  expect(row?.textContent).toContain('Choose');
  expect(row?.textContent).not.toContain('Detected');
});

test('Choose browser wallet is Detected when a real unnamed wallet is registered', async () => {
  jest.mocked(useAuth).mockReturnValue(authStub({
    installedSolanaWallets: () => new Set(['detected_solana_wallets']),
  }));
  await renderSheet();
  await click(document.querySelector('[data-testid="wallet-toggle"]'));
  await click(document.querySelector('[data-testid="wallet-more"]'));
  const row = document.querySelector('[data-testid="wallet-row-detected_solana_wallets"]');
  expect(row?.textContent).toContain('Choose browser wallet');
  expect(row?.textContent).toContain('Detected');
});

test('a cancelled direct connect names the wallet that was tapped', async () => {
  const names = { phantom: 'Phantom', jupiter: 'Jupiter', backpack: 'Backpack', solflare: 'Solflare' } as const;
  for (const key of ['phantom', 'jupiter', 'backpack', 'solflare'] as const) {
    jest.mocked(useAuth).mockReturnValue(authStub({
      walletFlow: { status: 'error', key, name: names[key], kind: 'cancel' },
    }));
    await renderSheet();
    const text = document.body.textContent ?? '';
    expect(text).toContain(`Cancelled in ${names[key]}`);
    expect(text).toContain('Nothing was signed and nothing was charged.');
    expect(text).not.toContain('could not sign in');
    expect(text).not.toContain('The wallet connected, but sign-in did not finish');
    for (const other of Object.values(names)) {
      if (other !== names[key]) expect(text).not.toContain(`Cancelled in ${other}`);
    }
  }
});

test('an unnamed legacy-injected wallet marks the always-available browser picker as Detected', async () => {
  (window as unknown as { solana?: unknown }).solana = { connect() {} };
  await renderSheet();
  await click(document.querySelector('[data-testid="wallet-toggle"]'));
  await click(document.querySelector('[data-testid="wallet-more"]'));
  const row = document.querySelector('[data-testid="wallet-row-detected_solana_wallets"]');
  expect(row?.textContent).toContain('Choose browser wallet');
  expect(row?.textContent).toContain('Detected');
});

test('Terms and Privacy open the interim drafts in a new tab, and Odds is not a dead link', async () => {
  const tab = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  jest.mocked(useAuth).mockReturnValue(authStub());
  await renderSheet();
  const link = (name: string) => [...document.querySelectorAll('[role="link"]')].find((el) => el.textContent === name) ?? null;
  expect(document.body.textContent).not.toContain('Odds');
  await click(link('Terms'));
  await click(link('Privacy'));
  expect(tab.mock.calls.map((call) => call[0])).toEqual([TERMS_URL, PRIVACY_URL]);
  expect(tab.mock.calls.every((call) => call[1] === '_blank' && call[2] === 'noopener,noreferrer')).toBe(true);
});

test('Apple and Google still call signIn, and a build without wallet sign-in does not pretend to connect', async () => {
  const signIn = jest.fn(async () => {});
  jest.mocked(useAuth).mockReturnValue(authStub({ signIn }));
  await renderSheet();
  await click(button('Continue with Apple'));
  await click(button('Continue with Google'));
  expect(signIn).toHaveBeenNthCalledWith(1, 'Apple');
  expect(signIn).toHaveBeenNthCalledWith(2, 'Google');
  await click(document.querySelector('[data-testid="wallet-toggle"]'));
  await click(document.querySelector('[data-testid="wallet-row-phantom"]'));
  expect(document.body.textContent).toContain('Wallet sign-in is not on in this build');
});

test('a missing wallet offers Install and Open in app, and the other three errors offer Try again', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  const signInWallet = jest.fn(async () => {});
  const dismiss = jest.fn();
  const page = 'http://localhost/';
  window.history.replaceState(null, '', page);
  const show = async (flow: WalletFlow) => {
    jest.mocked(useAuth).mockReturnValue(authStub({ signInWallet, dismissWalletFlow: dismiss, walletFlow: flow }));
    await renderSheet();
  };
  try {
    await show({ status: 'error', key: 'phantom', name: 'Phantom', kind: 'missing' });
    expect(document.body.textContent).toContain('Phantom is not installed');
    await click(button('Install'));
    await click(button('Open in app'));
    expect(open).toHaveBeenNthCalledWith(1, 'https://phantom.app/download');
    expect(open).toHaveBeenNthCalledWith(2, `https://phantom.app/ul/browse/${encodeURIComponent(page)}`);
    await show({ status: 'error', key: 'solflare', name: 'Solflare', kind: 'missing' });
    await click(button('Open in app'));
    expect(open).toHaveBeenLastCalledWith(`https://solflare.com/ul/v1/browse/${encodeURIComponent(page)}`);
    await show({ status: 'error', key: 'backpack', name: 'Backpack', kind: 'missing' });
    await click(button('Open in app'));
    expect(open).toHaveBeenLastCalledWith(`https://backpack.app/ul/v1/browse/${encodeURIComponent(page)}`);
    const titles = { cancel: 'Cancelled in Phantom', network: 'Switch Phantom to Mainnet', rejected: 'Phantom declined the signature' } as const;
    for (const kind of ['cancel', 'network', 'rejected'] as const) {
      await show({ status: 'error', key: 'phantom', name: 'Phantom', kind });
      expect(document.body.textContent).toContain(titles[kind]);
      expect(button('Try again')).not.toBeNull();
      expect(button('Use another way to sign in')).not.toBeNull();
    }
    await show({ status: 'error', key: 'detected_solana_wallets', name: 'Browser wallet', kind: 'unknown' });
    expect(document.body.textContent).toContain('Browser wallet could not sign in');
    expect(document.body.textContent).not.toContain('declined the signature');
    await click(button('Use another way to sign in'));
    expect(dismiss).toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Close"]')).not.toBeNull();
  } finally { open.mockRestore(); }
});

test('the sheet cannot be dismissed during connect, sign, or ok', async () => {
  const flows: WalletFlow[] = [
    { status: 'connect', key: 'phantom', name: 'Phantom' },
    { status: 'sign', key: 'phantom', name: 'Phantom', domain: 'gachapon.test', address: 'So1anaExternalWalletAddressForSiwsTest11', nonce: 'nonce-siws-1' },
    { status: 'ok', key: 'phantom', name: 'Phantom', address: 'So1anaExternalWalletAddressForSiwsTest11' },
  ];
  for (const flow of flows) {
    onClose.mockClear();
    jest.mocked(useAuth).mockReturnValue(authStub({ stage: 'busy', walletFlow: flow, dismissWalletFlow: jest.fn() }));
    await renderSheet();
    expect(document.querySelector('[aria-label="Close"]')).toBeNull();
    const backdrop = [...document.querySelectorAll('[aria-hidden="true"]')].find((el) => el.childElementCount === 0);
    await click(backdrop ?? null);
    expect(onClose).not.toHaveBeenCalled();
    if (flow.status === 'connect') expect(document.body.textContent).toContain('Approve in Phantom');
  }
  jest.mocked(useAuth).mockReturnValue(authStub({
    walletFlow: { status: 'sign', key: 'backpack', name: 'Backpack', domain: 'gachapon.test', address: 'So1anaExternalWalletAddressForSiwsTest11', nonce: 'n-1' },
  }));
  await renderSheet();
  expect(document.body.textContent).toContain('Sign the message');
  expect(document.body.textContent).toContain('gachapon.test');
  expect(document.body.textContent).toContain('n-1');
  expect(document.body.textContent).toContain("can't move funds");
  jest.mocked(useAuth).mockReturnValue(authStub({
    stage: 'busy',
    walletFlow: { status: 'ok', key: 'solflare', name: 'Solflare', address: 'So1anaExternalWalletAddressForSiwsTest11' },
  }));
  await renderSheet();
  expect(document.body.textContent).toContain('Wallet connected');
  expect(button('Cancel')).toBeNull();
});
