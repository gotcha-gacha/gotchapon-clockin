// Money rules of the withdraw sheet: one intent = one idempotency key that survives a failed attempt,
// one attempt in flight at a time, no receipt for an attempt whose sheet was closed, reviewed copy on
// failure (never a raw error message).
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { WithdrawSheet } from '@/components/wallet/WithdrawSheet';

const ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // a real address: 32 bytes of base58
/** 42 characters of base58 that decode to 31 bytes — what the sheet used to accept (#187, `solanaAddress.test.ts`). */
const NOT_AN_ADDRESS = '7xKpQm2vR8tW3nHd9fQaLm4sT6uVbN1cXeYz8wKpRq';

async function fill() {
  await fireEvent.changeText(screen.getByLabelText('Solana address'), ADDR);
  await fireEvent.changeText(screen.getByLabelText('Amount in US dollars'), '2.50');
}

test('two presses in one frame withdraw once', async () => {
  const onWithdraw = jest.fn<(usd: number, address: string, idem: string) => Promise<void>>(async () => {});
  await render(<WithdrawSheet open availableUsd={10} onClose={jest.fn()} onWithdraw={onWithdraw} />);
  await fill();
  // Two presses before React flushes the first: both read step === 'form', so only the ref latch stands
  // between them and a double debit. (Two overlapping fireEvent.press calls would nest act scopes.)
  const btn = screen.getByLabelText('Withdraw');
  await act(async () => { btn.props.onClick({}); btn.props.onClick({}); });
  expect(onWithdraw).toHaveBeenCalledTimes(1);
  expect(onWithdraw.mock.calls[0]?.[0]).toBe(2.5);
  expect(await screen.findByText('$2.49 sent')).toBeTruthy();
});

