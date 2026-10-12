// One smoke render per page against the in-app mock (#64). RNTL 14: render/fireEvent are async.
import { expect, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { AuthProvider } from '@/auth/AuthProvider';
import { PAGE, SessionProvider, useSession } from '@/state/session';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { AlbumsPage } from '@/screens/AlbumsPage';
import { WalletPage } from '@/screens/WalletPage';
import { OddsSheet } from '@/components/odds/OddsSheet';

function OddsGate() {
  const { oddsOpen, closeOdds } = useSession();
  return oddsOpen ? <OddsSheet onClose={closeOdds} /> : null;
}

function renderPage(page: React.ReactElement) {
  return render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider>{page}<OddsGate /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
}

// Covers and sleeves are sized from onLayout, which the test renderer never fires on its own.
const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });

test('Albums: the grid lists the live albums and opens a binder', async () => {
  await renderPage(<AlbumsPage />);
  await fireEvent(await screen.findByTestId('albums-grid'), 'layout', layout(370));
  await fireEvent.press(await screen.findByText('Tidepool Friends'));
  expect(await screen.findByText('Pull this album')).toBeTruthy();
  expect(screen.getByText('Random card from this album · $1.50')).toBeTruthy();
  expect(screen.queryByText(/duplicate/i)).toBeNull();
  await fireEvent(screen.getByTestId('binder-sleeves'), 'layout', layout(300));
  expect(await screen.findByLabelText('Slot 1, missing')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Back to albums'));
  await fireEvent(await screen.findByTestId('albums-grid'), 'layout', layout(370)); // the grid remounts
  expect(await screen.findByText('Little Lanterns')).toBeTruthy();
});

test('Wallet: deposit card, card top-up as coming soon, no Ship my cards, withdraw sheet', async () => {
  await renderPage(<WalletPage />);
  expect(await screen.findByText('Deposit stablecoin')).toBeTruthy();
  expect(screen.getByText('Pay by card instead')).toBeTruthy();
  expect(screen.getAllByText('Coming soon')).toHaveLength(1); // card top-up only (#349)
  expect(screen.queryByText('Ship my cards')).toBeNull();
  // Jest's build is a mock build, so the deposit card is the demo notice: no address, no QR, no Copy, and nothing
  // listening for a deposit (#185). `walletDemo.test.tsx` holds that page's own tests, `wallet.test.tsx` the ones for a
  // build off the mock.
  expect(screen.getByText('Demo build — not a real wallet')).toBeTruthy();
  expect(screen.queryByText('Listening for deposits')).toBeNull();
  await fireEvent.press(screen.getByText('Withdraw balance'));
  expect(await screen.findByLabelText('Solana address')).toBeTruthy();
  expect(screen.getByText('Network fee')).toBeTruthy();
});

test('Pull has no odds tab, see-odds link, or odds sleeve (#332)', async () => {
  await renderPage(<PullPage />);
  expect(await screen.findByText('TOP UP · $1 A TURN')).toBeTruthy();
  expect(screen.getByLabelText('Pull ×1')).toBeTruthy();
  expect(screen.queryByTestId('odds-tab')).toBeNull();
  expect(screen.queryByLabelText('Open odds')).toBeNull();
  expect(screen.queryByLabelText('View odds')).toBeNull();
  expect(screen.queryByText('see odds')).toBeNull();
  expect(screen.queryByText('Odds per $1 pull')).toBeNull();
  expect(screen.queryByTestId('odds-sheet')).toBeNull();
  expect(screen.queryByText(/Reverse holo|Holo rare|Ultra rare|Graded slab|Starter guarantee|pull 10/)).toBeNull();
  // Idle out of pulls: no "$1 a pull" and no empty hint band under the tray (#340).
  expect(screen.queryByText('$1 a pull')).toBeNull();
  expect(screen.queryByTestId('pull-hint')).toBeNull();
  expect(screen.queryByText(/same odds/i)).toBeNull();
  expect(screen.queryByText(/×5 and ×10|x5 and x10/i)).toBeNull();
});

function Target({ albumId }: { albumId: string }) {
  const { dispatch } = useRitual();
  useEffect(() => { dispatch({ type: 'SET_TARGET', albumId }); }, [albumId, dispatch]);
  return null;
}

test('Pull: a targeted pull the balance cannot cover says so, without claiming the user is out of pulls', async () => {
  mock!.dev.reset();
  // The test above starts a prepare and returns while that call is still in the mock's sleep. Waking
  // onto a pull just credited, it reserves the pull before this session's /me is read.
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
  mock!.dev.creditFree(1);
  await renderPage(<><Target albumId="B" /><PullPage /></>);
  expect(await screen.findByText('NOT ENOUGH FOR $1.50')).toBeTruthy();
  expect(screen.queryByText('OUT OF PULLS')).toBeNull();
  expect(await screen.findByText('Free pulls only work on $1 pulls — clear the target to use them')).toBeTruthy();
  expect(screen.getByText('Deposit USDC · $1.50 a pull')).toBeTruthy();
  expect(screen.getByLabelText('Pull ×5').props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByLabelText('Pull ×10').props.accessibilityState).toMatchObject({ disabled: true });
});

test('Pull: a funded chase prices ×5 and ×10 at the album rate', async () => {
  mock!.dev.reset();
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
  mock!.dev.deposit(20);
  await renderPage(<><Target albumId="B" /><PullPage /></>);
  expect(await screen.findByText('TURN THE CRANK · 13 LEFT')).toBeTruthy();
  expect(screen.getByText('$1.50 · a random card from this album')).toBeTruthy();
  expect(screen.getByText('Turn the crank — $1.50, a random card from this album')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Pull ×5'));
  expect(screen.getByText('$7.50 · random cards from this album')).toBeTruthy();
  expect(screen.getByText('Turn the crank — $7.50, random cards from this album')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Pull ×10'));
  expect(screen.getByText('$15 · random cards from this album')).toBeTruthy();
  expect(screen.getByText('Turn the crank — $15, random cards from this album')).toBeTruthy();
});
