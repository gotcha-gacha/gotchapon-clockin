// The one gate the hand crank and the keyboard share (W1.2, #124): every way a machine refuses a turn, and the one phase
// (coined: a burned pull is loaded) in which money and stock do not matter.
import { expect, test } from '@jest/globals';
import { canCrank, crankAffordable, type CrankGates } from '../canCrank';

const ok: CrankGates = { phase: 'idle', affordable: true, restocking: false, takeover: false, active: true };

test('an idle machine with funds, stock, no takeover, on screen: yes', () => {
  expect(canCrank(ok)).toBe(true);
});

test('each gate alone refuses: no funds and no free pulls, a restocking machine, the album-complete takeover, another page', () => {
  expect(canCrank({ ...ok, affordable: false })).toBe(false);
  expect(canCrank({ ...ok, restocking: true })).toBe(false);
  expect(canCrank({ ...ok, takeover: true })).toBe(false);
  expect(canCrank({ ...ok, active: false })).toBe(false);
});

test('a burned pull is free and already loaded: no balance and no stock still turn it, a takeover or another page still do not', () => {
  const coined: CrankGates = { ...ok, phase: 'coined', affordable: false, restocking: true };
  expect(canCrank(coined)).toBe(true);
  expect(canCrank({ ...coined, takeover: true })).toBe(false);
  expect(canCrank({ ...coined, active: false })).toBe(false);
});

test('the phase is not this gate\'s business beyond coined: a hand stays on a crank through preparing and armed', () => {
  for (const phase of ['preparing', 'armed'] as const) expect(canCrank({ ...ok, phase })).toBe(true);
});

test('a turn already under way stays affordable after its free pulls leave the counter', () => {
  expect(crankAffordable('idle', false)).toBe(false);
  expect(crankAffordable('idle', true)).toBe(true);
  expect(crankAffordable('preparing', false)).toBe(true);
  expect(crankAffordable('armed', false)).toBe(true);
  expect(crankAffordable('committing', false)).toBe(false);
});
