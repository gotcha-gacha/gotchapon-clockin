// #266: Try again keeps the amount's idempotency key. The server rebuilds a dead signature under that key
// and resends a signature that can still land, so the sheet must not mint a second deposit on retry.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '@/api/errors';
import { DepositSheet } from '@/components/wallet/DepositSheet';

const SOURCE = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
const DEST = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function fill() {
  await fireEvent.changeText(screen.getByLabelText('Deposit amount in USDC'), '2.50');
}

test('an expired deposit offers Try again and retries the same amount and key', async () => {
  const onDeposit = jest.fn<(amountBase: number, idem: string) => Promise<void>>()
    .mockRejectedValueOnce(new ApiError({ code: 'EXPIRED', message: 'The deposit authorization expired' }))
    .mockResolvedValueOnce(undefined);
  await render(<DepositSheet open source={SOURCE} destination={DEST} onClose={jest.fn()} onDeposit={onDeposit} />);
  await fill();
  await fireEvent.press(screen.getByLabelText('Sign deposit'));
  expect(await screen.findByText('The signing request expired. Try again builds a fresh transfer for this amount.')).toBeTruthy();
  expect(screen.queryByText(/same deposit request|The deposit authorization expired/)).toBeNull();
  await fireEvent.press(screen.getByText('Try again'));
  expect(await screen.findByText('$2.50 sent')).toBeTruthy();
  expect(onDeposit).toHaveBeenCalledTimes(2);
  expect(onDeposit.mock.calls[0]).toEqual([2_500_000, onDeposit.mock.calls[1]?.[1]]);
});

test('a short connected wallet says so and retries the same key', async () => {
  const onDeposit = jest.fn<(amountBase: number, idem: string) => Promise<void>>()
    .mockRejectedValueOnce(new ApiError({ code: 'INSUFFICIENT_FUNDS', message: 'Not enough USDC' }))
    .mockResolvedValueOnce(undefined);
  await render(<DepositSheet open source={SOURCE} destination={DEST} onClose={jest.fn()} onDeposit={onDeposit} />);
  await fill();
  await fireEvent.press(screen.getByLabelText('Sign deposit'));
  expect(await screen.findByText('That is more test USDC than the connected wallet can send. Try again uses the same deposit request.')).toBeTruthy();
  expect(screen.queryByText(/fresh transfer|Not enough USDC/)).toBeNull();
  await fireEvent.press(screen.getByText('Try again'));
  expect(await screen.findByText('$2.50 sent')).toBeTruthy();
  expect(onDeposit.mock.calls[0]?.[1]).toBe(onDeposit.mock.calls[1]?.[1]);
});

test('a deposit that did not finish retries the same key and does not promise a fresh transfer', async () => {
  const onDeposit = jest.fn<(amountBase: number, idem: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('deposit: raw developer message'))
    .mockResolvedValueOnce(undefined);
  await render(<DepositSheet open source={SOURCE} destination={DEST} onClose={jest.fn()} onDeposit={onDeposit} />);
  await fill();
  await fireEvent.press(screen.getByLabelText('Sign deposit'));
  expect(await screen.findByText(/The deposit did not finish\. Check both wallet balances before trying again\. Try again uses the same deposit request\./)).toBeTruthy();
  expect(screen.queryByText(/raw developer message|fresh transfer/)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Try deposit again'));
  expect(await screen.findByText('$2.50 sent')).toBeTruthy();
  expect(onDeposit.mock.calls[0]?.[1]).toBe(onDeposit.mock.calls[1]?.[1]);
});
