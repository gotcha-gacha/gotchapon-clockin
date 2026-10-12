/**
 * The keyboard bridge's rules (W1.2, #124; plan §4.3), one by one, against a harness: the bridge is given spies for everything
 * it may call, and a real `keydown` is dispatched the way a browser does it (on the focused element, bubbling to the window).
 * What a press then DOES to a pull (one prepare, one commit, the 650 ms) is keyboard.web.test.tsx's, against the real page.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEscapeToClose, useKeyboardBridge } from '../useKeyboardBridge.web';
import type { KeyboardBridge } from '../useKeyboardBridge';
import type { Phase } from '../reducer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
const spies = { setPage: jest.fn(), openOdds: jest.fn(), autoCrank: jest.fn(() => true), openCapsule: jest.fn(), openPile: jest.fn() };
const base = (): KeyboardBridge => ({ enabled: true, phase: 'idle', canCrank: true, page: 1, pagerLocked: false, oddsOpen: false, ...spies });
function Harness({ b }: { b: KeyboardBridge }) { useKeyboardBridge(b); return null; }
const mount = async (over: Partial<KeyboardBridge> = {}) => { await act(async () => { root.render(<Harness b={{ ...base(), ...over }} />); }); };
const press = (key: string, init: KeyboardEventInit = {}, on: EventTarget = document.body) => { const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }); on.dispatchEvent(e); return e; };
const nothingHappened = () => { for (const s of Object.values(spies)) expect(s).not.toHaveBeenCalled(); };
/** Space, then enter, on a bridge mounted with `over`: every spy they reached, with its calls. */
const fired = async (over: Partial<KeyboardBridge>) => { for (const s of Object.values(spies)) s.mockClear(); await mount(over); press(' '); press('Enter'); return Object.entries(spies).filter(([, s]) => s.mock.calls.length).map(([n, s]) => [n, s.mock.calls] as const); };

beforeEach(() => { for (const s of Object.values(spies)) s.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); document.body.querySelectorAll('[data-test-extra]').forEach((n) => n.remove()); });

test('space and enter on an idle machine that may be cranked: one autoCrank each, and the page does not scroll', async () => {
  await mount();
  const e = press(' ');
  expect(spies.autoCrank).toHaveBeenCalledTimes(1);
  expect(e.defaultPrevented).toBe(true);
  press('Enter');
  expect(spies.autoCrank).toHaveBeenCalledTimes(2);
});

test('a machine the hand crank would not answer sends nothing: canCrank false (no funds, restocking, locked, a takeover up)', async () => {
  await mount({ canCrank: false });
  press(' '); press('Enter');
  nothingHappened();
  await mount({ canCrank: false, phase: 'coined' }); // the gate speaks for coined too (a takeover over a loaded burn)
  press(' ');
  nothingHappened();
});

test('the phase table: a turn from idle and coined, the capsule and the pile are opened, and every other phase does nothing', async () => {
  const did = async (phase: Phase) => (await fired({ phase })).map(([n, calls]) => `${n}×${calls.length}`);
  expect(await did('idle')).toEqual(['autoCrank×2']);
  expect(await did('coined')).toEqual(['autoCrank×2']);
  expect(await did('capsule')).toEqual(['openCapsule×2']); // the reducer takes the first CRACKED and ignores the second
  expect(await did('batchcaps')).toEqual(['openPile×2']);
  for (const phase of ['preparing', 'armed', 'committing', 'burning', 'card', 'spread', 'rolling', 'stopping', 'dropping'] as const) expect([phase, await did(phase)]).toEqual([phase, []]);
});

test('sealed: a key never retries a failed commit', async () => {
  await mount({ phase: 'sealed' });
  press(' '); press('Enter');
  nothingHappened();
});

test('a held key never acts, though it still must not scroll the page', async () => {
  await mount();
  const e = press(' ', { repeat: true });
  nothingHappened();
  expect(e.defaultPrevented).toBe(true);
});

