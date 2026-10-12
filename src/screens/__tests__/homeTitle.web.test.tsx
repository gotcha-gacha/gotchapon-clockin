// AC-1 of W2.2 (#129), the wiring: the tab's title Home asks for on each page (W2.2's review: every title-wiring mutant
// survived; only the browser saw them). expo-router's Head stands in as a pass-through; React 19 hoists the <title> it renders
// into document.head, so `document.title` is what a tab would show.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Home from '@/screens/Home';
import { useSession } from '@/state/session';
import { useActiveTab } from '@/state/activeTab';
import { useAuth } from '@/auth/AuthProvider';

// `useSegments`: the catch-all on top, as the real router answers for a page (the URL hook reads the route from it, PR #171).
jest.mock('expo-router', () => ({ useNavigationContainerRef: () => ({ isReady: () => false }), usePathname: () => '/', useSegments: () => ['[...path]'], useRouter: () => ({ setParams: jest.fn() }), useGlobalSearchParams: () => ({}), router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('expo-router/head', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => jest.requireActual<typeof import('react')>('react').createElement(jest.requireActual<typeof import('react')>('react').Fragment, null, children) }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/state/session', () => ({ PAGES: ['Albums', 'Pull', 'Wallet'], PAGE: { albums: 0, pull: 1, wallet: 2 }, LANDING_PAGE: 0, useSession: jest.fn() }));
jest.mock('@/state/activeTab', () => ({ useActiveTab: jest.fn() }));
jest.mock('@/components/HomePager', () => ({ HomePager: () => null }));
jest.mock('@/components/HeaderOverlay', () => ({ HeaderOverlay: () => null }));
jest.mock('@/components/PageDots', () => ({ PageDots: () => null }));
jest.mock('@/screens/Onboarding', () => ({ Onboarding: () => null }));
jest.mock('@/screens/FirstScreen', () => ({ FirstScreen: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const albums = [{ id: 'A', title: 'Little Lanterns', cards: [] }, { id: 'B', title: 'Tidepool Friends', cards: [] }];
const session = (s: object) => jest.mocked(useSession).mockReturnValue({ ready: true, error: null, me: { country: 'MY' }, refresh: jest.fn(), oddsOpen: false, openOdds: jest.fn(), closeOdds: jest.fn(), reloadKept: jest.fn(), closeAlbum: jest.fn(), setPage: jest.fn(), albums, page: 1, albumOpen: null, ...s } as unknown as ReturnType<typeof useSession>);
const signedIn = (stage = 'done') => jest.mocked(useAuth).mockReturnValue({ stage, ready: true } as unknown as ReturnType<typeof useAuth>);
let root: Root; let host: HTMLElement;
const title = async () => { await act(async () => { root.render(<SafeAreaProvider><Home /></SafeAreaProvider>); }); return document.head.querySelector('title')?.textContent ?? null; };
beforeEach(() => { jest.mocked(useActiveTab).mockReturnValue({ role: 'active', takeOver: jest.fn() }); signedIn(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

test('each page names itself; an open binder names its album; the Wallet page ignores a binder left open', async () => {
  const cases: [object, string][] = [
    [{ page: 1 }, 'Pull · Gotchapon'],
    [{ page: 0 }, 'Albums · Gotchapon'],
    [{ page: 0, albumOpen: 'B' }, 'Tidepool Friends · Gotchapon'],
    [{ page: 0, albumOpen: 'nope' }, 'Albums · Gotchapon'],
    [{ page: 2 }, 'Wallet · Gotchapon'],
    [{ page: 2, albumOpen: 'B' }, 'Wallet · Gotchapon'],
  ];
  for (const [s, want] of cases) { session(s); expect([JSON.stringify(s), await title()]).toEqual([JSON.stringify(s), want]); }
});

test('onboarding: the site alone; signed out Home asks for no title at all (the site head’s stands)', async () => {
  session({ page: 0, albumOpen: 'A' });
  signedIn('onboarding');
  expect(await title()).toBe('Gotchapon');
  await act(async () => { root.unmount(); }); root = createRoot(host);
  signedIn('idle');
  expect(await title()).toBeNull();
});
