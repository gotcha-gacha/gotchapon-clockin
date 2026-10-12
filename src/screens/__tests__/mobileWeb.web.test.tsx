/**
 * Frameless mobile web (W0.3, #121), the parts a DOM can show: no input under 16 px (iOS Safari zooms the page on focus below
 * that, whatever the viewport tag says, and does not zoom back), and "Open wallet app" only where a wallet app can answer.
 * Rendered by react-dom through react-native-web; the computed style is what a browser would apply.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthSheet } from '@/screens/firstScreen/AuthSheet';
import { WalletPage } from '@/screens/WalletPage';
import { WithdrawSheet } from '@/components/wallet/WithdrawSheet';
import { inputFontSize, WEB_INPUT_FLOOR } from '@/theme/inputs';
import { useSession } from '@/state/session';

jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ stage: 'idle', error: null, signIn: jest.fn() }) }));
jest.mock('@/state/session', () => ({ PAGE: { albums: 0, pull: 1, wallet: 2 }, balanceText: () => '$0.00', useSession: jest.fn() }));
jest.mock('@/audio/sfx', () => ({ playSfx: jest.fn() }));
jest.mock('@/api/http', () => ({ newIdempotencyKey: () => 'idem-test' })); // jsdom's crypto has no randomUUID; the sheet makes a key when it opens
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const mount = async (ui: React.ReactElement) => { await act(async () => { root.render(<SafeAreaProvider>{ui}</SafeAreaProvider>); }); };
const inputs = () => [...document.querySelectorAll('input, textarea')] as HTMLElement[];
const px = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize);
/** What `(any-pointer: coarse)` answers: a phone or tablet says yes (with a trackpad attached too), a desktop with a mouse says no. */
const pointer = (coarse: boolean) => jest.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q === '(any-pointer: coarse)' ? coarse : false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList);

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); jest.restoreAllMocks(); });

test('the floor itself: on the web a 13 or 14 px field becomes 16, and a bigger one is left alone', () => {
  expect(WEB_INPUT_FLOOR).toBe(16); // Safari's threshold, not a taste: 15.9 still zooms
  expect(inputFontSize(13)).toBe(16);
  expect(inputFontSize(14)).toBe(16);
  expect(inputFontSize(18)).toBe(18);
});

test('sign-in: the email field is at least 16 px in the DOM', async () => {
  await mount(<AuthSheet onClose={() => {}} />); // the field lives in the auth sheet since #211
  expect(inputs()).toHaveLength(1);
  for (const el of inputs()) expect(px(el)).toBeGreaterThanOrEqual(16);
});

test('withdraw: the address and amount fields are at least 16 px in the DOM', async () => {
  await mount(<WithdrawSheet open availableUsd={12} onClose={() => {}} onWithdraw={async () => ({ ok: true }) as never} />);
  expect(inputs()).toHaveLength(2); // react-native-web's Modal renders into document.body, outside the host
  for (const el of inputs()) expect(px(el)).toBeGreaterThanOrEqual(16);
});

test('every file that renders a TextInput sizes it through the floor (a tripwire for the next input, not a proof of this one)', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const users = walk(path.resolve(__dirname, '../..')).filter((f) => /\.tsx$/.test(f) && !/__tests__|\.test\./.test(f) && /<TextInput\b/.test(fs.readFileSync(f, 'utf8')));
  expect(users.length).toBeGreaterThanOrEqual(2); // the walk found the two that exist
  expect(users.filter((f) => !/inputFontSize\(/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
});

const wallet = () => jest.mocked(useSession).mockReturnValue({ me: { wallet: '7xKpQm2vR8tW3nHd9fQaLm4sT6uVbN1cXeYz8wKpRq' }, balanceKnown: true, balanceUsd: 0, usdcUsd: 0, holdings: [], funding: null, shipments: [], withdraw: null, page: 2 } as unknown as ReturnType<typeof useSession>);
const buttons = () => [...host.querySelectorAll('[role="button"]')].map((b) => b.textContent);

test('a desktop browser (a mouse): no "Open wallet app", which would do nothing there; Copy address stays', async () => {
  pointer(false); wallet();
  await mount(<WalletPage />);
  expect(buttons()).toContain('Copy address');
  expect(buttons()).not.toContain('Open wallet app');
});

test("a phone's browser (a finger): Open wallet app is offered, as in the app", async () => {
  pointer(true); wallet();
  await mount(<WalletPage />);
  expect(buttons()).toEqual(expect.arrayContaining(['Copy address', 'Open wallet app']));
});
