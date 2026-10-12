// AC-3 of W2.2 (#129), where it can break in source: the site's head is only in the served HTML because the root layout
// draws it OUTSIDE the fonts gate (the export renders the layout before any font has loaded, so nothing inside the gate is in
// the page). Rendered here as the export renders it: fonts not in, the app not mounted, and the head already there.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import RootLayout from '@/app/_layout';

jest.mock('@/theme/fonts', () => ({ useAppFonts: () => [false, null], font: { black: 'x', bold: 'x', extrabold: 'x', semibold: 'x' } }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: () => Promise.resolve(), hideAsync: () => Promise.resolve() }));
jest.mock('expo-router', () => ({ Stack: Object.assign(() => null, { Screen: () => null }), usePathname: () => '/' }));
jest.mock('expo-router/head', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => jest.requireActual<typeof import('react')>('react').createElement(jest.requireActual<typeof import('react')>('react').Fragment, null, children) }));
jest.mock('@/web/Shell', () => ({ Shell: ({ children }: { children: React.ReactNode }) => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'shell' }, children) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

test('fonts not in, app not mounted: the title, the description and the Open Graph tags are already in the head', async () => {
  await act(async () => { root.render(<RootLayout />); });
  expect(host.querySelector('[data-testid="shell"]')!.childElementCount).toBe(0); // the app is not drawn yet: only the head, hoisted out
  expect(document.head.querySelector('title')?.textContent).toBe('Gotchapon');
  for (const sel of ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:type"]', 'meta[name="twitter:card"]']) expect([sel, !!document.head.querySelector(sel)]).toEqual([sel, true]);
});
