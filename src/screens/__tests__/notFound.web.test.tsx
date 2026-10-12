// The not-found page (W2.2, #129): its title, its noindex, and the way back to the machine: on the web a page load of `/`,
// never the router in place (it left the dead address in the bar, seen).
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { goHome, NotFound } from '../NotFound';
import { useNotFoundShown } from '@/navigation/notFoundShown';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/web/DocHead', () => ({ DocTitle: ({ title, noindex }: { title: string; noindex?: boolean }) => jest.requireActual<typeof import('react')>('react').createElement('div', { 'data-testid': 'doc-title', 'data-title': title, 'data-noindex': String(!!noindex) }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
beforeEach(() => { mockReplace.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

test('titled "Not found", kept out of search engines, one button back', async () => {
  await act(async () => { root.render(<SafeAreaProvider><NotFound /></SafeAreaProvider>); });
  const t = host.querySelector('[data-testid="doc-title"]') as HTMLElement;
  expect([t.dataset.title, t.dataset.noindex]).toEqual(['Not found · Gotchapon', 'true']);
  expect(host.textContent).toContain('Nothing at this address');
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Go to the machine']);
});

test('the way back is a page load of / on the web, not the router', () => {
  const load = jest.fn();
  goHome(mockReplace, load);
  expect([load.mock.calls, mockReplace.mock.calls]).toEqual([[['/']], []]);
});

// #169: the QR of the page reads this instead of classifying the address itself.
test('while it is mounted the page says it is showing, and stops saying so when it goes', async () => {
  const seen: boolean[] = [];
  function Probe() { seen.push(useNotFoundShown()); return null; }
  await act(async () => { root.render(<SafeAreaProvider><Probe /></SafeAreaProvider>); });
  expect(seen.at(-1)).toBe(false);
  await act(async () => { root.render(<SafeAreaProvider><Probe /><NotFound /></SafeAreaProvider>); });
  expect(seen.at(-1)).toBe(true);
  await act(async () => { root.render(<SafeAreaProvider><Probe /></SafeAreaProvider>); });
  expect(seen.at(-1)).toBe(false);
});
