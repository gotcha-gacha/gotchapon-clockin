// Header streak and ticket pills (#375). Hidden until onboarding is finished. The sheet copy is the brief's.
import { beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { mock } from '@/api';
import { AuthProvider } from '@/auth/AuthProvider';
import Home from '@/screens/Home';
import { SessionProvider } from '@/state/session';
import { DEFAULT_SETTINGS, writeSettings } from '@/state/settings';
import { signInFromFirstScreen } from '@/test/signIn';
import { StreakPill } from '@/components/header/StreakPill';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, useReducedMotion: jest.fn(() => false) };
});

beforeEach(() => {
  mock!.dev.reset();
  writeSettings({ ...DEFAULT_SETTINGS });
  jest.mocked(useReducedMotion).mockReturnValue(false);
});

function home() {
  return render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <Home />
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
}

test('pills stay hidden through onboarding, then the sheet and the raffle follow the brief', async () => {
  await home();
  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByText('Real trading cards')).toBeTruthy(), { timeout: 6000 });
  expect(screen.queryByLabelText(/Streak, day/)).toBeNull();
  expect(screen.queryByText(/Daily capsule/)).toBeNull();
  await fireEvent.press(screen.getByText('Skip'));
  await waitFor(() => expect(screen.getByLabelText('Streak, day 0 of 5. Opens details.')).toBeTruthy());
  expect(screen.getByLabelText('0 raffle tickets. Opens raffle.')).toBeTruthy();
  expect(screen.queryByText(/Daily capsule/)).toBeNull();
  expect(screen.queryByTestId('streak-dot-next')).toBeNull();

  await fireEvent.press(screen.getByLabelText('Pull page'));
  expect(screen.getByTestId('streak-dot-next')).toBeTruthy();
  expect(screen.getAllByTestId('streak-dot-future')).toHaveLength(4);

  await fireEvent.press(screen.getByLabelText('Streak, day 0 of 5. Opens details.'));
  expect(screen.getByText('Start a streak')).toBeTruthy();
  expect(screen.getByText('5 days to +2 tickets')).toBeTruthy();
  expect(screen.getByText('Keep it with a $1 pull')).toBeTruthy();
  expect(screen.getByText("One paid pull a day fills a capsule. The 5th day adds 2 raffle tickets, then the tube empties and starts again. Miss a day and it's back to day 0. Free pulls don't count.")).toBeTruthy();
  expect(screen.getByText('Turn the crank · $1')).toBeTruthy();
  await fireEvent.press(screen.getByText('See the raffle'));
  expect(screen.queryByText('Start a streak')).toBeNull();
  expect(screen.getByLabelText('Albums page, current')).toBeTruthy();
  // The raffle mounts once GET /season answers (the mock's 120 ms), after the page has already switched (#408).
  expect(await screen.findByText('YOUR TICKETS')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Streak, day 0 of 5. Opens details.'));
  await fireEvent.press(screen.getByText('Go pull · $1'));
  expect(screen.getByLabelText('Pull page, current')).toBeTruthy();
  expect(screen.queryByText('Start a streak')).toBeNull();
}, 15000);

test('a credited free pull does not put a free-count chip in the header', async () => {
  mock!.dev.creditFree(3);
  await home();
  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByText('Real trading cards')).toBeTruthy(), { timeout: 6000 });
  await fireEvent.press(screen.getByText('Skip'));
  await waitFor(() => expect(screen.getByLabelText('Albums page, current')).toBeTruthy());
  // The machine, still mounted in the pager, may say "3 free pulls left". The header chip was the exact "3 free".
  expect(screen.queryByText(/^\d+ free$/)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Wallet page'));
  expect(screen.getByLabelText('Wallet page, current')).toBeTruthy();
  expect(screen.queryByText(/^\d+ free$/)).toBeNull();
}, 15000);

test('reduced motion does not bob the capsule', async () => {
  jest.mocked(useReducedMotion).mockReturnValue(true);
  await render(<StreakPill streak={{ count: 0, countedToday: false, bonusJustEarned: false }} showDots open={false} onPress={jest.fn()} />);
  expect(screen.queryByTestId('streak-capsule-bob')).toBeNull();
  expect(screen.getByTestId('streak-capsule')).toBeTruthy();
});
