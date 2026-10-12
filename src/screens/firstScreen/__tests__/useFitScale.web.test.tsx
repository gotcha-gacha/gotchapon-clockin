// The web scale (#325). jsdom lays nothing out, so the boxes are assigned and the observer is the one the hook
// registered: what matters is which height it treats as the panel and which it treats as the column.
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text, View } from 'react-native';
import { useFitScale } from '@/screens/firstScreen/useFitScale';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let hostEl: HTMLElement;
let notify: ResizeObserverCallback = () => {};

class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) { notify = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Probe() {
  const viewport = useRef<View>(null);
  const column = useRef<View>(null);
  const fit = useFitScale(viewport, column);
  return (
    <View ref={viewport} testID="viewport">
      <View
        ref={column}
        testID="column"
        style={fit.scale < 1 ? { height: fit.content, transform: [{ scale: fit.scale }] } : undefined}
      >
        <View testID="brand" />
        <View testID="stage" />
        <View testID="copy" />
      </View>
      <Text testID="scale">{String(fit.scale)}</Text>
    </View>
  );
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;

beforeEach(() => {
  notify = () => {};
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  hostEl = document.createElement('div');
  document.body.appendChild(hostEl);
  root = createRoot(hostEl);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  hostEl.remove();
});

const box = (el: HTMLElement, h: number, which: 'clientHeight' | 'offsetHeight') => {
  Object.defineProperty(el, which, { configurable: true, get: () => h });
};

test('a column taller than its panel scales to fit, and the sky is not one of the children it measures', async () => {
  await act(async () => { root.render(<Probe />); });
  // The panel is the viewport. The three in-flow children are the content. A sibling readout is not among them.
  box(q('viewport'), 640, 'clientHeight');
  box(q('brand'), 36, 'offsetHeight');
  box(q('stage'), 170, 'offsetHeight');
  box(q('copy'), 520, 'offsetHeight'); // 36 + 170 + 520 = 726 > 640
  await act(async () => { notify([], {} as ResizeObserver); });
  const scale = Math.floor((640 / 726) * 1000) / 1000;
  expect(q('scale').textContent).toBe(String(scale));
  expect(q('column').style.transform).toContain('scale');
  expect(q('column').style.height).toBe('726px');
});

test('a column that already fits is not scaled', async () => {
  await act(async () => { root.render(<Probe />); });
  box(q('viewport'), 844, 'clientHeight');
  box(q('brand'), 36, 'offsetHeight');
  box(q('stage'), 400, 'offsetHeight');
  box(q('copy'), 400, 'offsetHeight'); // 836 <= 844
  await act(async () => { notify([], {} as ResizeObserver); });
  expect(q('scale').textContent).toBe('1');
  expect(q('column').style.transform).toBe('');
  expect(q('column').style.height).toBe('');
});
