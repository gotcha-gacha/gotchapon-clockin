// The sign-in sheet's own two claims about a provider it cannot use, and about a failure that is not a pull.
//
// Both were dropped once and nothing caught it: `appleReady` was written by both providers and read by no component, so the
// Apple button was fully enabled on the Privy path while the commit message and `docs/PRIVY_SETUP.md` said it was disabled;
// and the error box rendered `errorCopy[code]`, whose UNKNOWN body promises "a paid pull is never lost" to someone who has
// not signed in and certainly has not paid. Neither is covered by the provider tests, because neither is the provider's.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { DeviceEventEmitter, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { AuthSheet } from '@/screens/firstScreen/AuthSheet';

jest.mock('@/auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const as = (over: Partial<ReturnType<typeof useAuth>>) =>
  jest.mocked(useAuth).mockReturnValue({
    ready: true, stage: 'idle', provider: null, step: '', wallet: null, onboardingIndex: 0, error: null,
    appleReady: true, signIn: jest.fn(), sendEmailCode: jest.fn(), signOut: jest.fn(), nextSheet: jest.fn(), skipOnboarding: jest.fn(),
    ...over,
  } as unknown as ReturnType<typeof useAuth>);
const show = () => render(<SafeAreaProvider><AuthSheet onClose={jest.fn()} /></SafeAreaProvider>);

test('the phone sheet insets the title and buttons from the rim', async () => {
  as({ appleReady: true });
  await show();
  const body = screen.getByTestId('auth-sheet-body');
  const flat = StyleSheet.flatten(body.props.style);
  expect(flat.paddingHorizontal).toBeGreaterThanOrEqual(24);
  expect(flat.paddingTop).toBeGreaterThanOrEqual(22);
  expect(screen.getByText('Continue with Apple')).toBeTruthy();
  expect(screen.getByText('Continue with Google')).toBeTruthy();
  expect(screen.getByText('Send code')).toBeTruthy();
});

test('Apple is offered when the provider can do it', async () => {
  as({ appleReady: true });
  await show();
  expect(screen.getByText('Continue with Apple').parent).toBeTruthy();
  expect(screen.queryByText(/not set up yet/)).toBeNull();
});

test('Apple and Google carry their marks, not a letter', async () => {
  as({ appleReady: true });
  await show();
  // The private-use "" and the blue "G" were placeholders. The marks sit beside the same labels.
  // Hidden from the accessibility tree on purpose: the label is the name, the mark is a picture of it.
  expect(screen.getByTestId('apple-mark', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('google-mark', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId('apple-mark')).toBeNull();
  expect(screen.getByText('Continue with Google')).toBeTruthy();
  expect(screen.queryByText(/^G\s/)).toBeNull();
});

test('Apple is disabled, and says why, when the provider cannot', async () => {
  as({ appleReady: false });
  await show();
  expect(screen.getByText(/Apple sign-in is not set up yet/)).toBeTruthy();
  // Disabled in the tree, not just dimmed: a press must not reach `signIn`.
  const button = screen.getAllByRole('button').find((b) => b.props.accessibilityState?.disabled === true);
  expect(button).toBeTruthy();
});

test('a failed sign-in never talks about paid pulls', async () => {
  as({ error: new ApiError({ code: 'UNKNOWN', message: 'whatever Privy said' }) });
  await show();
  expect(screen.getByText('We could not sign you in')).toBeTruthy();
  expect(screen.queryByText(/paid pull/)).toBeNull();
  expect(screen.queryByText(/whatever Privy said/)).toBeNull(); // the SDK's own words are never the copy
});

test('no connection keeps the copy that is already right for it', async () => {
  as({ error: new ApiError({ code: 'NETWORK', message: 'offline' }) });
  await show();
  expect(screen.getByText('No connection')).toBeTruthy();
});

// Android (11 Oct 2026, for the judging build). The native jest project runs as iOS, so the platform is replaced per test,
// before the sheet renders.
function onAndroid() { return jest.replaceProperty(Platform, 'OS', 'android'); }

test('on Android there is no Apple button at all: not a disabled one, not its mark, not its note', async () => {
  const os = onAndroid();
  try {
    for (const appleReady of [true, false]) {
      as({ appleReady });
      const view = await show();
      expect(screen.queryByText('Continue with Apple')).toBeNull();
      expect(screen.queryByTestId('apple-mark', { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByText(/Apple sign-in/)).toBeNull();
      expect(screen.getAllByRole('button').some((b) => b.props.accessibilityState?.disabled === true)).toBe(false);
      expect(screen.getByText('Continue with Google')).toBeTruthy();
      expect(screen.getByText('Send code')).toBeTruthy();
      await view.unmount();
    }
  } finally { os.restore(); }
});

test('on Android the sheet stands in a keyboard-avoiding view, and the keyboard lifts it clear', async () => {
  const os = onAndroid();
  try {
    as({});
    await show();
    const lift = screen.getByTestId('auth-sheet-keyboard');
    const body = within(lift).getByTestId('auth-sheet-body');
    // In the flow at the view's foot: an absolute sheet is placed against the padding box, and the padding would not move it.
    expect(StyleSheet.flatten(body.props.style).position).toBe('relative');
    expect(StyleSheet.flatten(lift.props.style)).toMatchObject({ flex: 1, justifyContent: 'flex-end' });
    // The view fills the 800 pt window; the keyboard comes up over its bottom 300. The sheet's foot rises by exactly that.
    await fireEvent(lift, 'layout', { persist() {}, nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } });
    await act(async () => { DeviceEventEmitter.emit('keyboardDidShow', { endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 } }); });
    expect(StyleSheet.flatten(screen.getByTestId('auth-sheet-keyboard').props.style).paddingBottom).toBe(300);
    await act(async () => { DeviceEventEmitter.emit('keyboardDidHide', { endCoordinates: { screenX: 0, screenY: 800, width: 400, height: 0 } }); });
    expect(StyleSheet.flatten(screen.getByTestId('auth-sheet-keyboard').props.style).paddingBottom).toBe(0);
  } finally { os.restore(); }
});

test('on iOS the sheet is as it was: absolute at the foot of the window, with no keyboard view around it', async () => {
  as({});
  await show();
  expect(screen.queryByTestId('auth-sheet-keyboard')).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('auth-sheet-body').props.style)).toMatchObject({ position: 'absolute', left: 0, right: 0, bottom: 0 });
});
