// Account sheet (F7.3) against the in-app mock and the real session: who you signed in with and the wallet, sound, the
// sign out, and delete: its warning names the cards and balance held, nothing closes the sheet while the request
// is out, a failure says what to do about the delete, and the closing date is still shown when the sheet is reopened.
// The daily capsule reminder is gone (#376). Shipment updates and restock alerts are not on the sheet (#350); their
// prefs stay in the saved settings.
// Deposit-key export is absent on the mock (#352). Terms and Privacy open the interim drafts (#354).
import { expect, jest, test } from '@jest/globals';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/api';
import { ApiError } from '@/api/errors';
import { playSfx } from '@/audio/sfx';
import { AuthCtx, type Auth } from '@/auth/context';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AccountSheet } from '@/components/AccountSheet';
import { PRIVACY_URL, TERMS_URL } from '@/legal/urls';
import { dollars } from '@/format';
import { SessionProvider, useSession } from '@/state/session';
import { readSettings, updateSettings } from '@/state/settings';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { keepDrawReceipt } from '@/state/drawReceipts';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));

const live: { auth: ReturnType<typeof useAuth> | null; session: ReturnType<typeof useSession> | null; setOpen: ((open: boolean) => void) | null } = { auth: null, session: null, setOpen: null };
/** Home's part: the sheet is mounted while open and unmounted on close, over one session. */
function Host({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const session = useSession();
  const [open, setOpen] = useState(true);
  useEffect(() => { live.auth = auth; live.session = session; live.setOpen = setOpen; }, [auth, session]);
  return open ? <AccountSheet onClose={() => { onClose(); setOpen(false); }} /> : null;
}

/** The sheet over a loaded session, signed in with Apple. */
async function open(onClose: () => void = jest.fn()) {
  const r = await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <Host onClose={onClose} />
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(live.session?.me).toBeTruthy());
  await act(async () => { live.auth!.signIn('Apple'); });
  return r;
}
const reopen = async () => {
  await act(async () => { live.setOpen!(false); });
  await act(async () => { live.setOpen!(true); });
};
const box = (testId: string) => StyleSheet.flatten(screen.getByTestId(testId).props.style);
const a11y = (label: string) => (screen.getByLabelText(label).props.accessibilityState ?? {}) as { checked?: boolean; disabled?: boolean };

