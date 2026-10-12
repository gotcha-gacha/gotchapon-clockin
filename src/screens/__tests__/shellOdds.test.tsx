// The web shell's footer used to open the odds sleeve through a command Home offered (W1.5, #127).
// v0 hides the sleeve (#332), so Home never offers that command and the sheet never appears.
import { expect, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import Home from '@/screens/Home';
import { AuthProvider } from '@/auth/AuthProvider';
import { SessionProvider } from '@/state/session';
import { runShellCommand } from '@/state/shellCommands';
import { signInFromFirstScreen } from '@/test/signIn';
import { DEFAULT_SETTINGS, writeSettings } from '@/state/settings';

test('odds is never on offer, and the sleeve never opens (#332)', async () => {
  mock!.dev.reset(); writeSettings({ ...DEFAULT_SETTINGS });
  const view = await render(<SafeAreaProvider><AuthProvider><SessionProvider><Home /></SessionProvider></AuthProvider></SafeAreaProvider>);
  await screen.findByText('Pull your first card');
  expect(runShellCommand('odds')).toBe(false);

  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByText('Real trading cards')).toBeTruthy(), { timeout: 6000 });
  expect(runShellCommand('odds')).toBe(false);
  expect(screen.queryByTestId('odds-sheet')).toBeNull();

  await fireEvent.press(screen.getByText('Skip'));
  await waitFor(() => expect(screen.queryByText('Real trading cards')).toBeNull());
  await fireEvent.press(screen.getByLabelText('Pull page'));
  expect(runShellCommand('odds')).toBe(false);
  expect(screen.queryByTestId('odds-sheet')).toBeNull();
  expect(screen.queryByText('Odds per $1 pull')).toBeNull();

  await view.unmount();
  expect(runShellCommand('odds')).toBe(false);
}, 20000);
