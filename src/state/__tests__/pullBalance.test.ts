import { expect, test } from '@jest/globals';
import { USDC_BASE } from '@/api/contract';
import { debitBaseline, pullBalanceTotal } from '@/state/pullBalance';

test('a pull debit lowers the baseline, and a pull balance cannot climb back over it', () => {
  const before = 27 * USDC_BASE;
  const after = debitBaseline(before, 1.5);
  expect(after).toBe(25.5 * USDC_BASE);
  expect(pullBalanceTotal(after, before)).toBeNull();
  expect(pullBalanceTotal(after, after!)).toBe(after);
  expect(pullBalanceTotal(after, 25 * USDC_BASE)).toBe(25 * USDC_BASE);
});

test('a balance read before any baseline is kept, and a rise outside a pull is not this guard', () => {
  expect(debitBaseline(null, 1.5)).toBeNull();
  expect(pullBalanceTotal(null, 27 * USDC_BASE)).toBe(27 * USDC_BASE);
});
