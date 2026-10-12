// What Home publishes for the sheet routes over it (W2.1, #128; PR #165's review), and the one guard that keeps a routed
// sleeve from being drawn twice: when the sheets are routes, Home does not draw its own.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Home from '@/screens/Home';
import { useSession } from '@/state/session';
import { useActiveTab } from '@/state/activeTab';
import { useAuth } from '@/auth/AuthProvider';
import { currentAppGate, setAppGate } from '@/navigation/appGate';
import { setSheetsRouted } from '@/navigation/sheetRoutes';

jest.mock('@/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/state/session', () => ({ PAGES: ['Albums', 'Pull', 'Wallet'], PAGE: { albums: 0, pull: 1, wallet: 2 }, LANDING_PAGE: 0, useSession: jest.fn() }));
jest.mock('@/state/activeTab', () => ({ useActiveTab: jest.fn() }));
jest.mock('@/components/HomePager', () => ({ HomePager: () => null }));
jest.mock('@/components/HeaderOverlay', () => ({ HeaderOverlay: () => null }));
jest.mock('@/components/PageDots', () => ({ PageDots: () => null }));
jest.mock('@/components/AccountSheet', () => ({ AccountSheet: () => null }));
jest.mock('@/components/odds/OddsSheet', () => ({ OddsSheet: () => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'inline-sleeve' }) }));
jest.mock('@/screens/Onboarding', () => ({ Onboarding: () => null }));
jest.mock('@/screens/FirstScreen', () => ({ FirstScreen: () => null }));
jest.mock('@/components/OtherTabCard', () => ({ OtherTabCard: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const closeAlbum = jest.fn();
const setPage = jest.fn();
const session = (s: object = {}) => jest.mocked(useSession).mockReturnValue({ ready: true, error: null, me: { country: 'MY' }, refresh: jest.fn(), oddsOpen: false, openOdds: jest.fn(), closeOdds: jest.fn(), reloadKept: jest.fn(), closeAlbum, setPage, ...s } as unknown as ReturnType<typeof useSession>);
const as = (stage: string, role: 'deciding' | 'active' | 'other') => { jest.mocked(useAuth).mockReturnValue({ stage, ready: true } as unknown as ReturnType<typeof useAuth>); jest.mocked(useActiveTab).mockReturnValue({ role, takeOver: jest.fn() }); };
let root: Root; let host: HTMLElement;
const mount = async () => { await act(async () => { root.render(<SafeAreaProvider><Home /></SafeAreaProvider>); }); };
beforeEach(() => { closeAlbum.mockClear(); setPage.mockClear(); setAppGate('wait'); setSheetsRouted(false); session(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); setSheetsRouted(false); });

test('Home publishes what it draws: show with the app up; wait while it is coming; never for another tab or a closed country', async () => {
  const cases: [string, 'deciding' | 'active' | 'other', object, string][] = [
    ['done', 'active', {}, 'show'], ['idle', 'active', {}, 'wait'], ['onboarding', 'active', {}, 'wait'], ['done', 'deciding', {}, 'wait'],
    ['done', 'other', {}, 'never'], ['done', 'active', { me: { country: 'JP' } }, 'never'], ['done', 'active', { error: { code: 'GEO_BLOCKED', message: '' } }, 'never'],
  ];
  for (const [stage, role, s, want] of cases) {
    as(stage, role); session(s);
    await mount();
    expect([stage, role, JSON.stringify(s), currentAppGate()]).toEqual([stage, role, JSON.stringify(s), want]);
  }
  await act(async () => { root.unmount(); }); root = createRoot(host);
  expect(currentAppGate()).toBe('wait'); // Home gone: nothing shows over it
});

test('the odds sleeve is not drawn, even when the session says it is open (#332)', async () => {
  as('done', 'active'); session({ oddsOpen: true });
  await mount();
  expect(host.querySelector('[data-testid="inline-sleeve"]')).toBeNull();
  setSheetsRouted(true);
  await act(async () => { root.render(<SafeAreaProvider><Home key="routed" /></SafeAreaProvider>); });
  expect(host.querySelector('[data-testid="inline-sleeve"]')).toBeNull();
});

test('signing out closes the open binder, which now outlives the Albums page in the session', async () => {
  as('done', 'active'); await mount();
  expect(closeAlbum).not.toHaveBeenCalled();
  expect(setPage).not.toHaveBeenCalled();
  as('idle', 'active'); await mount();
  expect(closeAlbum).toHaveBeenCalledTimes(1);
  expect(setPage).toHaveBeenCalledWith(0); // …and puts the track back on the landing page, the Binder (#210)
});

// The other road to `idle`: a sign-in that failed. It must leave the address alone, or a visitor who opened `/wallet`, was
// refused once and then got in lands on the Binder with their link gone — the boot has already latched (#210, review).
test('a sign-in that fails leaves the open binder and the track where they were', async () => {
  as('idle', 'active'); await mount();        // signed out, on the sign-in screen
  as('busy', 'active'); await mount();        // Continue with Apple
  as('idle', 'active'); await mount();        // /me refused: back to the card, with the error
  expect(closeAlbum).not.toHaveBeenCalled();
  expect(setPage).not.toHaveBeenCalled();
  as('done', 'active'); await mount();        // the retry lands: still nothing reset
  expect(setPage).not.toHaveBeenCalled();
});
