// The Wallet on a build running the in-app mock (#185, audit item 2). A mock build has no wallet behind it, so the deposit
// card is a notice saying so — and, more to the point, none of the three ways to hand an address to a real wallet: no QR to
// scan, no address to copy, no "Open wallet app". A tester who sends real USDC to a fixture has lost it.
//
// Jest's own default IS the mock build (`usingMock` is `__DEV__` with no API URL), so this file adds no flag; `wallet.test.tsx`
// is the other side and mocks the flag off.
import { expect, test } from '@jest/globals';
import React, { useEffect } from 'react';
import * as Clipboard from 'expo-clipboard';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/auth/AuthProvider';
import { HeaderOverlay } from '@/components/HeaderOverlay';
import { PAGE, SessionProvider, useSession } from '@/state/session';
import { RitualProvider } from '@/ritual/useRitual';
import { WalletPage } from '@/screens/WalletPage';
import { mock, usingMock } from '@/api';
import { shortAddress } from '@/format';
import { DEMO_WALLET } from '@/api/mock';

const probe: { session: ReturnType<typeof useSession> | null } = { session: null };
function Probe() {
  const session = useSession();
  useEffect(() => { probe.session = session; });
  return null;
}
// Cleared before each render, or the next test reads the last one's session: it is already `ready`, so a `waitFor(ready)`
// returns at once and whatever is read beside it comes from the wrong render (PR #194's round 2 measured that).
const freshProbe = () => { probe.session = null; };

async function renderWallet() {
  freshProbe();
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <RitualProvider><Probe /><WalletPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  // Wait for the session to have answered with a wallet, not for something the demo card draws: the notice is static JSX
  // and is on screen in the first frame, before `/me`. Anchoring on it let every "the address is not here" assertion below
  // pass against a screen that had no address to show yet — measured at that anchor: `ready` false, `me` null (PR #194's
  // review). Now the address exists, and its absence from the screen is a fact about the screen.
  await waitFor(() => expect(probe.session?.me?.wallet).toBeTruthy());
  await screen.findByText('Demo build — not a real wallet');
}

test('the file is testing a mock build', () => {
  expect(usingMock).toBe(true); // without this every assertion below could be passing for the wrong reason
});

test('a mock build offers no way to deposit: no address, no QR value, no Copy, no Open wallet app', async () => {
  await renderWallet();
  expect(screen.queryByText('Copy address')).toBeNull();
  expect(screen.queryByText('Open wallet app')).toBeNull();
  // The address in each place it used to be drawn. `queryByText` sees text nodes only, so it covers the card's address
  // line and nothing else: the wallet row renders `DEMO…SEND` (shortened) and the QR renders SVG paths, neither of which
  // any text query can miss or match. The QR is the surface a tester can act on without reading a word, so it is checked
  // by the testID on its wrapper — restoring the original QR line inside this branch passed the whole suite before that
  // (PR #194's review ran it).
  expect(screen.queryByTestId('deposit-qr')).toBeNull();
  expect(screen.queryByText(DEMO_WALLET)).toBeNull();
  expect(screen.queryByLabelText('Deposit address')).toBeNull();
  expect(screen.queryByText(/DEMO-WALLET/)).toBeNull();
  expect(screen.queryByText(shortAddress(DEMO_WALLET))).toBeNull(); // the wallet row's shortened form
  expect(screen.queryByText('Listening for deposits')).toBeNull(); // nothing is
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

test('it says it is a demo and where the money on screen came from', async () => {
  await renderWallet();
  expect(screen.getByText(/Never send USDC or anything else/)).toBeTruthy();
  expect(screen.getByText(/The balance above is demo money/)).toBeTruthy();
});

// The second line, for any surface that prints a wallet anyway (the account sheet does). A string shaped like an address is
// one a tester can paste into a real wallet; this one cannot be decoded at all, so a wallet refuses it instead of sending.
// Both fixtures, not only the one the screens read: `/funding/config` is the fallback the page uses when `/me` has no
// wallet, so a real-looking address left there is the same hazard one step removed.
test('the mock serves the demo wallet from /funding/config too', async () => {
  expect((await mock!.fundingConfig()).depositAddress).toBe(DEMO_WALLET);
});

test('the demo wallet cannot be mistaken for, or used as, a Solana address', () => {
  const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // the shape WithdrawSheet accepts
  expect(BASE58.test(DEMO_WALLET)).toBe(false);
  expect(DEMO_WALLET).toMatch(/DEMO/); // and it reads as what it is
});

// The header is the other mock-only surface: the pill says what tapping it does, and tapping it does that.
test('the header pill names the $10 it hands out, and hands it out', async () => {
  mock!.dev.reset();
  freshProbe();
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>{/* the +$10 wording is the Pull page's; elsewhere the pill reads DEMO (#185) */}
          <RitualProvider><Probe /><HeaderOverlay onOpenSettings={() => {}} /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const before = probe.session!.balanceUsd;
  await fireEvent.press(screen.getByText('DEMO +$10'));
  await waitFor(() => expect(probe.session!.balanceUsd).toBe(before + 10));
});
