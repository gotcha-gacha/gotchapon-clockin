// Sheets as routes, at the session (W2.1, #128): with routing on, `openOdds` is a push and `closeOdds` (and a page change
// with the sleeve open) is one Back; the route says when the sleeve is actually shown. With routing off (native, a bare
// test) the sleeve is state, as before.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { router } from 'expo-router';
import { PAGE, SessionProvider, useSession } from '@/state/session';
import { deferSheet, oddsHref, openCardSheet, provideOddsClose, setSheetsRouted, takeDeferredSheet } from '../sheetRoutes';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() } }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
const s: { current: ReturnType<typeof useSession> | null } = { current: null };
function Probe() { const v = useSession(); useEffect(() => { s.current = v; }); return null; }
const push = jest.mocked(router.push); const back = jest.mocked(router.back);

beforeEach(async () => {
  push.mockClear(); back.mockClear(); setSheetsRouted(false);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<SessionProvider><Probe /></SessionProvider>); });
});
afterEach(async () => { setSheetsRouted(false); await act(async () => { root.unmount(); }); host.remove(); });

test('openOdds does not open a sleeve or push /odds (#332)', async () => {
  await act(async () => { s.current!.openOdds(); });
  expect([s.current!.oddsOpen, push.mock.calls.length]).toEqual([false, 0]);
  await act(async () => { s.current!.closeOdds(); });
  expect([s.current!.oddsOpen, back.mock.calls.length]).toEqual([false, 0]);
  setSheetsRouted(true);
  await act(async () => { s.current!.openOdds(); s.current!.openOdds(); });
  expect([s.current!.oddsOpen, push.mock.calls.length]).toEqual([false, 0]);
});

test('routing on: the sleeve is open only once something else says so; a close is the route’s own', async () => {
  setSheetsRouted(true);
  await act(async () => { s.current!.closeOdds(); });
  expect(back).not.toHaveBeenCalled(); // nothing shown, nothing to pop
  await act(async () => { s.current!.oddsShown(); });
  expect(s.current!.oddsOpen).toBe(true);
  push.mockClear();
  await act(async () => { s.current!.openOdds(); });
  expect(push).not.toHaveBeenCalled(); // #332: openOdds does not push
  const routeClose = jest.fn();
  const withdraw = provideOddsClose(routeClose);
  await act(async () => { s.current!.closeOdds(); });
  expect([routeClose.mock.calls.length, back.mock.calls.length]).toEqual([1, 0]); // the route's own guarded close, not a Back of the session's
  await act(async () => { s.current!.oddsHidden(); }); // the route unmounting
  withdraw();
  expect(s.current!.oddsOpen).toBe(false);
  await act(async () => { s.current!.closeOdds(); });
  expect([routeClose.mock.calls.length, back.mock.calls.length]).toEqual([1, 0]); // no route, nothing to close
});

test('routing on: a page change with the sleeve up closes it through the route', async () => {
  setSheetsRouted(true);
  const routeClose = jest.fn();
  const withdraw = provideOddsClose(routeClose);
  await act(async () => { s.current!.oddsShown(); });
  await act(async () => { s.current!.setPage(PAGE.wallet); });
  expect([routeClose.mock.calls.length, back.mock.calls.length, s.current!.page]).toEqual([1, 0, PAGE.wallet]);
  withdraw();
});

test('a deferred sheet is taken once', () => {
  expect(takeDeferredSheet()).toBeNull();
  deferSheet(oddsHref());
  expect(takeDeferredSheet()).toBe('/odds');
  expect(takeDeferredSheet()).toBeNull();
});

test('a card tapped in the binder: routed, a singular push of /card/:id (with the tier of a rare); not routed, the page\'s own sheet', () => {
  const inPage = jest.fn();
  openCardSheet('sv1-1', undefined, inPage);
  openCardSheet('sv1-1', 'common', inPage);
  expect([inPage.mock.calls, push.mock.calls.length]).toEqual([[['sv1-1', undefined], ['sv1-1', 'common']], 0]);
  setSheetsRouted(true);
  openCardSheet('sv1-1', undefined, inPage);
  openCardSheet('sv1-1', 'common', inPage); // a common named as one: no tier in its address either
  openCardSheet('sv1-2', 'holo', inPage);
  expect(inPage).toHaveBeenCalledTimes(2);
  expect(push.mock.calls).toEqual([
    [{ pathname: '/card/[cardId]', params: { cardId: 'sv1-1' } }, { dangerouslySingular: true }],
    [{ pathname: '/card/[cardId]', params: { cardId: 'sv1-1' } }, { dangerouslySingular: true }],
    [{ pathname: '/card/[cardId]', params: { cardId: 'sv1-2', tier: 'holo' } }, { dangerouslySingular: true }],
  ]);
});
