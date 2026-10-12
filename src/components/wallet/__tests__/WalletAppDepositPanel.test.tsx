// The Wallet page's "Deposit from a wallet app" row (Mobile Wallet Adapter, Android): absent without MWA, then Connect →
// the account shows → the shared deposit sheet signs through the same wallet app. The byte check is a spy here; its own
// tests run in the server's vitest suite against the real deposit builder.
import { beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { getBase58Decoder } from '@solana/codecs-strings';
import type { DepositBuildResponse } from '@/api/contract';
import { depositAsExpected } from '@/api/paymentGuard';
import { shortAddress } from '@/format';
import type { MobileWalletSession, MobileWalletTransact } from '@/wallet/mobileWalletTypes';
import { AuthCtx, type Auth } from '@/auth/context';
import { WalletAppDepositPanel, type WalletAppDepositProps } from '../WalletAppDepositPanel';

jest.mock('@/api/paymentGuard', () => ({ depositAsExpected: jest.fn() }));
const guard = jest.mocked(depositAsExpected);

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 7);
const SOURCE = getBase58Decoder().decode(KEY);
const OWNER = 'EmbeddedDepositWa11etAddressForTests1111111';

function fakes(connectFails = false) {
  const wallet: MobileWalletSession = {
    authorize: jest.fn<MobileWalletSession['authorize']>(async () => {
      if (connectFails) throw new Error('declined');
      return { accounts: [{ address: Buffer.from(KEY).toString('base64'), label: 'Seed Vault' }], auth_token: 't' };
    }),
    signTransactions: jest.fn<MobileWalletSession['signTransactions']>(async ({ payloads }) => ({ signed_payloads: payloads.map((p) => `signed(${p})`) })),
    signMessages: jest.fn<MobileWalletSession['signMessages']>(async ({ payloads }) => ({ signed_payloads: payloads.map(() => Buffer.alloc(64, 1).toString('base64')) })),
  };
  const transact: MobileWalletTransact = (session) => session(wallet);
  const built: DepositBuildResponse = {
    depositId: 'd1', asset: 'USDC', amount: 5_000_000, destination: OWNER, transactionBase64: 'BYTES',
    expiresAt: '2026-10-12T00:00:00.000Z', status: 'prepared',
  };
  const api = {
    buildDeposit: jest.fn(async () => built),
    submitDeposit: jest.fn(async () => ({ depositId: 'd1', asset: 'USDC' as const, amount: 5_000_000, destination: OWNER, signature: 's' })),
  };
  const onDeposited = jest.fn(async () => {});
  return { wallet, transact, api, onDeposited };
}

beforeEach(() => { guard.mockReset(); guard.mockImplementation((_deposit, expected) => expected !== null); });

// The native Privy provider's link: it asks the wallet app to sign the SIWS message. A stand-in that does exactly that.
const linkWalletApp = jest.fn(async (_address: string, sign: (message: Uint8Array) => Promise<Uint8Array>) => { await sign(new TextEncoder().encode('siws')); });
const auth = { linkWalletApp } as unknown as Auth;
function WalletAppDeposit(props: WalletAppDepositProps & { auth?: Auth }) {
  return <AuthCtx.Provider value={props.auth ?? auth}><WalletAppDepositPanel {...props} /></AuthCtx.Provider>;
}

test('without Mobile Wallet Adapter (iOS, the web) the row is not there', async () => {
  await render(<WalletAppDeposit destination={OWNER} onDeposited={async () => {}} transact={null} />);
  expect(screen.queryByTestId('wallet-app-deposit')).toBeNull();
});

test('connect shows the wallet app account; a deposit is built from it, signed through it, and refreshes the balance', async () => {
  const { transact, api, onDeposited, wallet } = fakes();
  await render(<WalletAppDeposit destination={OWNER} onDeposited={onDeposited} transact={transact} api={api} mint="Mint1111111111111111111111111111111111111111" />);
  await fireEvent.press(screen.getByText('Connect wallet app'));
  expect(await screen.findByText(`Seed Vault · ${shortAddress(SOURCE)}. It signs the transfer into your deposit wallet above.`)).toBeTruthy();

  await fireEvent.press(screen.getByText('Deposit from wallet app'));
  await fireEvent.changeText(screen.getByLabelText('Deposit amount in USDC'), '5');
  await fireEvent.press(screen.getByText('Sign and deposit $5.00'));
  expect(await screen.findByText('Deposit sent')).toBeTruthy();
  expect(api.buildDeposit).toHaveBeenCalledWith(expect.objectContaining({ sourceWallet: SOURCE, amount: 5_000_000 }));
  expect(wallet.signTransactions).toHaveBeenCalledWith({ payloads: ['BYTES'] });
  expect(api.submitDeposit).toHaveBeenCalledWith(expect.objectContaining({ depositId: 'd1', signedTransactionBase64: 'signed(BYTES)' }));
  expect(onDeposited).toHaveBeenCalledTimes(1);
});

test('a wallet app that does not connect says so and offers Connect again', async () => {
  const { transact, api } = fakes(true);
  await render(<WalletAppDeposit destination={OWNER} onDeposited={async () => {}} transact={transact} api={api} mint="M" />);
  await fireEvent.press(screen.getByText('Connect wallet app'));
  expect(await screen.findByText('The wallet app did not connect. Open it once, then try again.')).toBeTruthy();
  expect(screen.getByText('Connect wallet app')).toBeTruthy();
  expect(api.buildDeposit).not.toHaveBeenCalled();
});

test('with no pinned USDC mint the sheet refuses to sign and nothing is submitted', async () => {
  const { transact, api, wallet } = fakes();
  await render(<WalletAppDeposit destination={OWNER} onDeposited={async () => {}} transact={transact} api={api} mint={null} />);
  await fireEvent.press(screen.getByText('Connect wallet app'));
  await fireEvent.press(await screen.findByText('Deposit from wallet app'));
  await fireEvent.changeText(screen.getByLabelText('Deposit amount in USDC'), '5');
  await fireEvent.press(screen.getByText('Sign and deposit $5.00'));
  expect(await screen.findByLabelText('Try deposit again')).toBeTruthy();
  expect(wallet.signTransactions).not.toHaveBeenCalled();
  expect(api.submitDeposit).not.toHaveBeenCalled();
});

test('where the provider cannot link a wallet (not native Privy) the row is not there', async () => {
  const { transact, api } = fakes();
  await render(<WalletAppDeposit destination={OWNER} onDeposited={async () => {}} transact={transact} api={api} mint="M" auth={{} as Auth} />);
  expect(screen.queryByTestId('wallet-app-deposit')).toBeNull();
});

test('connecting links the wallet app; with the account\'s grant unclaimed, test USDC can be claimed to it', async () => {
  linkWalletApp.mockClear();
  const { transact, api } = fakes();
  const claimFaucet = jest.fn(async (_wallet?: string) => ({}));
  const onDeposited = jest.fn(async () => {});
  await render(<WalletAppDeposit destination={OWNER} onDeposited={onDeposited} claimFaucet={claimFaucet} transact={transact} api={api} mint="M" />);
  await fireEvent.press(screen.getByText('Connect wallet app'));
  await fireEvent.press(await screen.findByText('Claim test USDC to wallet app'));
  expect(linkWalletApp).toHaveBeenCalledWith(SOURCE, expect.any(Function));
  expect(claimFaucet).toHaveBeenCalledWith(SOURCE);
  expect(onDeposited).toHaveBeenCalledTimes(1);
});
