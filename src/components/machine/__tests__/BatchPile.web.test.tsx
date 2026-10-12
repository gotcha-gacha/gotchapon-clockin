// On the web, a role change from text to button swaps the host from div to button and remounts the
// capsules, so the drop plays again when the tap line appears (#389). The host stays a button.
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BatchPile } from '@/components/machine/BatchPile';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

const pile = () => host.querySelector('[data-testid="batch-pile"]') as HTMLElement;
const capsules = () => [...host.querySelectorAll('[data-testid="pile-capsule"]')];

test('the pile stays the same button when it becomes tappable', async () => {
  await act(async () => { root.render(<BatchPile count={10} label="none" onOpen={() => {}} />); });
  const hostBefore = pile();
  const capsBefore = capsules();
  expect(hostBefore.tagName).toBe('BUTTON');
  expect(capsBefore).toHaveLength(10);
  expect(hostBefore.getAttribute('aria-disabled')).toBe('true');

  await act(async () => { root.render(<BatchPile count={10} label="tap" onOpen={() => {}} />); });
  expect(pile()).toBe(hostBefore);
  expect(pile().tagName).toBe('BUTTON');
  expect(capsules()).toEqual(capsBefore);
  expect(pile().getAttribute('aria-label')).toBe('Open all 10 capsules');
  expect(host.textContent).toContain('Tap the pile to open all 10');
});
