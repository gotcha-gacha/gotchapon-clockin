// The two focus hooks on the web (W1.6, #139), against real elements: `inert` goes on and comes off with the flag, and a view
// that asks for focus has it when it appears, without scrolling anything.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Pressable, Text, View } from 'react-native';
import { useFocusWhenShown, useInert } from '../webFocus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); jest.restoreAllMocks(); });

function Behind({ on }: { on: boolean }) { const ref = useInert(on); return <View ref={ref} testID="behind"><Pressable accessibilityRole="button"><Text>Pull</Text></Pressable></View>; }
function Button() { const ref = useFocusWhenShown(); return <Pressable ref={ref} accessibilityRole="button" accessibilityLabel="Into binder"><Text>Into binder</Text></Pressable>; }

test('useInert: the attribute is on the view while the flag is on, and gone when it is off', async () => {
  const behind = () => host.querySelector('[data-testid="behind"]') as HTMLElement;
  await act(async () => { root.render(<Behind on={false} />); });
  expect(behind().hasAttribute('inert')).toBe(false);
  await act(async () => { root.render(<Behind on />); });
  expect(behind().hasAttribute('inert')).toBe(true);
  await act(async () => { root.render(<Behind on={false} />); });
  expect(behind().hasAttribute('inert')).toBe(false);
});

function Late({ shown }: { shown: boolean }) { const ref = useInert(true); return shown ? <View ref={ref} testID="late" /> : null; }
test('useInert: a view that arrives after the flag was already on is inert from its first frame', async () => {
  await act(async () => { root.render(<Late shown={false} />); });
  await act(async () => { root.render(<Late shown />); });
  expect((host.querySelector('[data-testid="late"]') as HTMLElement).hasAttribute('inert')).toBe(true);
});

test('useFocusWhenShown: the view has focus as soon as it is there, asked for without a scroll; a re-render is not an appearance', async () => {
  const focus = jest.spyOn(HTMLElement.prototype, 'focus');
  await act(async () => { root.render(<Button />); });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Into binder');
  expect(focus.mock.calls).toEqual([[{ preventScroll: true }]]);
  (document.activeElement as HTMLElement).blur();
  await act(async () => { root.render(<Button />); }); // focus the user moved stays moved
  expect(document.activeElement).toBe(document.body);
  expect(focus).toHaveBeenCalledTimes(1);
});

// PR #162's review: the ×5 / ×10 spread's Into binder is not there when its bar mounts (it waits for every card to be flipped).
// An effect on the owner's mount found no view and never ran again; the keyboard was left on the body.
function Bar({ canSettle }: { canSettle: boolean }) { const ref = useFocusWhenShown(); return <View>{canSettle ? <Pressable ref={ref} accessibilityRole="button" accessibilityLabel="Into binder"><Text>Into binder</Text></Pressable> : null}</View>; }
test('useFocusWhenShown: a view that appears after its owner mounted takes focus when it appears, and again if it comes back', async () => {
  await act(async () => { root.render(<Bar canSettle={false} />); });
  expect(document.activeElement).toBe(document.body);
  await act(async () => { root.render(<Bar canSettle />); });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Into binder');
  await act(async () => { root.render(<Bar canSettle={false} />); });
  await act(async () => { root.render(<Bar canSettle />); });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Into binder');
});
