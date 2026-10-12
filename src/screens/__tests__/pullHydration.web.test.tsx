// The hydration frost blurs the app frame (header, pages, rail) and dims it with a full-viewport veil.
// A blur on the machine alone leaves a hard rectangle. A backdrop-filter on the veil leaves the rail
// sharp: that layer is composited above the backdrop. The blur is `filter` on the frame that contains
// the rail, published on `data-frost` from the same write.
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import React, { act, useRef } from 'react';
import { Text, View, type View as ViewType } from 'react-native';
import { createRoot, type Root } from 'react-dom/client';
import { HYDRATION_FADE_MS, HYDRATION_VEIL_Z, PullHydration, useHydrationFrost } from '@/screens/PullHydration';

function Frame({ hydrating }: { hydrating: boolean }) {
  const ref = useRef<ViewType>(null);
  useHydrationFrost(hydrating, ref);
  return (
    <View style={{ flex: 1, position: 'relative' }}>
      <View ref={ref} testID="hydration-frame" style={{ flex: 1 }}>
        <Text>GOTCHAPON</Text>
        <View testID="rail"><Text>Albums</Text></View>
      </View>
      <PullHydration hydrating={hydrating} />
    </View>
  );
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

const veil = () => host.querySelector('[data-testid="pull-hydrating"]') as HTMLElement;
const frame = () => host.querySelector('[data-testid="hydration-frame"]') as HTMLElement;

test('while the wallet is loading the viewport is frosted and inert', async () => {
  await act(async () => { root.render(<Frame hydrating />); });
  const layer = veil();
  const box = getComputedStyle(layer);
  expect(layer.getAttribute('aria-label')).toBe('Loading pulls');
  expect(layer.getAttribute('aria-busy')).toBe('true');
  expect(box.position).toBe('absolute');
  expect(box.top).toBe('0px');
  expect(box.right).toBe('0px');
  expect(box.bottom).toBe('0px');
  expect(box.left).toBe('0px');
  expect(box.zIndex).toBe(String(HYDRATION_VEIL_Z));
  expect(box.pointerEvents).toBe('auto');
  expect(box.backgroundColor).toContain('0.42');
  // The dim covers the frame. It does not blur itself — the rail would stay sharp behind a backdrop.
  expect(layer.getAttribute('data-frost')).toBeNull();
  expect(layer.style.filter).not.toContain('blur');
  expect(box.filter === '' || box.filter === 'none').toBe(true);
  // Header and rail live in the blurred frame, not under a machine-sized filter.
  const content = frame();
  expect(content.getAttribute('data-frost')).toContain('blur(18px)');
  expect(content.style.filter).toContain('blur(18px)');
  // Transformed layers (the rail tabs, the machine) would paint sharp above the blur. The document
  // flag is what the page CSS uses to flatten them for the hold.
  expect(document.documentElement.hasAttribute('data-balance-pending')).toBe(true);
  expect(content.querySelector('[data-testid="rail"]')).not.toBeNull();
  expect(layer.contains(content.querySelector('[data-testid="rail"]'))).toBe(false);
  expect(host.querySelector('[data-testid="pull-hydrating-machine"]')).toBeNull();
});

test('once the wallet is known the frost fades off the viewport', async () => {
  await act(async () => { root.render(<Frame hydrating />); });
  await act(async () => { root.render(<Frame hydrating={false} />); });
  const layer = veil();
  const content = frame();
  expect(layer.style.opacity).toBe('0');
  expect(layer.style.transitionProperty).toBe('opacity');
  expect(layer.style.transitionDuration).toBe(`${HYDRATION_FADE_MS}ms`);
  expect(getComputedStyle(layer).pointerEvents).toBe('none');
  expect(content.style.filter).toBe('blur(0px)');
  expect(content.style.transitionProperty).toBe('filter');
  expect(content.style.transitionDuration).toBe(`${HYDRATION_FADE_MS}ms`);
  // The announcement lifts with the balance. The glass is what is still fading.
  expect(layer.getAttribute('aria-label')).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, HYDRATION_FADE_MS + 40)); });
  expect(host.querySelector('[data-testid="pull-hydrating"]')).toBeNull();
  expect(content.getAttribute('data-frost')).toBeNull();
  expect(content.style.filter).toBe('');
  expect(document.documentElement.hasAttribute('data-balance-pending')).toBe(false);
});

test('a known wallet on the first paint has no frost', async () => {
  await act(async () => { root.render(<Frame hydrating={false} />); });
  expect(host.querySelector('[data-testid="pull-hydrating"]')).toBeNull();
  expect(frame().getAttribute('data-frost')).toBeNull();
  expect(frame().style.filter).toBe('');
});
