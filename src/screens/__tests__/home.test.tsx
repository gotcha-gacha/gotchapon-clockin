// Smoke render of the whole home route against the in-app mock (#64): sign-in → onboarding → the Binder, the machine one swipe right (#210).
// RNTL 14: render and fireEvent are async. Guards the regressions the PR #63 review named: the onboarding scrim, the crank lifecycle mounting,
// header copy. Sheet 3 names a partner pack, not a holo, and does not promise a pull-10 holo. Deeper behaviour stays in the reducer / mock tests.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import Home from '@/screens/Home';
import { AuthProvider } from '@/auth/AuthProvider';
import { SessionProvider } from '@/state/session';
import { signInFromFirstScreen } from '@/test/signIn';
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '@/state/settings';
import { PRIVACY_URL, TERMS_URL } from '@/legal/urls';

function renderHome() {
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

/** A first run on this device: the mock's state and the settings file (which remembers that onboarding was seen) both start clean. */
function firstRun() { mock!.dev.reset(); writeSettings({ ...DEFAULT_SETTINGS }); }

test('sign in → onboarding → the Binder, with the machine one swipe right', async () => {
  firstRun();
  await renderHome();
  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByText('Real trading cards')).toBeTruthy(), { timeout: 6000 });
  // #116: no age confirmation. Sheet 1 offers both ways on without ticking anything, and the footer no longer says 18+.
  expect(screen.queryByText(/18\+|18 or over/)).toBeNull(); // not /18/: the Pull page sits behind the sheet and may show any number
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByTestId('odds-tab')).toBeNull();
  await fireEvent.press(screen.getByText('Skip'));
  await waitFor(() => expect(screen.queryByText('Real trading cards')).toBeNull());
  expect(screen.getByText('TOP UP · $1 A TURN')).toBeTruthy();
  // #210: the Binder is where a signed-in user lands; the machine is one swipe right. #332: Pull has no odds tab.
  expect(screen.getByLabelText('Albums page, current')).toBeTruthy();
  expect(screen.queryByTestId('odds-tab')).toBeNull();
  expect(screen.getByText('SWIPE TO EXPLORE\u00a0 \u2194\uFE0E')).toBeTruthy(); // the arrow with its text-presentation selector: a bare ↔ is an emoji box in iOS Safari
  await fireEvent.press(screen.getByLabelText('Pull page'));
  expect(screen.getByLabelText('Pull page, current')).toBeTruthy();
  expect(screen.queryByTestId('odds-tab')).toBeNull();
  expect(screen.queryByText('see odds')).toBeNull();
  expect(screen.queryByText('Odds per $1 pull')).toBeNull();
  expect(screen.getByLabelText('Albums page')).toBeTruthy();
  expect(screen.getByLabelText('Wallet page')).toBeTruthy();
  expect(screen.queryByLabelText('Odds page')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Wallet page'));
  expect(screen.getByLabelText('Wallet page, current')).toBeTruthy();
  expect(screen.queryByTestId('odds-tab')).toBeNull();
}, 15000);

test('onboarding sheet 3 names a partner pack and does not promise a pull-10 holo', async () => {
  firstRun();
  await renderHome();
  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByText('Real trading cards')).toBeTruthy(), { timeout: 6000 });
  await fireEvent.press(screen.getByText('Pull my first one'));
  expect(await screen.findByText('It went into your binder')).toBeTruthy();
  await fireEvent.press(screen.getByText('Got it'));
  expect(await screen.findByText('Finish an album, unlock a pack')).toBeTruthy();
  expect(screen.getByText(/A completed album unlocks a partner pack/)).toBeTruthy();
  expect(screen.queryByText(/holo|pull 10|Collector Crypt/i)).toBeNull();
  expect(readSettings().onboarded).toBe(false);
  await fireEvent.press(screen.getByText('See my binder'));
  await waitFor(() => expect(screen.queryByText('Finish an album, unlock a pack')).toBeNull());
  expect(readSettings().onboarded).toBe(true); // finishing the sheets is remembered too, not only Skip (its own call site in AuthProvider)
  expect(screen.getByText('TOP UP · $1 A TURN')).toBeTruthy();
  expect(screen.getByLabelText('Albums page, current')).toBeTruthy(); // the button names the page it leaves you on (#210)
}, 15000);

// #116: the server's ageConfirmed used to double as "has onboarded". The device remembers it now, whichever way the sheets ended.
test('the sheets are seen once per device: skipped or finished, the next sign-in goes straight to the Binder', async () => {
  firstRun();
  const first = await renderHome();
  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByText('Real trading cards')).toBeTruthy(), { timeout: 6000 });
  expect(readSettings().onboarded).toBe(false);
  await fireEvent.press(screen.getByText('Skip'));
  await waitFor(() => expect(screen.queryByText('Real trading cards')).toBeNull());
  expect(readSettings().onboarded).toBe(true);
  await first.unmount();

  await renderHome(); // a relaunch: same device, same settings file
  await signInFromFirstScreen();
  await waitFor(() => expect(screen.getByText('TOP UP · $1 A TURN')).toBeTruthy(), { timeout: 6000 });
  expect(screen.queryByText('Real trading cards')).toBeNull();
  expect(screen.getByLabelText('Albums page, current')).toBeTruthy();
}, 20000);

// #211: the wall is a motion hero now. What the first screen promises is what the product does — and what it must not say is
// as load-bearing: no Pokémon mark in original chrome, no shipping promise while shipping is coming soon, no age line (#116).
test('the first screen: one call to action, the legal line, and none of the three claims the repo forbids', async () => {
  firstRun();
  await renderHome();
  expect(await screen.findByText('Pull your first card')).toBeTruthy();
  expect(screen.getByText('Already collecting? Sign in')).toBeTruthy();
  expect(screen.getByText(/Terms/)).toBeTruthy();
  expect(screen.getByLabelText('Privacy')).toBeTruthy();
  expect(screen.queryByText('Odds')).toBeNull();
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  await fireEvent.press(screen.getByLabelText('Terms'));
  await fireEvent.press(screen.getByLabelText('Privacy'));
  expect(open.mock.calls.map((call) => call[0])).toEqual([TERMS_URL, PRIVACY_URL]);
  expect(screen.queryByText(/18\+/)).toBeNull();
  expect(screen.queryByText(/Pok/)).toBeNull();
  expect(screen.queryByText(/ship/i)).toBeNull();
  expect(screen.queryByText('Continue with Apple')).toBeNull(); // Privy waits behind the sheet
});

test('the sign-in sheet still names Privy, Terms and Privacy, and no age', async () => {
  firstRun();
  await renderHome();
  await fireEvent.press(await screen.findByText('Already collecting? Sign in'));
  expect(screen.getByText(/Sign-in and wallet by/)).toBeTruthy();
  expect(screen.getAllByLabelText('Terms').length).toBeGreaterThanOrEqual(2); // the hero's legal row carries one too
  expect(screen.getAllByLabelText('Privacy').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('Odds')).toBeNull();
  expect(screen.queryByText(/18\+/)).toBeNull();
});
