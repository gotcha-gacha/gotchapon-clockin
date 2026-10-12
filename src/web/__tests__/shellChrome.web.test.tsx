/**
 * The shell's chrome is its own chunk (W3.5, #142, AC-2): a page that opens phone-sized never asks for it, and one that is
 * widened past 768 asks then and draws it around the SAME app element. What the browser actually fetches is the network probe's
 * job (the PR's AC-2 row); this pins the decision. Each test loads the shell afresh: whether to ask at once is decided when the
 * module is evaluated, from the window it finds.
 */
import { afterEach, expect, jest, test } from '@jest/globals';
import type ReactT from 'react';
import type { Root } from 'react-dom/client';

jest.mock('expo-router', () => ({ usePathname: () => '/', useGlobalSearchParams: () => ({}) }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A fresh registry per page (jest.resetModules, not isolateModules: the shell's `import()` resolves AFTER the page is set up,
// and it must land in the same registry, on the same React as the renderer). The chrome module is counted when evaluated.
const mockChrome = { evaluated: 0, fail: false };
// Counted on every ask, a failed one included; `fail` makes the chunk's load reject, as a network blip or a stale hash does.
jest.mock('../ShellChrome.web', () => { mockChrome.evaluated++; if (mockChrome.fail) throw new Error('Loading module ShellChrome failed'); return jest.requireActual('../ShellChrome.web'); });
type Page = { R: typeof ReactT; root: Root; Shell: typeof import('../Shell.web').Shell };
let page: Page | null = null; let host: HTMLElement | null = null;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const act = (fn: () => void | Promise<void>) => page!.R.act(async () => { await fn(); });
const size = async (w: number, h: number) => { await act(() => { Object.assign(window, { innerWidth: w, innerHeight: h }); window.dispatchEvent(new Event('resize')); }); };
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

/** The shell, loaded as a page of this width would load it (`fail`: its chrome chunk will not load). */
function openPage(w: number, h: number, { fail = false }: { fail?: boolean } = {}): Page {
  Object.assign(window, { innerWidth: w, innerHeight: h });
  jest.resetModules();
  mockChrome.evaluated = 0; mockChrome.fail = fail;
  /* eslint-disable @typescript-eslint/no-require-imports -- loaded into the registry resetModules just made, in this order, so
     the shell's hooks run on the renderer's own React; an import would be hoisted above the reset */
  const R = require('react') as typeof ReactT;
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { Shell } = require('../Shell.web') as typeof import('../Shell.web');
  /* eslint-enable @typescript-eslint/no-require-imports */
  host = document.createElement('div'); document.body.appendChild(host);
  page = { R, root: createRoot(host), Shell };
  return page;
}
const evaluated = () => mockChrome.evaluated;
const render = (p: Page) => act(() => { p.root.render(p.R.createElement(p.Shell, { ready: true, children: p.R.createElement('div', { 'data-testid': 'app' }) })); });

afterEach(async () => { if (page) await act(() => { page!.root.unmount(); }); host?.remove(); page = null; host = null; });

test('a page that opens phone-sized never asks for the chrome; widened past 768 it asks once and draws it around the same app', async () => {
  await render(openPage(390, 844));
  await settle();
  expect(q('[data-shell]')!.dataset.tier).toBe('mobile');
  expect(evaluated()).toBe(0);
  expect(q('[data-chrome]')).toBeNull();
  const app = q('[data-testid="app"]');
  await size(1440, 900);
  await settle();
  expect(evaluated()).toBe(1);
  expect(q('[data-chrome]')).not.toBeNull(); // the room, from the chunk
  expect(q('[data-testid="shell-footer"]')).not.toBeNull();
  expect(q('[data-testid="app"]')).toBe(app); // the app never waited on it, and never remounted for it
  await size(390, 844); await size(1440, 900); await settle();
  expect(evaluated()).toBe(1); // asked once for the life of the page
});

test('a page that opens wide asks for the chrome as the shell loads, before anything renders', async () => {
  openPage(1440, 900);
  await settle();
  expect(evaluated()).toBe(1);
});

// PR #170's review: with each part a React.lazy and no error boundary above the shell, a chunk that failed to load unmounted
// the whole root, a pull at its capsule with it.
test('a chrome chunk that fails to load leaves the app running with nothing around it; the next widen asks again and draws it', async () => {
  const page = openPage(390, 844);
  mockChrome.fail = true;
  await render(page); await settle();
  const app = q('[data-testid="app"]');
  await size(1440, 900); await settle();
  expect(evaluated()).toBe(1);
  expect(q('[data-chrome]')).toBeNull();
  expect(q('[data-testid="app"]')).toBe(app); // the root did not go down
  mockChrome.fail = false;
  await size(390, 844); await size(1440, 900); await settle();
  expect(evaluated()).toBe(2); // the failure was not kept
  expect(q('[data-chrome]')).not.toBeNull();
  expect(q('[data-testid="app"]')).toBe(app);
});

// PR #170's second review: the preload a wide page makes as the shell loads had no handler in round 1's shape (`void
// loadChrome()`), so a chunk that failed before the shell mounted was an unhandled rejection. What catches that here is the
// runner: jest-circus fails the running test on any unhandled rejection (the test's `process` is jest's copy, which Node never
// emits on, so a listener there would see nothing). Round 1's shape fails this test with "Loading module ShellChrome failed".
test('a page that opens wide while its chrome chunk fails runs the app with nothing around it, and leaves no rejection unhandled', async () => {
  await render(openPage(1440, 900, { fail: true }));
  await settle();
  expect(evaluated()).toBeGreaterThan(0); // it did ask
  expect(q('[data-chrome]')).toBeNull();
  expect(q('[data-testid="app"]')).not.toBeNull();
});
