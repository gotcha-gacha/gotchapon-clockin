import { hasDrawColumns, hasTable } from './schemaShape';

/** The ledger invariants `GET /admin/ledger` checks (#277): until then `/health` answered `ledgerInvariantsAt: now()` having checked nothing.
 *  Each query counts rows that break one rule of OPS_PLAYBOOK §2's payment ledger; a healthy ledger answers zero for all of
 *  them. Stock can never go negative (a CHECK and the `stock_never_negative` trigger refuse it), so it is not counted here. */
export const LEDGER_INVARIANTS = {
  // A receipt and its obligation are inserted in one batch: a receipt alone is a payment nobody owes cards or a refund for.
  receiptsWithoutObligation: `SELECT COUNT(*) AS n FROM payment_receipts r
    WHERE NOT EXISTS (SELECT 1 FROM payment_obligations o WHERE o.signature = r.signature)`,
  // A receipt pays exactly what its pull quoted, in the pull's asset.
  receiptsNotMatchingPull: `SELECT COUNT(*) AS n FROM payment_receipts r JOIN pulls p ON p.id = r.pull_id
    WHERE r.amount <> p.cost_base OR r.asset <> p.asset`,
  // An obligation marked fulfilled has cards: its pull was committed.
  fulfilledWithoutCommit: `SELECT COUNT(*) AS n FROM payment_obligations o
    WHERE o.status = 'fulfilled' AND NOT EXISTS (SELECT 1 FROM pull_settlements s WHERE s.pull_id = o.pull_id AND s.kind = 'committed')`,
  // A committed pull's obligation is fulfilled in the same batch; a paid pull left pending after it committed is owed twice.
  committedButPending: `SELECT COUNT(*) AS n FROM payment_obligations o
    JOIN pull_settlements s ON s.pull_id = o.pull_id AND s.kind = 'committed' WHERE o.status = 'pending'`,
  // #268: an obligation decided as a refund that has not been paid back within an hour: the sweep is off, failing, or out
  // of float. (Timestamps are ISO strings, so they compare as text.)
  refundsOverdue: `SELECT COUNT(*) AS n FROM payment_obligations o
    WHERE o.status = 'refund_pending' AND o.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`,
  // #268: a refund marked sent whose obligation is not refunded, or a refunded obligation with no sent refund.
  refundsInconsistent: `SELECT COUNT(*) AS n FROM payment_obligations o LEFT JOIN refunds f ON f.pull_id = o.pull_id
    WHERE (o.status = 'refunded') <> (f.status IS NOT NULL AND f.status = 'sent')`,
  // #268/#406: a paid pull whose drawn bytes are stored but which has not settled in 15 minutes: owed cards, not money, and
  // only a hand fix settles it.
  paidPullCannotSettle: `SELECT COUNT(*) AS n FROM payment_obligations o JOIN pulls p ON p.id = o.pull_id
    WHERE o.status = 'pending' AND p.status = 'prepared' AND p.draw_randomness IS NOT NULL
      AND o.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes')`,
  // #420: a recorded MagicBlock pull the sweep has not been able to decide for an hour (its draw chain cannot be read: the
  // draw settings were removed while pulls were open, or the RPC is down). Paid, and neither settled nor refunded.
  magicblockUndecided: `SELECT COUNT(*) AS n FROM payment_obligations o JOIN pulls p ON p.id = o.pull_id
    WHERE o.status = 'pending' AND p.status = 'prepared' AND p.draw_source = 'magicblock' AND p.draw_randomness IS NULL
      AND o.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`,
} as const;

export type LedgerCheck = { ok: boolean; violations: Record<keyof typeof LEDGER_INVARIANTS, number> };

export async function checkLedger(db: D1Database): Promise<LedgerCheck> {
  // A check that names a table or column a feature's script adds is skipped (counted 0) on a D1 the script has not reached:
  // there the thing it counts cannot exist yet, and one failing query must not take the whole check down (#419).
  const [refunds, drawColumns] = await Promise.all([hasTable(db, 'refunds'), hasDrawColumns(db)]);
  const runs = (name: keyof typeof LEDGER_INVARIANTS) =>
    (name !== 'refundsInconsistent' || refunds) && (!['paidPullCannotSettle', 'magicblockUndecided'].includes(name) || drawColumns);
  const names = (Object.keys(LEDGER_INVARIANTS) as (keyof typeof LEDGER_INVARIANTS)[]).filter(runs);
  const rows = await db.batch<{ n: number }>(names.map((name) => db.prepare(LEDGER_INVARIANTS[name])));
  const counted = Object.fromEntries(names.map((name, index) => [name, rows[index].results[0]?.n ?? 0]));
  const violations = Object.fromEntries((Object.keys(LEDGER_INVARIANTS) as (keyof typeof LEDGER_INVARIANTS)[])
    .map((name) => [name, counted[name] ?? 0])) as LedgerCheck['violations'];
  return { ok: Object.values(violations).every((count) => count === 0), violations };
}
