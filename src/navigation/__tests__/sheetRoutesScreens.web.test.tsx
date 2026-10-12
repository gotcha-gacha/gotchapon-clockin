// The two sheet routes (W2.1, #128), each rendered by react-dom with the router and the session stood in for, and the app
// gate (what Home says it draws, appGate.ts) set by hand. What is under test is the route's own decisions: when it draws the
// sheet, what it tells the session, and when it steps back (once) and whether it leaves itself for later.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLocalSearchParams, useNavigationContainerRef, useRouter } from 'expo-router';
import { PAGE, useSession } from '@/state/session';
import CardRoute from '@/app/card/[cardId]';
import OddsRoute from '@/app/odds';
import { setAppGate, type AppGate } from '../appGate';
import { takeDeferredSheet } from '../sheetRoutes';

const back = jest.fn();
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn(), useNavigationContainerRef: jest.fn(() => undefined), router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('expo-router/head', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => jest.requireActual<typeof import('react')>('react').createElement(jest.requireActual<typeof import('react')>('react').Fragment, null, children) }));
jest.mock('@/state/session', () => ({ PAGE: { albums: 0, pull: 1, wallet: 2 }, useSession: jest.fn() }));
jest.mock('@/components/odds/OddsSheet', () => ({ OddsSheet: ({ onClose }: { onClose: () => void }) => jest.requireActual<typeof import('react')>('react').createElement('button', { 'data-testid': 'odds-sheet', onClick: onClose }, 'odds') }));
jest.mock('@/components/albums/CardDetailSheet', () => ({ CardDetailSheet: (p: { holding: { cardId: string } | null; album: { id: string } | null; onClose: () => void }) => p.holding ? jest.requireActual<typeof import('react')>('react').createElement('button', { 'data-testid': 'card-sheet', 'data-card': p.holding.cardId, 'data-album': p.album?.id ?? '', onClick: p.onClose }, 'card') : null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = { id: 'sv1-1', name: 'Blitzle', set: 'sv1', number: '1', imgSmall: '', imgLarge: '' };
const albums = [{ id: 'A', title: 'Little Lanterns', cards: [{ id: 'sv1-1', slot: 1 }] }, { id: 'B', title: 'Tidepool', cards: [{ id: 'sv2-9', slot: 1 }] }];
const spies = { setPage: jest.fn(), openAlbum: jest.fn(), oddsShown: jest.fn(), oddsHidden: jest.fn(), closeOdds: jest.fn() };
const session = (over: object = {}) => jest.mocked(useSession).mockReturnValue({ albums, holdings: { 'sv1-1': { cardId: 'sv1-1', qty: 1, card } }, odds: null, ready: true, page: PAGE.pull, albumOpen: null, ...spies, ...over } as unknown as ReturnType<typeof useSession>);
const params = (p: object) => jest.mocked(useLocalSearchParams).mockReturnValue(p as never);
const gate = async (g: AppGate) => { await act(async () => { setAppGate(g); }); };

let root: Root; let host: HTMLElement;
const mount = async (ui: React.ReactElement) => { await act(async () => { root.render(ui); }); };
const drawn = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
beforeEach(async () => {
  for (const s of Object.values(spies)) s.mockClear(); back.mockClear(); takeDeferredSheet(); setAppGate('show');
  jest.mocked(useRouter).mockReturnValue({ back, push: jest.fn() } as unknown as ReturnType<typeof useRouter>);
  session(); params({ cardId: 'sv1-1' });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); setAppGate('wait'); });

test('/odds draws no sleeve and steps back once, and is not left to reopen (#332)', async () => {
  await mount(<OddsRoute />);
  expect([drawn('odds-sheet'), spies.oddsShown.mock.calls.length, back.mock.calls.length, takeDeferredSheet()]).toEqual([null, 0, 1, null]);
  expect(host.textContent).not.toContain('Odds per $1 pull');
});

test('/odds while the app is not up, or cannot be shown: one Back, and it is not left for later', async () => {
  for (const g of ['wait', 'never'] as const) {
    await act(async () => { root.unmount(); }); root = createRoot(host);
    back.mockClear(); spies.oddsShown.mockClear(); takeDeferredSheet();
    await gate(g);
    await mount(<OddsRoute />);
    expect([g, drawn('odds-sheet'), back.mock.calls.length, takeDeferredSheet()]).toEqual([g, null, 1, null]);
  }
});

test('/card/:id with the app up, a card that is held: the sheet over ITS binder (the page and the album are set), close is Back', async () => {
  await mount(<CardRoute />);
  const sheet = drawn('card-sheet')!;
  expect([sheet.dataset.card, sheet.dataset.album]).toEqual(['sv1-1', 'A']);
  expect([spies.setPage.mock.calls, spies.openAlbum.mock.calls, back.mock.calls.length]).toEqual([[[PAGE.albums]], [['A']], 0]);
  await act(async () => { sheet.click(); });
  await act(async () => { sheet.click(); });
  expect(back).toHaveBeenCalledTimes(1); // twice pressed, one Back
  expect(spies.oddsShown).not.toHaveBeenCalled(); // a card is not the odds sleeve
});

test('/card/:id already on that binder: nothing is set twice; a rare on the shelf gets no slot album but the same binder', async () => {
  session({ page: PAGE.albums, albumOpen: 'A', holdings: { 'sv1-1': { cardId: 'sv1-1', qty: 1, card }, 'sv1-1#holo': { cardId: 'sv1-1', qty: 1, card, rarity: 'holo' } } });
  params({ cardId: 'sv1-1', tier: 'holo' });
  await mount(<CardRoute />);
  const sheet = drawn('card-sheet')!;
  expect([sheet.dataset.card, sheet.dataset.album]).toEqual(['sv1-1', '']);
  expect([spies.setPage.mock.calls.length, spies.openAlbum.mock.calls.length]).toEqual([0, 0]);
});

test('/card/:id for a card nobody holds: once the holdings are in, one Back and no binder opened; before they are in, it waits', async () => {
  session({ ready: false, holdings: {} });
  await mount(<CardRoute />);
  expect([drawn('card-sheet'), back.mock.calls.length]).toEqual([null, 0]);
  session({ ready: true, holdings: {} });
  await mount(<CardRoute />);
  expect([back.mock.calls.length, spies.openAlbum.mock.calls.length]).toEqual([1, 0]);
});

test('/card/:id before the app is up: one Back, and it is left for later, tier and all; an unknown tier reads as a common', async () => {
  await gate('wait'); params({ cardId: 'sv1-1', tier: 'holo' });
  await mount(<CardRoute />);
  expect([drawn('card-sheet'), back.mock.calls.length]).toEqual([null, 1]);
  expect(takeDeferredSheet()).toEqual({ pathname: '/card/[cardId]', params: { cardId: 'sv1-1', tier: 'holo' } });
  await act(async () => { root.unmount(); }); root = createRoot(host);
  params({ cardId: 'sv1-1', tier: 'shiny' });
  await mount(<CardRoute />);
  expect(takeDeferredSheet()).toEqual({ pathname: '/card/[cardId]', params: { cardId: 'sv1-1' } });
});

// W2.2 (#129): a sheet that is on screen names the tab. /odds no longer draws a sleeve (#332), so it names nothing.
test('the card sheet names the tab; /odds does not name it Odds', async () => {
  jest.mocked(useNavigationContainerRef).mockReturnValue({} as never);
  const title = () => document.head.querySelector('title')?.textContent ?? null;
  await mount(<OddsRoute />);
  expect(title()).toBeNull();
  await act(async () => { root.unmount(); }); root = createRoot(host);
  await mount(<CardRoute />);
  expect(title()).toBe('Blitzle · Gotchapon');
  jest.mocked(useNavigationContainerRef).mockReturnValue(undefined as never);
});
