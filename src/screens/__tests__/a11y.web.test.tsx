/**
 * Keyboard and focus, the parts a DOM can show (W1.6, #139): the whole Home route by react-dom, on the in-app mock, walked
 * through sign-in → onboarding → a pull → the card → the sheets. At each stop every control must have a name (AC-3), and
 * what is drawn but is not in front must be inert. That the keys alone get a collector from sign-in to a card in the binder
 * (AC-1) is a browser's to prove (jsdom has no Tab and presses nothing on Enter): it is in the PR, from Chromium.
 * Animation frames are batched, one fake timer per frame (@/test/batchAnimationFrames), as in keyboard.web.test.tsx.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import Home from '@/screens/Home';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AUTO_TURN_MS } from '@/components/machine/Crank';
import { DROP_MS, ROLL_FLOOR_X5_MS, STOP_MS } from '@/ritual/rollTiming';
import { SessionProvider } from '@/state/session';
import { batchAnimationFrames } from '@/test/batchAnimationFrames';
import { controlCount, unnamedControls } from '@/test/unnamedControls';

jest.mock('@/audio/sfx', () => ({ playSfx: jest.fn(), crankSfx: () => 'tick', tierSfx: () => 'pop', scratchSfx: () => 'tick', dropSfx: () => 'tick', setSoundMuted: jest.fn(), setRollLoop: jest.fn() }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
const auth: { current: ReturnType<typeof useAuth> | null } = { current: null };
function Probe() { const a = useAuth(); useEffect(() => { auth.current = a; }); return null; }
const pass = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
// See keyboard.web.test.tsx. This walk also pulls ×5, whose floor is the longer one. The lock and the drop
// each arm when the pass that scheduled them ends, so they still need their own passes.
async function landShow() {
  await pass(ROLL_FLOOR_X5_MS + 80);
  await pass(STOP_MS + 40);
  await pass(DROP_MS + 40);
}
const press = async (key: string) => { await act(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); };
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); };
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`);
/** Every stop of the walk: nothing unnamed, and the walk saw controls at all. */
const named = (atLeast: number) => { expect(unnamedControls()).toEqual([]); expect(controlCount()).toBeGreaterThanOrEqual(atLeast); };

