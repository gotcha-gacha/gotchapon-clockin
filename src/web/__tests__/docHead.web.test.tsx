// What the site's head declares (W2.2, #129). expo-router/head is stood in for by a pass-through, so what is read is what the
// component asks for; that it reaches the served HTML is read back from the export (the PR: every prerendered page).
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNavigationContainerRef, usePathname } from 'expo-router';
import { DocTitle, SiteHead } from '../DocHead.web';
import { SITE_DESCRIPTION } from '@/navigation/appPaths';

jest.mock('expo-router/head', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'head' }, children) }));
jest.mock('expo-router', () => ({ usePathname: jest.fn(() => '/'), useNavigationContainerRef: jest.fn(() => ({})) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });
// React 19 hoists <title> and <meta> into document.head, wherever they are rendered.
const meta = (sel: string) => (document.head.querySelector(sel) as HTMLMetaElement | null)?.getAttribute('content') ?? null;
const title = () => document.head.querySelector('title')?.textContent ?? null;

test('the site head: title, description, and the Open Graph and card tags a link preview reads', async () => {
  await act(async () => { root.render(<SiteHead />); });
  expect(title()).toBe('Gotchapon');
  expect([meta('meta[name="description"]'), meta('meta[property="og:description"]')]).toEqual([SITE_DESCRIPTION, SITE_DESCRIPTION]);
  expect([meta('meta[property="og:title"]'), meta('meta[property="og:type"]'), meta('meta[property="og:site_name"]'), meta('meta[name="twitter:card"]')]).toEqual(['Gotchapon', 'website', 'Gotchapon', 'summary']);
  expect(document.head.querySelector('meta[property="og:image"], meta[name="robots"]')).toBeNull(); // no image until W2.4; robots is +html's
});

test('/odds does not name the served page Odds (#332); the site title is the same on every path', async () => {
  jest.mocked(usePathname).mockReturnValue('/odds');
  await act(async () => { root.render(<SiteHead />); });
  expect([title(), meta('meta[property="og:title"]')]).toEqual(['Gotchapon', 'Gotchapon']);
  jest.mocked(usePathname).mockReturnValue('/oddsy');
  await act(async () => { root.render(<SiteHead key="b" />); });
  expect(title()).toBe('Gotchapon');
});

test('a page title, and noindex only when asked', async () => {
  await act(async () => { root.render(<DocTitle title="Wallet · Gotchapon" />); });
  expect([title(), document.head.querySelector('meta[name="robots"]')]).toEqual(['Wallet · Gotchapon', null]);
  await act(async () => { root.render(<DocTitle title="Not found · Gotchapon" noindex />); });
  expect(meta('meta[name="robots"]')).toBe('noindex');
});

test('with no router at all (a screen rendered bare), a page title draws nothing rather than throwing', async () => {
  jest.mocked(useNavigationContainerRef).mockReturnValue(undefined as never);
  await act(async () => { root.render(<DocTitle title="Wallet · Gotchapon" />); });
  expect(title()).toBeNull();
});
