/**
 * A component rendered by react-dom in jsdom, through react-native-web (W0.4, #122): the proof that the web jest project can
 * load this repo's components (the worklets resolver, babel-preset-expo with the web caller, platform file resolution), so the
 * pager, storage and keyboard tests that follow have somewhere to run. It reads the DOM a browser would get, not a test tree.
 */
import { afterEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PageDots, railHeight } from '@/components/PageDots';
import { useSession } from '@/state/session';

jest.mock('@/state/session', () => ({
  PAGES: ['Albums', 'Pull', 'Wallet'],
  PAGE: { albums: 0, pull: 1, wallet: 2 },
  useSession: jest.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
async function mount(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(ui); });
  return host;
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

test('the rail renders as DOM: three labelled buttons, the current page marked, and a click navigates', async () => {
  const setPage = jest.fn();
  jest.mocked(useSession).mockReturnValue({ page: 1, setPage, newCards: 0, pagerLocked: false } as unknown as ReturnType<typeof useSession>);
  // A real provider: the web project loads none of jest.setup.ts, so safe-area-context is not mocked here. On the web it reports
  // zero insets synchronously on mount, which is all the rail reads.
  const dom = await mount(<SafeAreaProvider><PageDots /></SafeAreaProvider>);
  const labels = [...dom.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label'));
  expect(labels).toEqual(['Albums page', 'Pull page, current', 'Wallet page']); // exactly three, and the current page is carried by its label
  const albums = dom.querySelector('[aria-label="Albums page"]') as HTMLElement;
  // react-native-web writes accessibilityRole into the DOM: the rail's Pressables are role="tab", focusable, and not "button".
  // The keyboard bridge (W1.2, #124) must treat every focusable control as one that owns space / enter, not only role="button".
  expect(albums.getAttribute('role')).toBe('tab');
  expect(albums.tabIndex).toBe(0);
  await act(async () => { albums.click(); });
  expect(setPage).toHaveBeenCalledWith(0);
});

test('the swipe line is not drawn above the tabs, and a tap still changes the page (#327)', async () => {
  const setPage = jest.fn();
  jest.mocked(useSession).mockReturnValue({ page: 2, setPage, newCards: 0, pagerLocked: false } as unknown as ReturnType<typeof useSession>);
  const dom = await mount(<SafeAreaProvider><PageDots /></SafeAreaProvider>);
  const text = dom.textContent ?? '';
  expect(text).not.toMatch(/SWIPE TO EXPLORE/);
  expect(text).not.toMatch(/\u2194/);
  expect(dom.querySelector('[aria-label="Wallet page, current"]')).not.toBeNull();
  expect(dom.querySelector('[aria-label="Albums page"]')).not.toBeNull();
  const pull = dom.querySelector('[aria-label="Pull page"]') as HTMLElement;
  await act(async () => { pull.click(); });
  expect(setPage).toHaveBeenCalledWith(1);
  // Phone reserves 14pt for the line (railHeight(0) === 86). Web omits it: pad 5 + tab 58 + under 8 + hairline 1.
  expect(railHeight(0)).toBe(72);
  expect(railHeight(34)).toBe(railHeight(0) + 34);
});

test('the page icons are aria-hidden and do not leak RN accessibility props onto the svg', async () => {
  const errors: string[] = [];
  const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  try {
    jest.mocked(useSession).mockReturnValue({ page: 1, setPage: jest.fn(), newCards: 0, pagerLocked: false } as unknown as ReturnType<typeof useSession>);
    const dom = await mount(<SafeAreaProvider><PageDots /></SafeAreaProvider>);
    const svgs = [...dom.querySelectorAll('svg')];
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      // react-native-svg forwards unknown props onto the DOM node. These two are not attributes.
      expect(svg.hasAttribute('accessibilityelementshidden')).toBe(false);
      expect(svg.hasAttribute('importantforaccessibility')).toBe(false);
      expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    const leaked = errors.filter((line) => /accessibilityElementsHidden|importantForAccessibility/.test(line));
    expect(leaked).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});
