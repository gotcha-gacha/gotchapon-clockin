import { USDC_BASE } from '@/api/contract';

/** Lower the deposit baseline by a pull's price. Null when no baseline has been read yet. */
export function debitBaseline(lastTotal: number | null, usd: number): number | null {
  if (lastTotal === null || !(usd > 0) || !Number.isFinite(usd)) return lastTotal;
  return Math.max(0, lastTotal - Math.round(usd * USDC_BASE));
}

/**
 * A pull's own balance may replace the pill. It must not raise the pill above the post-debit
 * baseline: a chain read that has not seen the transfer yet is the pre-spend balance.
 * Null means leave the pill where the debit put it.
 */
export function pullBalanceTotal(lastTotal: number | null, reported: number): number | null {
  if (lastTotal !== null && reported > lastTotal) return null;
  return reported;
}