beforeEach(() => {
  jest.useFakeTimers(); batchAnimationFrames(); // one timer per frame, not one per running animation: see batchAnimationFrames.ts
  localStorage.clear(); mock!.dev.reset(); mock!.dev.creditFree(1);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { mock!.dev.forceTier(null); /* dev.reset() leaves a forced tier in place */ await act(async () => { root.unmount(); }); host.remove(); jest.restoreAllMocks(); jest.useRealTimers(); });

test('from sign-in to a card in the binder and through the sheets: every control has a name, and nothing behind takes focus', async () => {
  await act(async () => { root.render(<SafeAreaProvider><AuthProvider><SessionProvider><Probe /><Home /></SessionProvider></AuthProvider></SafeAreaProvider>); });
  await pass(200);
  named(2); // the first screen (#211): the CTA and the quiet way in. Privy is behind the sheet, so it is not a stop yet

  // The sheet on its own terms: it opens with the providers, and every control in it is named. What is behind it is kept out
  // of the tab order by react-native-web's own Modal, whose focus trap is a browser behaviour jsdom does not run — so this
  // asserts the dialog is there and named, and the trap itself is proven in a browser, not here (W1.6).
  await click([...document.querySelectorAll('[role="button"]')].find((b) => /Already collecting/.test(b.textContent ?? '')) ?? null);
  await pass(600);
  named(5); // Apple, Google, the email field, Send code, and the sheet's ✕
  expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();

  await act(async () => { auth.current!.signIn('Apple'); });
  await pass(4000);
  expect(document.body.textContent).toContain('Real trading cards');
  // The onboarding sheet is drawn over the app, not in a Modal. The app under it takes no focus and no press:
  const under = byLabel('Settings')!.closest('[inert]');
  expect(under).not.toBeNull();
  expect(under!.contains(document.querySelector('[data-testid="home-pager"]'))).toBe(true);
  expect(under!.contains(byLabel('Pull page'))).toBe(true); // the first keyboard run pressed a rail tab THROUGH the sheet (Albums is the current page now, #210, so Pull's tab is the one drawn behind)
  expect([...document.querySelectorAll('button')].find((b) => b.textContent === 'Skip')!.closest('[inert]')).toBeNull(); // the sheet itself is live
  named(2);

  await act(async () => { auth.current!.skipOnboarding(); });
  await pass(500);
  expect(byLabel('Settings')!.closest('[inert]')).toBeNull();
  // At rest only the page on screen is live. The app lands on the Binder (#210): Pull and Wallet, beside it, are not.
  const inertPages = () => [...document.querySelector('[data-testid="home-pager"]')!.firstElementChild!.children].map((c) => (c.firstElementChild as HTMLElement).hasAttribute('inert'));
  expect(inertPages()).toEqual([false, true, true]);
  await press('ArrowRight'); // to the machine, one page right, by the keyboard (W1.2)
  await pass(1000);
  expect(inertPages()).toEqual([true, false, true]);
  named(8); // header (daily, demo, settings, sound), the machine's chips and odds, the rail
  // Tab walks the document in order, so the order IS the tab order: header, then the page, then the rail (as they are seen).
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(before(byLabel('Settings')!, byLabel('Pull ×1')!)).toBe(true);
  expect(before(byLabel('Pull ×1')!, byLabel('Wallet page')!)).toBe(true);

  await press(' ');
  await pass(AUTO_TURN_MS + 80);
  await landShow();
  named(8); // a capsule is waiting
  await press(' ');
  await pass(6000);
  // The card is up, and the way on has the keyboard's focus without a Tab (AC-1's "through the focused Into binder control").
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Into binder');
  named(8);
  await click(document.activeElement);
  await pass(3000);
  expect(byLabel('Into binder')).toBeNull();

  await click(byLabel('Settings'));
  await pass(600);
  expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();
  named(11); // the account sheet: its ✕, four switches, sign out, delete (no Odds disclosure, #332)
  // A sheet opens with focus on its ✕. react-native-web's Modal focuses the first thing that will take it, and that used to be
  // the dimmed backdrop: a ring round the whole screen. The backdrop is a click target only now (Backdrop.web.tsx).
  // (jsdom does not run the Modal's focus trap the way a browser does, so this reads what the trap goes by: the first thing in
  // the sheet that can take focus. In Chromium the sheet was seen opening with focus on the ✕.)
  const stops = [...document.querySelector('[aria-modal="true"]')!.querySelectorAll('button, [tabindex]')].filter((el) => el.getAttribute('role') !== 'presentation');
  expect(stops[0].getAttribute('aria-label')).toBe('Close');
  await click(byLabel('Close'));
  await pass(600);
  expect(document.body.textContent).not.toContain('Odds per $1 pull');
  expect(byLabel('Odds disclosure')).toBeNull();
  expect(byLabel('Open odds')).toBeNull();
  expect(byLabel('View odds')).toBeNull();

  // A ×5: its Into binder is NOT there when the result bar appears (it waits until every card is flipped), and it must take
  // focus when it does: the bridge is inert on a spread, so a keyboard left on the body has nowhere to go but Tab.
  await click(byLabel('Demo data: add $10 of demo money. Not real money.'));
  await pass(600);
  mock!.dev.forceTier('holo'); // five rares, all face down: the mock's outcomes are random, and five commons flip at once (a flake, seen)
  await click(byLabel('Pull ×5'));
  await act(async () => { (document.activeElement as HTMLElement | null)?.blur(); });
  await press(' ');
  await pass(AUTO_TURN_MS + 80);
  await landShow();
  await press(' '); // the pile
  await pass(6000);
  named(8);
  expect(byLabel('Into binder')).toBeNull(); // cards still face down: the way on is not offered yet
  expect(document.activeElement).toBe(document.body);
  const flipAll = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Flip all');
  if (flipAll) await click(flipAll); else for (const card of document.querySelectorAll('[aria-label="Flip card"]')) await click(card);
  await pass(6000);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Into binder');
}, 30000); // the longest walk here: 8.1-8.9 s under one busy process per core (12); jest's 15 s would leave under 2x
