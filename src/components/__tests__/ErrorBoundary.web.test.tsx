/**
 * The root error boundary on the web (W0.2d, #138; PR #152's review). The native card says a paid, unopened capsule is waiting:
 * true there, where it is on disk. On the web nothing keeps it until the storage seam (#136), and the card's one action is a
 * reload, so the web card must not say it. Tested here, in the web project, because that is where the claim would be made.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
function Broken(): React.ReactElement { throw new Error('the capsule could not be drawn'); }

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); jest.restoreAllMocks(); });

test('on the web the card offers a reload and promises nothing about a kept pull', async () => {
  await act(async () => { root.render(<ErrorBoundary><Broken /></ErrorBoundary>); });
  const card = host.querySelector('[data-testid="error-boundary"]') as HTMLElement;
  expect(card).not.toBeNull();
  expect(card.textContent).toContain('Something went wrong');
  expect(card.textContent).toContain('Reload the page to try again.');
  expect(card.textContent).not.toMatch(/paid|waiting for you|lost/i);
  expect([...card.querySelectorAll('[role="button"]')].map((b) => b.textContent)).toEqual(['Reload']);
});
