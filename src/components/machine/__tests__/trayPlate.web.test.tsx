// Web plate (#359): data-noswipe stays on the node, and only TOP UP is a pointer button.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TrayPlate } from '@/components/machine/TrayPlate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

const plate = () => host.querySelector('[data-testid="tray-plate"]') as HTMLElement;

test('TOP UP is a pointer button with data-noswipe, and the other lines are not', async () => {
  const onTopUp = jest.fn();
  await act(async () => { root.render(<TrayPlate phase="idle" balanceUsd={0} freePulls={0} onTopUp={onTopUp} />); });
  const topUp = plate();
  expect(topUp.dataset.noswipe).toBe('1');
  expect(topUp.getAttribute('role')).toBe('button');
  expect(topUp.style.cursor).toBe('pointer');
  expect(topUp.textContent).toContain('TOP UP · $1 A TURN');
  topUp.click();
  expect(onTopUp).toHaveBeenCalledTimes(1);

  await act(async () => { root.render(<TrayPlate phase="rolling" balanceUsd={0} freePulls={3} onTopUp={onTopUp} />); });
  const dispensing = plate();
  expect(dispensing.dataset.noswipe).toBe('1');
  expect(dispensing.getAttribute('role')).toBeNull();
  expect(dispensing.style.cursor).not.toBe('pointer');
  expect(dispensing.textContent).toContain('DISPENSING…');
  dispensing.click();
  expect(onTopUp).toHaveBeenCalledTimes(1);
});
