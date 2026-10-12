/**
 * Album P1 (the locked 75) is `supply = 'infinite'`: a digital allocation, not a vault count.
 * Finite rows — completion holos today, seasonal gold and partner credits when those catalogs
 * exist — are the only rows allocation decrements (#313).
 */
export const INFINITE_AVAILABLE_REPORT = 1_000_000_000;

/** Drawable: an infinite P1 row, or a finite row that still has a copy. */
export const DRAWABLE_SQL = "(i.supply = 'infinite' OR i.available > 0)";

/** Decrement a finite vault row. An infinite row matches nothing, so a shared call cannot move it. */
export function finiteDecrement(db: D1Database, inventoryKey: string, serialDelta: number) {
  return db.prepare(`UPDATE stock_items SET available = available - 1, serial_counter = serial_counter + ?
    WHERE inventory_key = ? AND supply = 'finite'`).bind(serialDelta, inventoryKey);
}
