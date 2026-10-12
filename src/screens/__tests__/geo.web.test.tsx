/**
 * AC-4 of W0.3 (#121): on the web a closed country still gets the geo-block screen, and no machine is reachable. Nothing new
 * is built for geo (plan §7.14): this is the existing gate in `src/app/index.tsx`, rendered by react-dom, with the machine
 * stood in for by a marker so "no crank" is something the test can see. The open country is the control: there the marker shows.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Home from '@/screens/Home';
import { useSession } from '@/state/session';
import { useActiveTab } from '@/state/activeTab';
import { runShellCommand } from '@/state/shellCommands';

jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ stage: 'done', error: null, ready: true }) }));
jest.mock('@/state/session', () => ({ PAGES: ['Albums', 'Pull', 'Wallet'], PAGE: { albums: 0, pull: 1, wallet: 2 }, useSession: jest.fn() }));
// This tab is the active one (W0.2b, #136): the gate under test comes after the one-active-tab gate, which has its own tests.
jest.mock('@/state/activeTab', () => ({ useActiveTab: jest.fn() }));
jest.mock('@/components/HomePager', () => ({ HomePager: () => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'machine' }) }));
jest.mock('@/components/HeaderOverlay', () => ({ HeaderOverlay: () => null }));
jest.mock('@/components/PageDots', () => ({ PageDots: () => null }));
jest.mock('@/components/AccountSheet', () => ({ AccountSheet: () => null }));
jest.mock('@/components/odds/OddsSheet', () => ({ OddsSheet: () => null }));
jest.mock('@/screens/Onboarding', () => ({ Onboarding: () => null }));
jest.mock('@/screens/FirstScreen', () => ({ FirstScreen: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const openOdds = jest.fn();
const session = (s: object) => jest.mocked(useSession).mockReturnValue({ ready: true, error: null, refresh: jest.fn(), oddsOpen: false, openOdds, closeOdds: jest.fn(), reloadKept: jest.fn(), ...s } as unknown as ReturnType<typeof useSession>);
const mount = async () => { await act(async () => { root.render(<SafeAreaProvider><Home /></SafeAreaProvider>); }); };
const machine = () => host.querySelector('[data-testid="machine"]');

beforeEach(() => { openOdds.mockClear(); jest.mocked(useActiveTab).mockReturnValue({ role: 'active', takeOver: jest.fn() }); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

test('an open country: the machine is there (the control for the two below)', async () => {
  session({ me: { country: 'MY' } });
  await mount();
  expect(machine()).not.toBeNull();
  expect(host.textContent).not.toContain('Not available');
  expect([runShellCommand('odds'), openOdds.mock.calls.length]).toEqual([false, 0]); // #332: Home no longer offers the sleeve
});

test('/me names a closed country: the geo-block screen, and no machine in the page at all', async () => {
  session({ me: { country: 'JP' } });
  await mount();
  expect(host.textContent).toContain('Not available in Japan');
  expect(host.textContent).toContain('Nothing has been charged.');
  expect(machine()).toBeNull();
  expect([runShellCommand('odds'), openOdds.mock.calls.length]).toEqual([false, 0]); // and not here: there is no sleeve to open (PR #160's review)
});

test("the server's GEO_BLOCKED on a read closes it too, whatever the profile says", async () => {
  session({ me: { country: 'MY' }, error: { code: 'GEO_BLOCKED', message: '' } });
  await mount();
  expect(host.textContent).toContain('Not available');
  expect(machine()).toBeNull();
});

// W1.5 (#127), PR #160's review: the footer's Odds is offered only by a Home that can draw the sleeve. Signed in and past
// onboarding, but not the active tab: the other-tab card, no machine, and nothing on offer.
test('a tab that is not the active one offers the shell nothing', async () => {
  jest.mocked(useActiveTab).mockReturnValue({ role: 'other', takeOver: jest.fn() });
  session({ me: { country: 'MY' } });
  await mount();
  expect(machine()).toBeNull();
  expect([runShellCommand('odds'), openOdds.mock.calls.length]).toEqual([false, 0]);
});
