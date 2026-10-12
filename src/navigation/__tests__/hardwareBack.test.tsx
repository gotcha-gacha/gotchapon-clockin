// Android's Back in the signed-in app (useHardwareBack.ts; 11 Oct 2026). The order is `backStep`'s; the rest is Home wiring it
// to the real session against the in-app mock. Only Android ever calls a Back listener, and the native jest project's
// BackHandler is iOS's (it never calls one), so the listeners are collected here and called the way Android calls them: the
// newest first, until one answers true. False from all of them is the system's default (the app goes to the background).
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import Home from '@/screens/Home';
import { AuthProvider } from '@/auth/AuthProvider';
import { PAGE, SessionProvider } from '@/state/session';
import { backStep } from '@/navigation/useHardwareBack';
import { signInFromFirstScreen } from '@/test/signIn';
import { DEFAULT_SETTINGS, writeSettings } from '@/state/settings';

type Listener = () => boolean | null | undefined;
const listeners: Listener[] = [];
beforeEach(() => {
  listeners.length = 0;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    listeners.push(handler as Listener);
    return { remove: () => { const i = listeners.indexOf(handler as Listener); if (i >= 0) listeners.splice(i, 1); } };
  });
});
afterEach(() => { jest.restoreAllMocks(); });

/** One press of Back: whether the app took it. */
async function back(): Promise<boolean> {
  let handled = false;
  await act(async () => { handled = [...listeners].reverse().some((l) => l() === true); });
  return handled;
}

test('the order: an open binder on Albums closes; any other page goes to Pull; Pull lets the system have it', () => {
  expect(backStep(PAGE.albums, 'lanterns')).toBe('closeBinder');
  expect(backStep(PAGE.albums, null)).toBe('toPull');
  expect(backStep(PAGE.wallet, null)).toBe('toPull');
  expect(backStep(PAGE.wallet, 'lanterns')).toBe('toPull'); // a binder left open behind another page is not what Back is for
  expect(backStep(PAGE.pull, 'lanterns')).toBeNull();
  expect(backStep(PAGE.pull, null)).toBeNull();
});

// Covers are sized from onLayout, which the test renderer never fires on its own.
const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });

test('in the app: Back closes the binder, then goes to Pull, then leaves; nothing listens before sign-in', async () => {
  mock!.dev.reset(); writeSettings({ ...DEFAULT_SETTINGS, onboarded: true });
  await render(<SafeAreaProvider><AuthProvider><SessionProvider><Home /></SessionProvider></AuthProvider></SafeAreaProvider>);
  await screen.findByText('Already collecting? Sign in');
  expect(await back()).toBe(false); // the first screen: the system's Back, as before
  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByLabelText('Albums page, current')).toBeTruthy(), { timeout: 6000 });

  await fireEvent(await screen.findByTestId('albums-grid'), 'layout', layout(370));
  await fireEvent.press(await screen.findByText('Tidepool Friends'));
  expect(await screen.findByLabelText('Back to albums')).toBeTruthy();

  expect(await back()).toBe(true); // 1: out of the binder, still on Albums
  expect(screen.queryByLabelText('Back to albums')).toBeNull();
  expect(screen.getByTestId('albums-grid')).toBeTruthy();
  expect(screen.getByLabelText('Albums page, current')).toBeTruthy();

  expect(await back()).toBe(true); // 2: to the machine
  expect(screen.getByLabelText('Pull page, current')).toBeTruthy();

  expect(await back()).toBe(false); // 3: on Pull, the system's (the app goes to the background)
  expect(screen.getByLabelText('Pull page, current')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Wallet page'));
  expect(await back()).toBe(true); // the Wallet steps back to Pull too
  expect(screen.getByLabelText('Pull page, current')).toBeTruthy();
}, 20000);
