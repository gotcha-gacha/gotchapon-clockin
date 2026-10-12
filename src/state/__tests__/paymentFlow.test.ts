import { expect, jest, test } from '@jest/globals';
import type { PullPrepareResponse } from '@/api';
import { SERVED_PAYMENT, SERVED_PAYMENT_INPUT as I } from '@/api/__fixtures__/servedPayment';
import { paymentSignable, pullCommitWireRequest, signPreparedTransfer } from '../paymentFlow';

// Byte for byte what the server's preparePaymentTransaction builds (server/test/clientPaymentGuard.test.ts holds it there).
const prepared: PullPrepareResponse = {
  pullId: I.pullId,
  costUsd: 1,
  useFreePulls: 0,
  expiresAt: '2099-01-01T00:00:00.000Z',
  transfer: { to: I.treasury, mint: I.mint, amount: I.amount, memo: I.pullId, transactionBase64: SERVED_PAYMENT },
};
const expected = { to: I.treasury, mint: I.mint };
const real = { prepared, useMockPayment: false, expected, authority: I.wallet };
const OTHER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('passes the unchanged server-built transaction to Privy when it pays what the build pinned', async () => {
  const signer = jest.fn(async () => 'user-signed-transaction');
  expect(paymentSignable(real)).toBe(true);
  await expect(signPreparedTransfer({ ...real, signer })).resolves.toBe('user-signed-transaction');
  expect(signer).toHaveBeenCalledWith(SERVED_PAYMENT);
});

test.each([
  ['another treasury pinned', { expected: { to: OTHER, mint: I.mint } }],
  ['another mint pinned', { expected: { to: I.treasury, mint: OTHER } }],
  ['nothing pinned on this build', { expected: null }],
  ['a different wallet asked to sign', { authority: OTHER }],
  ['no wallet', { authority: null }],
  ['the quote naming another pull', { prepared: { ...prepared, pullId: 'pull_other', transfer: { ...prepared.transfer!, memo: 'pull_other' } } }],
  ['a quote whose JSON says one amount and whose transaction pays another', { prepared: { ...prepared, transfer: { ...prepared.transfer!, amount: 1 } } }],
])('never asks Privy to sign with %s', async (_label, change) => {
  const signer = jest.fn(async () => 'must-not-sign');
  const input = { ...real, ...change };
  expect(paymentSignable(input)).toBe(false);
  await expect(signPreparedTransfer({ ...input, signer })).rejects.toThrow(/does not match this pull/);
  expect(signer).not.toHaveBeenCalled();
});

test('refuses a real pull when the transaction or signer is missing', async () => {
  await expect(signPreparedTransfer({
    ...real, prepared: { ...prepared, transfer: undefined }, signer: jest.fn(async () => 'unused'),
  })).rejects.toThrow(/signer is not ready/);
  await expect(signPreparedTransfer({ ...real, signer: null })).rejects.toThrow(/signer is not ready/);
  expect(paymentSignable({ ...real, prepared: { ...prepared, transfer: undefined } })).toBe(false);
});

test('keeps local mock payments off the real signer, and signs them with nothing pinned', async () => {
  const signer = jest.fn(async () => 'must-not-sign');
  const mock = { prepared, useMockPayment: true, expected: null, authority: null };
  expect(paymentSignable(mock)).toBe(true);
  await expect(signPreparedTransfer({ ...mock, signer })).resolves.toBe(`mock:${I.pullId}`);
  expect(signer).not.toHaveBeenCalled();
});

test('maps a signed wire transaction to the API commit field', () => {
  expect(pullCommitWireRequest({ pullId: 'pull-1', txSignature: 'base64-wire' }, true)).toEqual({
    pullId: 'pull-1', signedTransactionBase64: 'base64-wire',
  });
  expect(pullCommitWireRequest({ pullId: 'pull-1', txSignature: 'mock:pull-1' }, true)).toEqual({
    pullId: 'pull-1', txSignature: 'mock:pull-1',
  });
});