test('off the Pull page the first press only goes to Pull, in every phase: no crank, and a capsule or pile waiting there stays shut', async () => {
  // canCrank stays true on purpose, so the page rule is the only thing that can stop the press.
  const every: Record<Phase, true> = { idle: true, preparing: true, armed: true, rolling: true, stopping: true, dropping: true, committing: true, capsule: true, card: true, batchcaps: true, spread: true, sealed: true, coined: true, burning: true };
  for (const page of [0, 2] as const) for (const phase of Object.keys(every) as Phase[]) {
    expect([page, phase, await fired({ page, phase })]).toEqual([page, phase, [['setPage', [[1], [1]]]]]);
  }
});

test('ignored: a modifier held, a text field, before sign-in and onboarding are done, and while a Modal is open', async () => {
  await mount();
  for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) { press(' ', mod); press('ArrowLeft', mod); press('o', mod); }
  nothingHappened();
  const input = Object.assign(document.createElement('input'), { }); input.setAttribute('data-test-extra', ''); document.body.appendChild(input); input.focus();
  press(' ', {}, input); press('Enter', {}, input); press('ArrowLeft', {}, input); press('o', {}, input);
  nothingHappened();
  input.blur();
  await mount({ enabled: false });
  press(' '); press('ArrowRight'); press('o');
  nothingHappened();
  await mount();
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('data-test-extra', ''); document.body.appendChild(modal);
  press(' '); press('Enter'); press('ArrowLeft'); press('o');
  nothingHappened();
});

test('focus on a control: space and enter are that control\'s press, not a $1 pull (by focusability, whatever its role)', async () => {
  await mount();
  for (const make of [() => document.createElement('button'), () => Object.assign(document.createElement('a'), { href: '#x' }), () => { const d = document.createElement('div'); d.setAttribute('role', 'tab'); d.tabIndex = 0; return d; }, () => { const d = document.createElement('div'); d.setAttribute('role', 'button'); d.tabIndex = 0; return d; }]) {
    const el = make(); el.setAttribute('data-test-extra', ''); document.body.appendChild(el); el.focus();
    const e = press(' ', {}, el); press('Enter', {}, el);
    expect(e.defaultPrevented).toBe(false); // the browser must still get to press it
  }
  nothingHappened();
  (document.activeElement as HTMLElement).blur();
  press(' ');
  expect(spies.autoCrank).toHaveBeenCalledTimes(1); // and with focus back on the page, the key is the machine's again
});

test('← and → change the page, inside 0..2, unless the pager is locked (a hand on the crank) or the odds sleeve is open; O does not open odds (#332)', async () => {
  await mount({ page: 1 });
  press('ArrowLeft'); press('ArrowRight');
  expect(spies.setPage.mock.calls).toEqual([[0], [2]]);
  spies.setPage.mockClear();
  await mount({ page: 0 }); press('ArrowLeft');
  await mount({ page: 2 }); press('ArrowRight');
  await mount({ pagerLocked: true }); press('ArrowLeft'); press('ArrowRight');
  await mount({ oddsOpen: true }); press('ArrowLeft');
  expect(spies.setPage).not.toHaveBeenCalled();
  await mount(); press('o'); press('O'); press('o', { repeat: true });
  expect(spies.openOdds).not.toHaveBeenCalled();
});

test('Escape is not the bridge\'s: react-native-web closes its own Modals, and a second handler would close two surfaces', async () => {
  await mount();
  press('Escape');
  nothingHappened();
});

test('useEscapeToClose: closes a surface that is not a Modal, but not while a Modal is open on top of it (that press is the Modal\'s)', async () => {
  const close = jest.fn();
  function Detail({ open }: { open: boolean }) { useEscapeToClose(open, close); return null; }
  await act(async () => { root.render(<Detail open />); });
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('data-test-extra', ''); document.body.appendChild(modal);
  press('Escape');
  expect(close).not.toHaveBeenCalled(); // the card sheet on top closes (RNW, on keyup); album detail stays
  modal.remove();
  press('Escape');
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => { root.render(<Detail open={false} />); });
  press('Escape');
  expect(close).toHaveBeenCalledTimes(1); // closed: it listens to nothing
});