test('a failed attempt shows reviewed copy and retries with the same idempotency key', async () => {
  const onWithdraw = jest.fn<(usd: number, address: string, idem: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('withdraw: raw developer message'))
    .mockResolvedValueOnce(undefined);
  await render(<WithdrawSheet open availableUsd={10} onClose={jest.fn()} onWithdraw={onWithdraw} />);
  await fill();
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  expect(await screen.findByText(/Something went wrong\. Check your balance/)).toBeTruthy();
  expect(screen.queryByText(/raw developer message|capsule|Deposit USDC/)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Try again'));
  expect(await screen.findByText('$2.49 sent')).toBeTruthy();
  expect(onWithdraw).toHaveBeenCalledTimes(2);
  expect(onWithdraw.mock.calls[0]?.[2]).toBe(onWithdraw.mock.calls[1]?.[2]);
  expect(onWithdraw.mock.calls[0]?.[2]).toMatch(/\S/);
});

test('editing after a failed attempt is a new intent with a new key', async () => {
  const onWithdraw = jest.fn<(usd: number, address: string, idem: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('first'))
    .mockResolvedValueOnce(undefined);
  await render(<WithdrawSheet open availableUsd={10} onClose={jest.fn()} onWithdraw={onWithdraw} />);
  await fill();
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  await screen.findByText(/Check your balance/);
  await fireEvent.changeText(screen.getByLabelText('Amount in US dollars'), '9');
  expect(screen.queryByText(/Check your balance/)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  expect(await screen.findByText('$8.99 sent')).toBeTruthy();
  expect(onWithdraw).toHaveBeenCalledTimes(2);
  expect(onWithdraw.mock.calls[0]?.[0]).toBe(2.5);
  expect(onWithdraw.mock.calls[1]?.[0]).toBe(9);
  expect(onWithdraw.mock.calls[0]?.[2]).not.toBe(onWithdraw.mock.calls[1]?.[2]);
});

test('the sheet cannot close while a transfer is in flight, and a late resolution never shows a receipt', async () => {
  let resolve: () => void = () => {};
  const onWithdraw = jest.fn<(usd: number, address: string, idem: string) => Promise<void>>(() => new Promise<void>((r) => { resolve = r; }));
  const onClose = jest.fn();
  await render(<WithdrawSheet open availableUsd={10} onClose={onClose} onWithdraw={onWithdraw} />);
  await fill();
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  await fireEvent.press(screen.getByLabelText('Close')); // the × is disabled while busy
  await fireEvent(screen.getByTestId('withdraw-sheet'), 'requestClose'); // Android back reaches close() directly
  expect(onClose).not.toHaveBeenCalled();
  resolve();
  expect(await screen.findByText('$2.49 sent')).toBeTruthy();
});

test('amounts are whole cents: what the button says is what is sent', async () => {
  const onWithdraw = jest.fn<(usd: number, address: string, idem: string) => Promise<void>>(async () => {});
  await render(<WithdrawSheet open availableUsd={2000} onClose={jest.fn()} onWithdraw={onWithdraw} />);
  await fireEvent.changeText(screen.getByLabelText('Solana address'), ADDR);
  for (const bad of ['2.505', '1e3', '0x10', '1,000.50', '5.', '-3']) {
    await fireEvent.changeText(screen.getByLabelText('Amount in US dollars'), bad);
    expect(screen.queryByText(/^Withdraw \$/)).toBeNull(); // no amount on the button: not a valid amount
    await fireEvent.press(screen.getByLabelText('Withdraw'));
  }
  expect(onWithdraw).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Amount in US dollars'), '2,5');
  expect(screen.getByText('Withdraw $2.50')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  expect(onWithdraw.mock.calls[0]?.[0]).toBe(2.5);
  expect(await screen.findByText('$2.49 sent')).toBeTruthy();
});

test('the bound is the USDC balance the sheet names', async () => {
  const onWithdraw = jest.fn<(usd: number, address: string, idem: string) => Promise<void>>(async () => {});
  await render(<WithdrawSheet open availableUsd={5} onClose={jest.fn()} onWithdraw={onWithdraw} />);
  expect(screen.getByText('$5.00 USDC available on Solana')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Solana address'), ADDR);
  await fireEvent.changeText(screen.getByLabelText('Amount in US dollars'), '5.01');
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  expect(onWithdraw).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Amount in US dollars'), '5');
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  expect(onWithdraw.mock.calls[0]?.[0]).toBe(5);
});

// The destination: the sheet sends money to whatever is typed here, so "looks like an address" is not the bar (#187).
test('a string that is not an address cannot be withdrawn to, however much it looks like one', async () => {
  const onWithdraw = jest.fn<(usd: number, address: string, idem: string) => Promise<void>>(async () => {});
  await render(<WithdrawSheet open availableUsd={10} onClose={jest.fn()} onWithdraw={onWithdraw} />);
  await fireEvent.changeText(screen.getByLabelText('Amount in US dollars'), '2.50');
  // Not `ADDR` with a character dropped or added: base58 carries no checksum, so a 44-character address with its last
  // character removed is usually another perfectly valid 32-byte address (measured — it is why this loop lists values whose
  // byte counts `solanaAddress.test.ts` pins, and why no client-side check can catch a typo).
  for (const bad of [NOT_AN_ADDRESS, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'DEMO-WALLET-DO-NOT-SEND', 'z'.repeat(44), '']) {
    await fireEvent.changeText(screen.getByLabelText('Solana address'), bad);
    expect(screen.queryByText(/^Withdraw \$/)).toBeNull(); // no amount on the button: the sheet will not send
    await fireEvent.press(screen.getByLabelText('Withdraw'));
  }
  expect(onWithdraw).not.toHaveBeenCalled();
  // ...and the run is not vacuous: the real address goes through, in the same sheet, on the next keystroke.
  await fireEvent.changeText(screen.getByLabelText('Solana address'), ` ${ADDR} `); // trimmed, as a paste arrives
  expect(screen.getByText('Withdraw $2.50')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Withdraw'));
  expect(onWithdraw.mock.calls[0]?.[1]).toBe(ADDR);
});
