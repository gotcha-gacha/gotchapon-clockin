// The web catch-all's one decision (W2.2, #129): the app at its own addresses, not-found elsewhere. From the route's OWN
// param, and once: with a sheet route on top the global address is `/odds` or `/card/:id`, and after mount the address only
// follows the app. Either way the app beneath must never be swapped out (a pull in progress would go with it).
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLocalSearchParams } from 'expo-router';
import AppRoute from '../AppRoute.web';

jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn() }));
jest.mock('@/screens/Home', () => ({ __esModule: true, default: () => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'home' }) }));
jest.mock('@/screens/NotFound', () => ({ NotFound: () => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'not-found' }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
/** The route's params, and the address bar they came from. */
const local = (path: string | string[] | undefined, address = Array.isArray(path) ? '/' + path.join('/') : '/') => { window.history.replaceState(null, '', address); jest.mocked(useLocalSearchParams).mockReturnValue(path === undefined ? {} : { path } as never); };
const drawn = () => (host.querySelector('[data-testid="home"]') ? 'home' : host.querySelector('[data-testid="not-found"]') ? 'not-found' : 'nothing');
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); window.history.replaceState(null, '', '/'); });

test('its own param decides: /pull is the app, /nope is not found, / is the app', async () => {
  local(['pull']);
  await act(async () => { root.render(<AppRoute />); });
  expect(drawn()).toBe('home');
  await act(async () => { root.unmount(); }); root = createRoot(host);
  local(['nope']);
  await act(async () => { root.render(<AppRoute />); });
  expect(drawn()).toBe('not-found');
  await act(async () => { root.unmount(); }); root = createRoot(host);
  local(undefined); // `/`
  await act(async () => { root.render(<AppRoute />); });
  expect(drawn()).toBe('home');
});

// W2.2's second review: the test above never set up a sheet on top, and a decision read from the address bar passed it.
// Here the route has no path of its own (the app is anchored beneath the sheet) while the address bar is the sheet's.
test('the app beneath a cold sheet address: no path of its own, and the address is the sheet\'s', async () => {
  for (const address of ['/odds', '/card/sv1-1']) {
    await act(async () => { root.unmount(); }); root = createRoot(host);
    local(undefined, address);
    await act(async () => { root.render(<AppRoute />); });
    expect([address, drawn()]).toEqual([address, 'home']);
  }
});

test('decided once: the same route instance never swaps the app out, whatever its param becomes', async () => {
  local(['pull']);
  await act(async () => { root.render(<AppRoute />); });
  const home = host.querySelector('[data-testid="home"]');
  local(['nope', 'deeper']);
  await act(async () => { root.render(<AppRoute />); });
  expect(host.querySelector('[data-testid="home"]')).toBe(home);
});

// W2.2's review: at `/`, `?path=nope` arrived as the route's `path` and the site root drew the not-found page.
test('a query named path is not the route\'s own: the site root is the app whatever it says', async () => {
  for (const [path, address] of [['nope', '/?path=nope'], [['binder', 'A', 'x'], '/?path=binder&path=A&path=x']] as const) {
    await act(async () => { root.unmount(); }); root = createRoot(host);
    local(path as string | string[], address);
    await act(async () => { root.render(<AppRoute />); });
    expect([address, drawn()]).toEqual([address, 'home']);
  }
  await act(async () => { root.unmount(); }); root = createRoot(host);
  local(['nope'], '/nope?path=pull'); // the route's own wins over the query
  await act(async () => { root.render(<AppRoute />); });
  expect(drawn()).toBe('not-found');
});
