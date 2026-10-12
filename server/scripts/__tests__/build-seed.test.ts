// #275: the seed's reset is derived from schema.sql, so no table can be missed, and a remote reseed replaces the catalog only,
// refusing while any ledger row references it. The SQL is run for real, in node:sqlite, against schema.sql with foreign keys on.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import {
  buildSeed, catalogDependents, CATALOG_TABLES, deleteOrder, LEDGER_TABLES, schemaTables, STATE_TABLES,
} from '../build-seed.mjs';
import { seedRemote } from '../seed-remote.mjs';
import { loadV0Catalog } from '../v0-catalog.mjs';

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const tables = schemaTables(schema);
const scratch = mkdtempSync(join(tmpdir(), 'seed-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const seed = async (db: DatabaseSync, mode: 'local' | 'catalog') =>
  db.exec(readFileSync(await buildSeed({ mode, output: join(scratch, `${mode}-${Math.random()}.sql`) }), 'utf8'));

/** A database in use: the seed, then a paid pull with its receipt and obligation, a deposit, a faucet grant. */
async function inUse(): Promise<DatabaseSync> {
  const db = database();
  await seed(db, 'local');
  const now = '2026-09-01T00:00:00.000Z';
  db.exec(`INSERT INTO pulls (id, user_id, idem, sequence, gacha_id, inventory_version, odds_config_id, free_odds_config_id,
      client_seed, seed_source, count, targeted, asset, cost_base, status, expires_at, tx_signature, created_at)
    VALUES ('pull_1', 'demo-user', 'i1', 1, 'all-cards', 1, 'odds:paid:v1', 'odds:free-common:v1', '00', 'server', 1, 0, 'USDC',
      1000000, 'prepared', '${now}', 'sig_1', '${now}');`);
  db.exec(`INSERT INTO payment_receipts (signature, pull_id, asset, amount, destination, slot, finalized_at)
      VALUES ('sig_1', 'pull_1', 'USDC', 1000000, 'treasury', 1, '${now}');
    INSERT INTO payment_obligations (pull_id, signature, status, created_at, updated_at)
      VALUES ('pull_1', 'sig_1', 'pending', '${now}', '${now}');
    INSERT INTO deposits (id, user_id, idem, source_wallet, destination_wallet, mint, amount, status, expires_at, transaction_base64, created_at)
      VALUES ('d1', 'demo-user', 'di', 's', 'w', 'm', 1, 'prepared', '${now}', 'AA', '${now}');
    INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, created_at)
      VALUES ('g1', 'demo-user', 'w', 'm', 1, 'reserved', '${now}');
    UPDATE gacha_state SET next_pull_sequence = 7 WHERE singleton = 1;`);
  return db;
}

test('the parser sees what SQLite sees: every table schema.sql creates, and every foreign key, from sqlite_master itself', () => {
  // Checked against the database, not against the parser (PR #300's review): a `CREATE TABLE IF NOT EXISTS`, lowercase SQL or
  // a quoted reference was invisible to both sides of the old check, and the catalog seed then deleted an unseen table's rows.
  const db = database();
  const real = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((row) => row.name).sort();
  assert.deepEqual(tables.map((table) => table.name).sort(), real);
  for (const name of real) {
    const refs = [...new Set((db.prepare(`PRAGMA foreign_key_list(${name})`).all() as { table: string }[])
      .map((fk) => fk.table).filter((ref) => ref !== name))].sort();
    assert.deepEqual([...tables.find((table) => table.name === name)!.refs].sort(), refs, name);
  }
});

test('every table in schema.sql is classified exactly once: catalog, state or ledger', () => {
  const all = tables.map((table) => table.name).sort();
  const classified = [...CATALOG_TABLES, ...STATE_TABLES, ...LEDGER_TABLES];
  assert.equal(new Set(classified).size, classified.length, 'a table is in two classes');
  assert.deepEqual([...classified].sort(), all);
});

test('the delete order puts every child before the table it references', () => {
  const names = tables.map((table) => table.name);
  const order = deleteOrder(tables, names);
  assert.equal(order.length, names.length);
  for (const table of tables) for (const ref of table.refs) {
    assert.ok(order.indexOf(table.name) < order.indexOf(ref), `${table.name} must be deleted before ${ref}`);
  }
});

test('the catalog\'s dependents are the ledger tables that reference it', () => {
  assert.deepEqual(new Set(catalogDependents(tables)), new Set(['user_inventory', 'pulls', 'pull_outcomes', 'album_completions']));
});

test('the local seed resets a database in use, with foreign keys on, and leaves no ledger row behind (the old one failed here)', async () => {
  const db = await inUse();
  // The control: a paid pull, its receipt and obligation (ON DELETE RESTRICT), a deposit and a faucet grant are there.
  for (const table of ['pulls', 'payment_receipts', 'payment_obligations', 'deposits', 'faucet_grants']) assert.equal(count(db, table), 1, table);
  await seed(db, 'local');
  for (const table of LEDGER_TABLES.filter((name) => !['users', 'balances'].includes(name))) assert.equal(count(db, table), 0, table);
  assert.equal(count(db, 'users'), 1); // the demo user, re-created
  assert.ok(count(db, 'cards') > 0);
  assert.equal((db.prepare('SELECT next_pull_sequence AS n FROM gacha_state WHERE singleton = 1').get() as { n: number }).n, 1);
});

test('the catalog seed writes and deletes no ledger table: users, balances, deposits and faucet grants survive', async () => {
  const db = database();
  await seed(db, 'local');
  db.exec(`INSERT INTO faucet_grants (id, user_id, wallet, mint, amount, status, created_at)
    VALUES ('g1', 'demo-user', 'w', 'm', 1, 'reserved', '2026-09-01T00:00:00.000Z');`);
  const before = LEDGER_TABLES.map((table) => count(db, table));
  const catalogSql = readFileSync(await buildSeed({ mode: 'catalog', output: join(scratch, 'catalog-only.sql') }), 'utf8');
  for (const table of LEDGER_TABLES) assert.doesNotMatch(catalogSql, new RegExp(`\\b(FROM|INTO|UPDATE) ${table}\\b`), table);
  db.exec(catalogSql);
  assert.deepEqual(LEDGER_TABLES.map((table) => count(db, table)), before);
  assert.ok(count(db, 'cards') > 0);
});

test('the v0 catalog is the pull pool: 75 infinite album SKUs, C5 Rolycoly, C15 Wimpod, no rare tier in a gacha', async () => {
  const db = database();
  await seed(db, 'local');
  const live = (db.prepare("SELECT id FROM albums WHERE status = 'live' ORDER BY sort_order").all() as { id: string }[]).map((row) => row.id);
  assert.deepEqual(live, ['A', 'B', 'C']);
  assert.equal(count(db, 'album_cards'), 75);
  const slot = (album: string, n: number) => (db.prepare(`SELECT ac.card_id, c.name FROM album_cards ac JOIN cards c ON c.id = ac.card_id
    WHERE ac.album_id = ? AND ac.slot = ?`).get(album, n) as { card_id: string; name: string });
  const c5 = slot('C', 5);
  const c15 = slot('C', 15);
  const a20 = slot('A', 20);
  const b7 = slot('B', 7);
  assert.equal(c5.card_id, 'sv5-93');
  assert.equal(c5.name, 'Rolycoly');
  assert.equal(c15.card_id, 'sv4-47');
  assert.equal(c15.name, 'Wimpod');
  assert.equal(a20.card_id, 'sv6-83');
  assert.equal(a20.name, 'Girafarig');
  assert.equal(b7.card_id, 'sv3-9');
  assert.equal(b7.name, 'Foongus');
  const albumIds = new Set((db.prepare('SELECT card_id FROM album_cards').all() as { card_id: string }[]).map((row) => row.card_id));
  assert.equal(albumIds.has('sv5-66'), false);
  assert.equal(albumIds.has('sv9-10'), false);
  const names = db.prepare(`SELECT c.name FROM album_cards ac JOIN cards c ON c.id = ac.card_id`).all() as { name: string }[];
  assert.equal(new Set(names.map((row) => row.name)).size, 75);
  const pullKeys = db.prepare("SELECT inventory_key FROM gacha_inventory WHERE gacha_id = 'all-cards'").all() as { inventory_key: string }[];
  assert.equal(pullKeys.length, 75);
  assert.ok(pullKeys.every((row) => row.inventory_key.startsWith('common:')));
  for (const id of ['A', 'B', 'C']) {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM gacha_inventory WHERE gacha_id = ?').get(`album:${id}`) as { n: number }).n, 25);
  }
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM stock_items WHERE tier = 'common' AND supply = 'infinite'`).get() as { n: number }).n, 75);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM gacha_inventory gi JOIN stock_items i ON i.inventory_key = gi.inventory_key
    WHERE i.tier != 'common'`).get() as { n: number }).n, 0);
  // Completion holos stay a finite vault, outside every pull gacha.
  const holos = db.prepare("SELECT COUNT(*) AS n FROM stock_items WHERE tier = 'holo' AND supply = 'finite' AND available > 0").get() as { n: number };
  assert.ok(holos.n > 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM gacha_inventory gi JOIN stock_items i ON i.inventory_key = gi.inventory_key
    WHERE i.tier = 'holo'`).get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM stock_items WHERE tier IN ('reverse', 'ultra', 'graded')").get() as { n: number }).n, 0);
  // Paid and free odds are 100% common. A leftover rare weight would publish a rare % and make prepare
  // require that vault for every card of a ×5/×10.
  for (const id of ['odds:paid:v1', 'odds:free-common:v1']) {
    const tiers = db.prepare('SELECT tier, weight FROM odds_config_tiers WHERE odds_config_id = ? AND weight > 0 ORDER BY sort_order').all(id) as { tier: string; weight: number }[];
    assert.equal(tiers.length, 1, id);
    assert.equal(tiers[0].tier, 'common', id);
    assert.equal(tiers[0].weight, 1_000_000, id);
    assert.equal((db.prepare('SELECT total_weight AS n FROM odds_configs WHERE id = ?').get(id) as { n: number }).n, 1_000_000, id);
  }
});

test('the commons-only patch republishes paid odds and disables rare membership without touching the ledger or completion holos', async () => {
  const db = await inUse();
  // The shape mainnet-dev still has: the model ladder on the quoted paid config, and one graded slab
  // offered by every active gacha. A ×10 then restocks, because prepare requires each positive-weight tier.
  db.exec(`UPDATE odds_config_tiers SET weight = 770000 WHERE odds_config_id = 'odds:paid:v1' AND tier = 'common';
    INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order) VALUES
      ('odds:paid:v1', 'reverse', 122500, 'Reverse holo', 300000, 1),
      ('odds:paid:v1', 'holo', 90000, 'Holo rare', 1500000, 2),
      ('odds:paid:v1', 'ultra', 16000, 'Ultra rare', 12000000, 3),
      ('odds:paid:v1', 'graded', 1500, 'Graded slab', 60000000, 4);
    INSERT INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large)
      VALUES ('graded-slab', 'Slab', 'TEST', '1', 'Graded', 's', 'l');
    INSERT INTO stock_items (inventory_key, card_id, tier, available, supply)
      VALUES ('graded:slab', 'graded-slab', 'graded', 1, 'finite');
    INSERT INTO gacha_inventory (gacha_id, inventory_version, inventory_key, selection_weight, enabled)
      SELECT id, inventory_version, 'graded:slab', 1, 1 FROM gachas WHERE status = 'active';`);
  const holosBefore = (db.prepare("SELECT COALESCE(SUM(available), 0) AS n FROM stock_items WHERE tier = 'holo' AND supply = 'finite'").get() as { n: number }).n;
  assert.ok(holosBefore > 0);
  const pullsBefore = count(db, 'pulls');
  const patch = readFileSync(new URL('../commons-only-pulls.sql', import.meta.url), 'utf8');
  db.exec(patch);
  db.exec(patch); // a second run is a no-op
  for (const id of ['all-cards', 'album:A', 'album:B', 'album:C']) {
    assert.equal((db.prepare('SELECT paid_odds_config_id AS id FROM gachas WHERE id = ?').get(id) as { id: string }).id, 'odds:paid:commons', id);
  }
  const published = db.prepare(`SELECT tier, weight FROM odds_config_tiers WHERE odds_config_id = 'odds:paid:commons' AND weight > 0`).all() as { tier: string; weight: number }[];
  assert.equal(published.length, 1);
  assert.equal(published[0].tier, 'common');
  assert.equal(published[0].weight, 1_000_000);
  assert.equal((db.prepare("SELECT total_weight AS n FROM odds_configs WHERE id = 'odds:paid:commons'").get() as { n: number }).n, 1_000_000);
  // The config a prepared pull already quoted is left alone.
  assert.equal((db.prepare("SELECT weight FROM odds_config_tiers WHERE odds_config_id = 'odds:paid:v1' AND tier = 'graded'").get() as { weight: number }).weight, 1500);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM gacha_inventory gi JOIN stock_items i ON i.inventory_key = gi.inventory_key
    JOIN gachas g ON g.id = gi.gacha_id WHERE g.status = 'active' AND gi.enabled = 1 AND i.tier != 'common'`).get() as { n: number }).n, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM gacha_inventory gi JOIN gachas g ON g.id = gi.gacha_id
    WHERE g.status = 'active' AND gi.enabled = 1 AND gi.inventory_key LIKE 'common:%'`).get() as { n: number }).n, 75 + 75);
  assert.equal((db.prepare("SELECT available FROM stock_items WHERE inventory_key = 'graded:slab'").get() as { available: number }).available, 1);
  assert.equal((db.prepare("SELECT COALESCE(SUM(available), 0) AS n FROM stock_items WHERE tier = 'holo' AND supply = 'finite'").get() as { n: number }).n, holosBefore);
  assert.equal(count(db, 'pulls'), pullsBefore);
  assert.equal((db.prepare("SELECT odds_config_id FROM pulls WHERE id = 'pull_1'").get() as { odds_config_id: string }).odds_config_id, 'odds:paid:v1');
});

const albumCSql = readFileSync(new URL('../add-album-c.sql', import.meta.url), 'utf8');

/** Statements only: a comment may name a forbidden word without the script doing it. */
function sqlStatements(sql: string) {
  return sql.replace(/--[^\n]*/g, '');
}

function enabledOnCurrent(db: DatabaseSync, gachaId: string) {
  return (db.prepare(`SELECT COUNT(*) AS n FROM gacha_inventory gi
    JOIN gachas g ON g.id = gi.gacha_id AND gi.inventory_version = g.inventory_version
    WHERE g.id = ? AND gi.enabled = 1`).get(gachaId) as { n: number }).n;
}

/** The proved mainnet-dev shape: A and B only, commons-only paid odds, soon covers on sort_order 2. */
function stripAlbumC(db: DatabaseSync) {
  db.exec(`DELETE FROM gachas WHERE id = 'album:C';
    DELETE FROM stock_items WHERE album_id = 'C';
    DELETE FROM album_cards WHERE album_id = 'C';
    DELETE FROM albums WHERE id = 'C';
    DELETE FROM cards WHERE id IN ('sv5-93', 'sv4-47');
    UPDATE albums SET sort_order = sort_order - 1 WHERE status = 'soon';`);
}

test('add-album-c.sql inserts nothing but album C, and does not delete', () => {
  const body = sqlStatements(albumCSql);
  assert.doesNotMatch(body, /\bDELETE\b/i);
  assert.doesNotMatch(body, /\bDROP\b/i);
  assert.doesNotMatch(body, /\bUPDATE\s+stock_items\b/i);
  assert.doesNotMatch(body, /\bUPDATE\s+gacha/i);
  assert.doesNotMatch(body, /\bUPDATE\s+cards\b/i);
  assert.doesNotMatch(body, /odds:paid:v1/);
  assert.match(body, /odds:paid:commons/);
  assert.deepEqual([...body.matchAll(/\bUPDATE\s+(\w+)/gi)].map((match) => match[1]), ['albums']);
});

test('add-album-c.sql is a no-op when Wanderers is already seeded', async () => {
  const db = database();
  await seed(db, 'local');
  db.exec(readFileSync(new URL('../commons-only-pulls.sql', import.meta.url), 'utf8'));
  const before = {
    albums: db.prepare('SELECT id, sort_order, status FROM albums ORDER BY sort_order, id').all(),
    holos: db.prepare("SELECT inventory_key, available, supply FROM stock_items WHERE tier = 'holo' ORDER BY inventory_key").all(),
    enabled: enabledOnCurrent(db, 'all-cards'),
  };
  db.exec(albumCSql);
  db.exec(albumCSql);
  assert.deepEqual(db.prepare('SELECT id, sort_order, status FROM albums ORDER BY sort_order, id').all(), before.albums);
  assert.deepEqual(db.prepare("SELECT inventory_key, available, supply FROM stock_items WHERE tier = 'holo' ORDER BY inventory_key").all(), before.holos);
  assert.equal(enabledOnCurrent(db, 'all-cards'), before.enabled);
  assert.equal(enabledOnCurrent(db, 'album:C'), 25);
});

test('add-album-c.sql adds Wanderers to an A+B database and can run twice', async () => {
  const db = await inUse();
  db.exec(readFileSync(new URL('../commons-only-pulls.sql', import.meta.url), 'utf8'));
  const holos = db.prepare("SELECT inventory_key, available, supply FROM stock_items WHERE tier = 'holo' ORDER BY inventory_key").all();
  const abStock = db.prepare("SELECT inventory_key, available, supply FROM stock_items WHERE album_id IN ('A', 'B') ORDER BY inventory_key").all();
  const soon = db.prepare("SELECT id, sort_order FROM albums WHERE status = 'soon' ORDER BY id").all();
  const pulls = count(db, 'pulls');
  stripAlbumC(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM albums WHERE id = 'C'").get() as { n: number }).n, 0);
  assert.equal(enabledOnCurrent(db, 'all-cards'), 50);
  assert.equal((db.prepare("SELECT MIN(sort_order) AS n FROM albums WHERE status = 'soon'").get() as { n: number }).n, 2);
  // A card row the design seed already stored must be left alone.
  db.exec("UPDATE cards SET name = 'Kept name' WHERE id = 'sv7-88'");
  db.exec(albumCSql);
  db.exec(albumCSql);

  const catalog = (await loadV0Catalog()).find((album) => album.id === 'C')!;
  const slots = db.prepare(`SELECT ac.slot, ac.card_id, c.name FROM album_cards ac JOIN cards c ON c.id = ac.card_id
    WHERE ac.album_id = 'C' ORDER BY ac.slot`).all() as { slot: number; card_id: string; name: string }[];
  assert.equal(slots.length, 25);
  assert.deepEqual(slots.map((row) => [row.slot, row.card_id]), catalog.cards.map((card) => [card.slot, card.id]));
  assert.equal(slots.find((row) => row.card_id === 'sv7-88')?.name, 'Kept name');
  for (const card of catalog.cards) {
    if (card.id === 'sv7-88') continue;
    assert.equal(slots.find((row) => row.card_id === card.id)?.name, card.name, card.id);
  }
  assert.equal(slots[4].name, 'Rolycoly');
  assert.equal(slots[14].name, 'Wimpod');
  const album = db.prepare("SELECT id, title, subtitle, status, size, sort_order FROM albums WHERE id = 'C'").get() as {
    title: string; subtitle: string; status: string; size: number; sort_order: number;
  };
  assert.equal(album.title, 'Wanderers');
  assert.equal(album.subtitle, '25 from every path');
  assert.equal(album.status, 'live');
  assert.equal(album.size, 25);
  assert.equal(album.sort_order, 2);
  assert.deepEqual(db.prepare("SELECT id, sort_order FROM albums WHERE status = 'soon' ORDER BY id").all(), soon);
  assert.deepEqual((db.prepare("SELECT id FROM albums WHERE status = 'live' ORDER BY sort_order").all() as { id: string }[]).map((row) => row.id), ['A', 'B', 'C']);

  const gacha = db.prepare(`SELECT status, paid_odds_config_id, free_odds_config_id, inventory_version, price_base, targeted_price_base, supports_targeted
    FROM gachas WHERE id = 'album:C'`).get() as {
    status: string; paid_odds_config_id: string; free_odds_config_id: string; inventory_version: number;
    price_base: number; targeted_price_base: number; supports_targeted: number;
  };
  const albumA = db.prepare('SELECT free_odds_config_id, price_base, targeted_price_base FROM gachas WHERE id = ?').get('album:A') as {
    free_odds_config_id: string; price_base: number; targeted_price_base: number;
  };
  assert.equal(gacha.status, 'active');
  assert.equal(gacha.paid_odds_config_id, 'odds:paid:commons');
  assert.equal(gacha.free_odds_config_id, albumA.free_odds_config_id);
  assert.equal(gacha.price_base, albumA.price_base);
  assert.equal(gacha.targeted_price_base, albumA.targeted_price_base);
  assert.equal(gacha.supports_targeted, 1);
  assert.equal(gacha.inventory_version, 1);
  assert.equal(enabledOnCurrent(db, 'album:C'), 25);
  assert.equal(enabledOnCurrent(db, 'all-cards'), 75);
  const stock = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN supply = 'infinite' AND available = 0 THEN 1 ELSE 0 END) AS infinite_zero FROM stock_items WHERE album_id = 'C' AND tier = 'common'").get() as { n: number; infinite_zero: number };
  assert.equal(stock.n, 25);
  assert.equal(stock.infinite_zero, 25);
  assert.deepEqual(db.prepare("SELECT inventory_key, available, supply FROM stock_items WHERE tier = 'holo' ORDER BY inventory_key").all(), holos);
  assert.deepEqual(db.prepare("SELECT inventory_key, available, supply FROM stock_items WHERE album_id IN ('A', 'B') ORDER BY inventory_key").all(), abStock);
  assert.equal((db.prepare("SELECT card_id, name FROM album_cards ac JOIN cards c ON c.id = ac.card_id WHERE album_id = 'A' AND slot = 20").get() as { card_id: string; name: string }).name, 'Girafarig');
  assert.equal((db.prepare("SELECT name FROM album_cards ac JOIN cards c ON c.id = ac.card_id WHERE album_id = 'B' AND slot = 7").get() as { name: string }).name, 'Foongus');
  assert.equal(count(db, 'pulls'), pulls);
  assert.equal((db.prepare("SELECT odds_config_id FROM pulls WHERE id = 'pull_1'").get() as { odds_config_id: string }).odds_config_id, 'odds:paid:v1');
  assert.equal((db.prepare("SELECT paid_odds_config_id FROM gachas WHERE id = 'album:A'").get() as { paid_odds_config_id: string }).paid_odds_config_id, 'odds:paid:commons');
});

test('add-album-c.sql adds C commons to the current all-cards version only', async () => {
  const db = database();
  await seed(db, 'local');
  db.exec(readFileSync(new URL('../commons-only-pulls.sql', import.meta.url), 'utf8'));
  stripAlbumC(db);
  db.exec(`INSERT INTO gacha_inventory_versions (gacha_id, inventory_version, created_at)
      VALUES ('all-cards', 2, '2026-09-28T00:00:00.000Z');
    INSERT INTO gacha_inventory (gacha_id, inventory_version, inventory_key, selection_weight, enabled)
      SELECT 'all-cards', 2, inventory_key, selection_weight, enabled
      FROM gacha_inventory WHERE gacha_id = 'all-cards' AND inventory_version = 1;
    UPDATE gachas SET inventory_version = 2 WHERE id = 'all-cards';`);
  db.exec(albumCSql);
  const onVersion = (version: number) => (db.prepare(`SELECT COUNT(*) AS n FROM gacha_inventory
    WHERE gacha_id = 'all-cards' AND inventory_version = ? AND inventory_key LIKE 'common:C:%'`).get(version) as { n: number }).n;
  assert.equal(onVersion(1), 0);
  assert.equal(onVersion(2), 25);
  assert.equal(enabledOnCurrent(db, 'all-cards'), 75);
  assert.equal((db.prepare("SELECT inventory_version FROM gachas WHERE id = 'all-cards'").get() as { inventory_version: number }).inventory_version, 2);
});

test('the catalog seed on a database with a live ledger fails on a foreign key (which is why the remote script refuses first)', async () => {
  const db = await inUse();
  await assert.rejects(seed(db, 'catalog'), /FOREIGN KEY/);
});

describe_remote();
function describe_remote() {
  const answer = (counts: Record<string, number>) => JSON.stringify([{ results: [counts], success: true, meta: {} }]);
  const empty = Object.fromEntries(catalogDependents(tables).map((table) => [table, 0]));

  test('remote: without --confirm nothing is run', async () => {
    const calls: string[][] = [];
    await assert.rejects(seedRemote('mainnet-dev', { run: (args: string[]) => { calls.push(args); return ''; } }), /--confirm/);
    assert.deepEqual(calls, []);
  });

  test('remote: a live ledger refuses after the count, and the seed file is never executed', async () => {
    const calls: string[][] = [];
    await assert.rejects(
      seedRemote('mainnet-dev', { confirm: true, run: (args: string[]) => { calls.push(args); return answer({ ...empty, pulls: 3 }); } }),
      /live ledger \(pulls: 3\).*nothing was changed/,
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('--remote') && calls[0].includes('--command'));
    assert.ok(!calls[0].some((arg) => arg.startsWith('--file')));
  });

  test('remote: an unreadable count refuses too', async () => {
    for (const bad of ['[]', JSON.stringify([{ results: [{}], success: true }]), JSON.stringify([{ results: [empty], success: false }])]) {
      const calls: string[][] = [];
      await assert.rejects(seedRemote('mainnet-dev', { confirm: true, run: (args: string[]) => { calls.push(args); return bad; } }), /Could not read/);
      assert.equal(calls.length, 1);
    }
  });

  test('remote: an empty ledger runs the count, then the catalog-only seed, on the environment\'s database', async () => {
    const calls: string[][] = [];
    await seedRemote('mainnet-dev', { confirm: true, log: () => {}, run: (args: string[]) => { calls.push(args); return answer(empty); } });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].slice(0, 5), ['d1', 'execute', 'gachapon-mainnet-dev', '--env', 'mainnet-dev']);
    const file = calls[1].find((arg) => arg.startsWith('--file='))!.slice('--file='.length);
    assert.match(file, /catalog-seed\.sql$/);
    for (const table of LEDGER_TABLES) assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(`\\b(FROM|INTO|UPDATE) ${table}\\b`), table);
  });

  test('remote: only mainnet-dev can be reseeded; local and production are refused before anything runs', async () => {
    for (const [env, message] of [['local', /not remote/], ['production', /not reseedable/], ['staging', /not reseedable/]] as const) {
      const calls: string[][] = [];
      await assert.rejects(seedRemote(env, { confirm: true, run: (args: string[]) => { calls.push(args); return answer(empty); } }), message);
      assert.deepEqual(calls, [], env);
    }
  });

  test('remote: ONE row in ANY dependent refuses (each checked on its own)', async () => {
    for (const table of catalogDependents(tables)) {
      const calls: string[][] = [];
      await assert.rejects(
        seedRemote('mainnet-dev', { confirm: true, run: (args: string[]) => { calls.push(args); return answer({ ...empty, [table]: 1 }); } }),
        new RegExp(`live ledger \\(${table}: 1\\)`), table);
      assert.equal(calls.length, 1, table);
    }
  });

  test('remote: an answer missing any one count, or holding a non-count, refuses', async () => {
    for (const table of catalogDependents(tables)) {
      const { [table]: _dropped, ...missing } = empty;
      for (const counts of [missing, { ...empty, [table]: '0' }, { ...empty, [table]: -1 }, { ...empty, [table]: 0.5 }]) {
        const calls: string[][] = [];
        await assert.rejects(seedRemote('mainnet-dev', { confirm: true, run: (args: string[]) => { calls.push(args); return answer(counts as Record<string, number>); } }), /Could not read/, table);
        assert.equal(calls.length, 1);
      }
    }
  });

  test('remote: the count it sends is real SQL over the real schema, naming every dependent', async () => {
    const db = await inUse();
    let command = '';
    await assert.rejects(seedRemote('mainnet-dev', { confirm: true, run: (args: string[]) => {
      command = args[args.indexOf('--command') + 1];
      return JSON.stringify([{ results: [db.prepare(command).get()], success: true, meta: {} }]);
    } }), /live ledger \(pulls: 1\)/);
    for (const table of catalogDependents(tables)) assert.match(command, new RegExp(`FROM ${table}\\b`), table);
  });
}
