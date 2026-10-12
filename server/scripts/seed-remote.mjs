// Replaces the catalog (albums, cards, odds, gachas, stock) on a REMOTE D1, and nothing else (#275). The old
// `db:seed:mainnet-dev` ran the local full reset remotely: it failed half-way on the first database with a paid pull
// (FOREIGN KEY constraint failed, sqlite having already emptied some tables), and had it succeeded it would have deleted
// `payment_receipts` — the ledger that stops one payment buying two pulls — and every user, whose cascade frees the faucet.
//
// So, in order, before anything is written:
//   1. `--confirm` is required; without it this prints what it would do and exits 1.
//   2. It counts every ledger row that references the catalog (derived from schema.sql: pulls, user inventory, outcomes, …).
//      Any row at all refuses: replacing the catalog under a live ledger breaks it. Resetting such a database is a new
//      database, not a reseed (server/README.md).
//   3. Only then is the catalog-only seed (build-seed.mjs `mode: 'catalog'`) executed. It never names a ledger table.
//
//   node scripts/seed-remote.mjs <env> --confirm        (env as in wrangler.jsonc, e.g. mainnet-dev)
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildSeed, catalogDependents, schemaTables } from './build-seed.mjs';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const wranglerBin = fileURLToPath(new URL(`../../node_modules/.bin/wrangler${process.platform === 'win32' ? '.cmd' : ''}`, import.meta.url));

/** `wrangler d1 execute … --json` as it answers (observed locally, 27 Sept): `[{ results: [row…], success, meta }]`. */
export function wranglerRunner(args) {
  const result = spawnSync(wranglerBin, args, { cwd: serverDir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/** The only environment a catalog reseed may reach (PR #300's review): its stock is fixture stock. Production's stock is what
 *  the vault holds, and a pre-launch production database has an empty ledger, so the live-ledger refusal would not stop a
 *  reseed writing 40 of every common and a graded slab into it. */
export const RESEEDABLE_ENVS = ['mainnet-dev'];

function databaseFor(config, env) {
  if (!RESEEDABLE_ENVS.includes(env)) {
    throw new Error(env === 'local'
      ? 'local is not remote: use `pnpm db:seed` (a full reset of the local database)'
      : `--env ${env} is not reseedable: only ${RESEEDABLE_ENVS.join(', ')} holds fixture stock. Nothing was changed.`);
  }
  const block = config.env?.[env];
  const db = block?.d1_databases?.find((binding) => binding.binding === 'DB');
  if (!block || !db) throw new Error(`wrangler.jsonc has no D1 binding for --env ${env}`);
  return db.database_name;
}

/**
 * Runs the remote catalog reseed, or refuses. `run(args)` returns wrangler's stdout (injectable for tests). Returns the
 * ledger counts it read. Throws, having executed nothing but the count, on any refusal.
 */
export async function seedRemote(env, { confirm = false, run = wranglerRunner, log = console.log } = {}) {
  const text = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(text.replace(/^(?:\s*\/\/[^\n]*\n)+/, ''));
  const database = databaseFor(config, env);
  const dependents = catalogDependents(schemaTables(await readFile(new URL('../schema.sql', import.meta.url), 'utf8')));
  if (!confirm) {
    throw new Error(`This replaces the catalog of ${database} (--env ${env}, REMOTE). It refuses while any of ${dependents.join(', ')} has a row. Re-run with --confirm.`);
  }
  const count = `SELECT ${dependents.map((table) => `(SELECT COUNT(*) FROM ${table}) AS ${table}`).join(', ')}`;
  const answer = JSON.parse(run(['d1', 'execute', database, '--env', env, '--remote', '--json', '--command', count]));
  const counts = answer?.[0]?.results?.[0];
  if (!answer?.[0]?.success || !counts || dependents.some((table) => !Number.isInteger(counts[table]) || counts[table] < 0)) {
    throw new Error(`Could not read the ledger counts of ${database}; nothing was changed. Answer: ${JSON.stringify(answer).slice(0, 300)}`);
  }
  const live = dependents.filter((table) => counts[table] > 0);
  if (live.length) {
    throw new Error(`${database} has a live ledger (${live.map((table) => `${table}: ${counts[table]}`).join(', ')}): replacing the catalog would break it, so nothing was changed. A database in use is reset by creating a new one (server/README.md), not reseeded.`);
  }
  const file = await buildSeed({ mode: 'catalog' });
  run(['d1', 'execute', database, '--env', env, '--remote', `--file=${file}`]);
  log(`Replaced the catalog of ${database} (--env ${env}). No ledger table was touched.`);
  return counts;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.argv[2];
  if (!env || env.startsWith('--')) { console.error('usage: node scripts/seed-remote.mjs <env> --confirm'); process.exit(2); }
  try { await seedRemote(env, { confirm: process.argv.includes('--confirm') }); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}