test('an external wallet disconnects and does not offer export or a link', async () => {
  const signOut = jest.fn();
  const embedded = 'PrivyEmbeddedDepositAddressForSiwsTest0001';
  const phantom = 'So1anaExternalWalletAddressForSiwsTest11';
  const auth = {
    ready: true, stage: 'done', provider: 'wallet', step: '', wallet: embedded,
    loginWallet: { name: 'Phantom', address: phantom },
    onboardingIndex: 0, error: null, appleReady: true,
    signIn: jest.fn(), sendEmailCode: async () => false, signSolanaTransaction: null, depositFromConnectedWallet: null,
    signOut, nextSheet: jest.fn(), skipOnboarding: jest.fn(),
  } as Auth;
  await render(
    <SafeAreaProvider>
      <AuthCtx.Provider value={auth}>
        <SessionProvider>
          <AccountSheet onClose={jest.fn()} />
        </SessionProvider>
      </AuthCtx.Provider>
    </SafeAreaProvider>,
  );
  expect(screen.getByText('Signed in with Phantom')).toBeTruthy();
  expect(screen.getByText(`${embedded.slice(0, 4)}…${embedded.slice(-4)} · Solana · Privy`)).toBeTruthy();
  expect(screen.getByText(`${phantom.slice(0, 4)}…${phantom.slice(-4)} · Phantom · sign-in only, not a deposit address`)).toBeTruthy();
  // The two address lines sit in a padded block, with a real gap between them, inside a card that is not flush (#350).
  expect(box('account-identity')).toMatchObject({ paddingVertical: 16, paddingHorizontal: 18 });
  expect(box('account-addresses')).toMatchObject({ marginTop: 10, gap: 10, paddingVertical: 8, paddingHorizontal: 8 });
  expect(screen.queryByLabelText('Export wallet key')).toBeNull();
  expect(screen.queryByLabelText('Export deposit wallet key')).toBeNull();
  expect(screen.queryByText(/link a wallet/i)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Disconnect'));
  expect(signOut).toHaveBeenCalledTimes(1);
});

const EXPORT_COPY = 'This deposit key is yours. Exporting it is self-custody and cannot be undone. Do not share it. Import it in Phantom or Backpack. Gotchapon cannot show it again after the window closes.';

function sheetAuth(over: Partial<Auth> & Pick<Auth, 'provider' | 'wallet'>): Auth {
  return {
    ready: true, stage: 'done', step: '', loginWallet: null,
    onboardingIndex: 0, error: null, appleReady: true,
    signIn: jest.fn(), sendEmailCode: async () => false, signSolanaTransaction: null, depositFromConnectedWallet: null,
    signOut: jest.fn(), nextSheet: jest.fn(), skipOnboarding: jest.fn(),
    ...over,
  } as Auth;
}

async function renderSheet(auth: Auth) {
  await render(
    <SafeAreaProvider>
      <AuthCtx.Provider value={auth}>
        <SessionProvider>
          <AccountSheet onClose={jest.fn()} />
        </SessionProvider>
      </AuthCtx.Provider>
    </SafeAreaProvider>,
  );
}

test('a Privy deposit wallet exports through the provider, shows that pubkey first, and is not coming soon', async () => {
  const embedded = 'PrivyEmbeddedDepositAddressForGoogleExport01';
  const exportDepositWallet = jest.fn(async () => {});
  await renderSheet(sheetAuth({ provider: 'Google', wallet: embedded, exportDepositWallet }));
  expect(screen.getByText('Signed in with Google')).toBeTruthy();
  expect(screen.getByLabelText('Deposit wallet address').props.children).toBe(embedded);
  expect(screen.getByText(EXPORT_COPY)).toBeTruthy();
  expect(a11y('Export deposit wallet key').disabled).toBe(false);
  expect(screen.getByLabelText('Export deposit wallet key').props.accessibilityValue?.text).not.toBe('coming soon');
  expect(screen.queryByLabelText('Export wallet key')).toBeNull();
  expect(screen.queryByLabelText('Disconnect')).toBeNull();
  expect(screen.queryByText('coming soon')).toBeNull();
  expect([a11y('Terms').disabled, a11y('Privacy').disabled]).toEqual([false, false]);
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  await fireEvent.press(screen.getByLabelText('Terms'));
  await fireEvent.press(screen.getByLabelText('Privacy'));
  expect(openUrl.mock.calls.map((call) => call[0])).toEqual([TERMS_URL, PRIVACY_URL]);
  openUrl.mockRestore();
  await fireEvent.press(screen.getByLabelText('Export deposit wallet key'));
  expect(exportDepositWallet).toHaveBeenCalledTimes(1);
  expect(exportDepositWallet.mock.calls[0]).toEqual([]);
});

test('with no withdraw (Ben, 10 Oct), the delete warning names the key export where it exists, and never says withdraw', async () => {
  const embedded = 'PrivyEmbeddedDepositAddressForGoogleExport01';
  await renderSheet(sheetAuth({ provider: 'Google', wallet: embedded, exportDepositWallet: jest.fn(async () => {}) }));
  await fireEvent.press(screen.getByLabelText('Delete account'));
  expect(screen.getByText(/To keep your balance, export your deposit wallet key above first — shipping cards home is coming soon\. Anything left after 30 days is forfeited\.$/)).toBeTruthy();
  expect(screen.queryByText(/withdraw/i)).toBeNull();
  expect(screen.queryByText(/nothing is forfeited/)).toBeNull();
});

test('SIWS exports the Privy deposit address and still disconnects the login wallet', async () => {
  const embedded = 'PrivyEmbeddedDepositAddressForSiwsExport001';
  const phantom = 'So1anaExternalWalletAddressForSiwsTest11';
  const jupiter = 'JupiterLoginWalletAddressNotForExport111';
  const exportDepositWallet = jest.fn(async () => {});
  await renderSheet(sheetAuth({
    provider: 'wallet', wallet: embedded, exportDepositWallet,
    loginWallet: { name: 'Jupiter', address: jupiter },
  }));
  expect(screen.getByText('Signed in with Jupiter')).toBeTruthy();
  expect(screen.getByLabelText('Deposit wallet address').props.children).toBe(embedded);
  expect(screen.queryByText(phantom)).toBeNull();
  expect(screen.queryByText(jupiter)).toBeNull();
  expect(screen.getByText(EXPORT_COPY)).toBeTruthy();
  expect(screen.getByLabelText('Disconnect')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Export deposit wallet key'));
  expect(exportDepositWallet).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(exportDepositWallet.mock.calls)).not.toContain(jupiter);
});

test('a failed export stays on the sheet and does not show the error it was given', async () => {
  const embedded = 'PrivyEmbeddedDepositAddressForExportFailure1';
  const exportDepositWallet = jest.fn(async () => { throw new Error('secret key material 5KabcShouldNotRender'); });
  await renderSheet(sheetAuth({ provider: 'Google', wallet: embedded, exportDepositWallet }));
  await fireEvent.press(screen.getByLabelText('Export deposit wallet key'));
  expect(await screen.findByText('The export window did not finish. You can try again.')).toBeTruthy();
  expect(screen.queryByText(/5KabcShouldNotRender/)).toBeNull();
  expect(screen.getByLabelText('Export deposit wallet key')).toBeTruthy();
  expect(screen.getByTestId('account-sheet')).toBeTruthy();
});

test('who you signed in with and the wallet, the design’s notification defaults and sound, and coming-soon rows', async () => {
  await open();
  expect(playSfx).toHaveBeenCalledWith('click');
  expect(screen.getByText('Signed in with Apple')).toBeTruthy();
  const wallet = live.session!.me!.wallet;
  expect(screen.getByText(`${wallet.slice(0, 4)}…${wallet.slice(-4)} · Solana · Privy`)).toBeTruthy();
  expect(screen.queryByLabelText('Daily capsule reminder')).toBeNull();
  expect(screen.queryByLabelText('Shipment updates')).toBeNull();
  expect(screen.queryByLabelText('Restock alerts')).toBeNull();
  expect(screen.getByText('Sound on')).toBeTruthy();
  expect(a11y('Sound').checked).toBe(true);
  expect(screen.queryByLabelText('Export wallet key')).toBeNull();
  expect(screen.queryByLabelText('Export deposit wallet key')).toBeNull();
  expect(screen.queryByText('coming soon')).toBeNull();
  expect(screen.queryByLabelText('Terms & shipping policy')).toBeNull();
  expect(screen.queryByText(/shipping policy/i)).toBeNull();
  expect([a11y('Terms').disabled, a11y('Privacy').disabled]).toEqual([false, false]);
  expect(screen.getByLabelText('Privacy').props.accessibilityValue?.text).toBeUndefined();
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  await fireEvent.press(screen.getByLabelText('Terms'));
  await fireEvent.press(screen.getByLabelText('Privacy'));
  expect(openUrl.mock.calls.map((call) => call[0])).toEqual([TERMS_URL, PRIVACY_URL]);
  expect(screen.queryByLabelText('Odds disclosure')).toBeNull();
});

test('sound is kept on the device and does not drop the hidden notification prefs', async () => {
  updateSettings({ onboarded: true, notify: { daily: false, shipments: true, restock: false } });
  const r = await open();
  expect(screen.queryByLabelText('Daily capsule reminder')).toBeNull();
  expect(screen.queryByLabelText('Shipment updates')).toBeNull();
  expect(screen.queryByLabelText('Restock alerts')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Sound'));
  expect(a11y('Sound').checked).toBe(false);
  expect(screen.getByText('Sound off')).toBeTruthy();
  expect(readSettings()).toEqual({ muted: true, notify: { daily: false, shipments: true, restock: false }, onboarded: true });

  await r.unmount();
  await open();
  expect(screen.queryByLabelText('Daily capsule reminder')).toBeNull();
  expect(screen.getByText('Sound off')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Sound'));
  expect(readSettings()).toEqual({ muted: false, notify: { daily: false, shipments: true, restock: false }, onboarded: true });
});

test('Sign out closes the sheet and signs out', async () => {
  const onClose = jest.fn();
  await open(onClose);
  await fireEvent.press(screen.getByLabelText('Sign out'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('account-sheet')).toBeNull();
  await waitFor(() => expect(live.auth!.stage).toBe('idle'));
});

test('Delete account warns about what you hold, Keep account backs out, a failure says what to do, and the closing date stays after reopening', async () => {
  // Two holding lines, four cards, served by the API the session loads from: the warning counts cards, not lines.
  const holdings = jest.spyOn(api, 'holdings').mockResolvedValue([{ cardId: 'warn-a', qty: 3 }, { cardId: 'warn-b', qty: 1, rarity: 'holo' }]);
  const del = jest.spyOn(api, 'deleteAccount');
  try {
    await open();
    await waitFor(() => expect(Object.keys(live.session!.holdings)).toHaveLength(2));
    const { balanceUsd } = live.session!;
    const pulls = Math.floor(balanceUsd);

    await fireEvent.press(screen.getByLabelText('Delete account'));
    expect(screen.getByText(`You hold 4 cards and ${dollars(balanceUsd)} · ${pulls} pull${pulls === 1 ? '' : 's'}. Moving your balance out is coming soon, and nothing is forfeited until it is. Shipping cards home is coming soon too.`)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Keep account'));
    expect(screen.queryByText('Delete account?')).toBeNull();
    expect(del).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Delete account'));
    del.mockRejectedValueOnce(new ApiError({ code: 'NETWORK', message: 'offline' }));
    await fireEvent.press(screen.getByLabelText('Delete in 30 days'));
    expect(await screen.findByText('No connection. Check your connection and try again.')).toBeTruthy();
    expect(screen.queryByText(/your capsule is safe|A paid pull is never lost/)).toBeNull(); // not the pull flow's copy
    expect(screen.getByText('Delete account?')).toBeTruthy(); // still asking: nothing was scheduled

    del.mockRejectedValueOnce(new ApiError({ code: 'UNREADABLE', message: 'Unreadable response (HTTP 502)' }, 502));
    await fireEvent.press(screen.getByLabelText('Delete in 30 days'));
    expect(await screen.findByText('We could not read the reply. Try again — if it already went through, the closing date will show.')).toBeTruthy();
    expect(screen.queryByText(/That did not go through/)).toBeNull(); // it might have: only the body could not be read
    expect(screen.queryByText(/waiting for you/)).toBeNull();
    expect(screen.getByText('Delete account?')).toBeTruthy();

    del.mockResolvedValueOnce({ graceUntil: '2026-10-11T12:00:00.000Z' });
    await fireEvent.press(screen.getByLabelText('Delete in 30 days'));
    expect(await screen.findByText('Account closing')).toBeTruthy();
    expect(screen.getByText('Your account closes on 11 Oct 2026. Moving your balance out is coming soon, and nothing is forfeited until it is. Shipping cards home is coming soon too.')).toBeTruthy();

    await reopen();
    expect(screen.getByText('Account closing')).toBeTruthy(); // the session remembers it
    expect(screen.queryByLabelText('Delete account')).toBeNull();
    expect(del).toHaveBeenCalledTimes(3);
  } finally {
    holdings.mockRestore();
    del.mockRestore();
  }
});

test('while the delete request is out nothing closes the sheet or backs out, and its answer lands in view', async () => {
  let answer!: (r: { graceUntil: string }) => void;
  const del = jest.spyOn(api, 'deleteAccount').mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
  const onClose = jest.fn();
  try {
    await open(onClose);
    await fireEvent.press(screen.getByLabelText('Delete account'));
    await fireEvent.press(screen.getByLabelText('Delete in 30 days'));
    for (const label of ['Keep account', 'Delete in 30 days', 'Close', 'Sign out']) expect(a11y(label).disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('Close account')); // the backdrop
    await fireEvent(screen.getByTestId('account-sheet'), 'requestClose'); // Android back
    await fireEvent.press(screen.getByLabelText('Keep account'));
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Delete account?')).toBeTruthy();

    await act(async () => { answer({ graceUntil: '2026-10-11T12:00:00.000Z' }); });
    expect(await screen.findByText('Account closing')).toBeTruthy();
    expect(del).toHaveBeenCalledTimes(1);
  } finally {
    del.mockRestore();
  }
});

// #418: the user can take their MagicBlock draw receipts off the device, as the very file the draw verifier reads.
test('Copy draw receipts is offered only when receipts are kept, and copies the stored file', async () => {
  const stored = new File('file:///document', 'draw-receipts.json');
  stored.write('[]');
  await open();
  expect(screen.queryByLabelText('Copy draw receipts')).toBeNull();
  await reopen();
  expect(screen.queryByLabelText('Copy draw receipts')).toBeNull();

  const hash = (n: number) => n.toString(16).padStart(64, '0');
  keepDrawReceipt({ pullId: 'pull_a', draw: { source: 'magicblock', sequence: 7, poolHash: hash(1) } });
  keepDrawReceipt({ pullId: 'pull_b', draw: { source: 'magicblock', sequence: 8, poolHash: hash(2) } });
  await reopen();
  const copy = jest.mocked(Clipboard.setStringAsync);
  copy.mockClear();
  await fireEvent.press(screen.getByLabelText('Copy draw receipts'));
  expect(copy).toHaveBeenCalledTimes(1);
  expect(copy.mock.calls[0][0]).toBe(stored.textSync());
  expect(JSON.parse(copy.mock.calls[0][0]).map((r: { pullId: string }) => r.pullId)).toEqual(['pull_a', 'pull_b']);
  expect(await screen.findByText('Copied 2 draw receipts.')).toBeTruthy();

  copy.mockRejectedValueOnce(new Error('no clipboard'));
  await fireEvent.press(screen.getByLabelText('Copy draw receipts'));
  expect(await screen.findByText('Could not copy. Try again.')).toBeTruthy();

  // The phone's clipboard says no by resolving false, not by rejecting: that is a failed copy too.
  await fireEvent.press(screen.getByLabelText('Copy draw receipts'));
  expect(await screen.findByText('Copied 2 draw receipts.')).toBeTruthy();
  copy.mockResolvedValueOnce(false);
  await fireEvent.press(screen.getByLabelText('Copy draw receipts'));
  expect(await screen.findByText('Could not copy. Try again.')).toBeTruthy();
  expect(screen.queryByText('Copied 2 draw receipts.')).toBeNull();

  // Two quick presses: the first press's late answer does not replace the second's.
  let settleFirst!: (ok: boolean) => void;
  copy.mockImplementationOnce(() => new Promise<boolean>((resolve) => { settleFirst = resolve; }));
  copy.mockResolvedValueOnce(false);
  await fireEvent.press(screen.getByLabelText('Copy draw receipts'));
  await fireEvent.press(screen.getByLabelText('Copy draw receipts'));
  await act(async () => { settleFirst(true); });
  expect(screen.getByText('Could not copy. Try again.')).toBeTruthy();
  expect(screen.queryByText('Copied 2 draw receipts.')).toBeNull();
  stored.write('[]');
});
