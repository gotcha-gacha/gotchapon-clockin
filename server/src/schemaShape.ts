// What a deployed D1 actually has (#268). There is no migration system before go-live (CLAUDE.md, 21 Sept): a feature's script
// (scripts/magicblock-draw.sql, scripts/refunds.sql) reaches each D1 when someone runs it, so code that runs on every request or
// on a cron must work on a D1 it has not reached yet, as #419 made prepare do for #406's columns.
const KNOWN_TABLES = new Set(['pulls', 'refunds', 'refund_attempts', 'sweep_checks']);

export async function hasColumn(db: D1Database, table: 'pulls', column: string): Promise<boolean> {
  if (!KNOWN_TABLES.has(table)) throw new Error('unknown table');
  const rows = await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>();
  return rows.results.some((row) => row.name === column);
}

export async function hasTable(db: D1Database, table: 'refunds' | 'refund_attempts' | 'sweep_checks'): Promise<boolean> {
  if (!KNOWN_TABLES.has(table)) throw new Error('unknown table');
  return !!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first());
}

/** #406's columns on pulls, all added together by scripts/magicblock-draw.sql. */
export const hasDrawColumns = (db: D1Database) => hasColumn(db, 'pulls', 'draw_randomness');
