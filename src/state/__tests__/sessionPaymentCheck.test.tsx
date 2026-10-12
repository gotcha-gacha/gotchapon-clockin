// #186 at the session: off the mock, `paymentSignable` and `signTransfer` hold a quote to the treasury and mint this build
// pinned (src/config/treasury.ts) and to the signed-in wallet (`auth.wallet`). The session is rendered with the mock payment
// turned off; `api` stays the in-app client, which is not what is under test here.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { render } from '@testing-library/react-native';
import type { PullPrepareResponse } from '@/api';
import { SERVED_PAYMENT, SERVED_PAYMENT_INPUT as I } from '@/api/__fixtures__/servedPayment';
import { AuthCtx, type Auth } from '@/auth/context';
import { SessionProvider, useSession } from '@/state/session';

jest.mock('@/api', () => ({ ...jest.requireActual<object>('@/api'), usingMock: false }));
jest.mock('@/config/treasury', () => ({
  expectedUsdcPayment: {
    to: jest.requireActual<typeof import('@/api/__fixtures__/servedPayment')>('@/api/__fixtures__/servedPayment').SERVED_PAYMENT_INPUT.treasury,
    mint: jest.requireActual<typeof import('@/api/__fixtures__/servedPayment')>('@/api/__fixtures__/servedPayment').SERVED_PAYMENT_INPUT.mint,
  },
}));

const prepared: PullPrepareResponse = {
  pullId: I.pullId, costUsd: 1, useFreePulls: 0, expiresAt: '2099-01-01T00:00:00.000Z',
  transfer: { to: I.treasury, mint: I.mint, amount: I.amount, memo: I.pullId, transactionBase64: SERVED_PAYMENT },
};

let session: ReturnType<typeof useSession> | null = null;
function Probe() {
  const s = useSession();
  useEffect(() => { session = s; });
  return null;
}
async function renderAs(wallet: string) {
  const signer = jest.fn(async (_tx: string) => 'user-signed');
  const auth = { wallet, signSolanaTransaction: signer } as unknown as Auth;
  await render(<AuthCtx.Provider value={auth}><SessionProvider><Probe /></SessionProvider></AuthCtx.Provider>);
  return signer;
}

test('signs the server-built payment for the signed-in wallet', async () => {
  const signer = await renderAs(I.wallet);
  expect(session!.paymentSignable(prepared)).toBe(true);
  await expect(session!.signTransfer(prepared)).resolves.toBe('user-signed');
  expect(signer).toHaveBeenCalledWith(SERVED_PAYMENT);
});

test('refuses the same payment when another wallet is signed in, and never asks it to sign', async () => {
  const signer = await renderAs('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  expect(session!.paymentSignable(prepared)).toBe(false);
  await expect(session!.signTransfer(prepared)).rejects.toThrow(/does not match this pull/);
  expect(signer).not.toHaveBeenCalled();
});
