import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadV0Catalog } from './v0-catalog.mjs';

/**
 * Every table in schema.sql is one of three kinds (#275), and scripts/__tests__/build-seed.test.mjs fails if a table is
 * added without being classified here:
 *   - catalog: what this seed defines (albums, cards, odds, gachas, stock). A remote reseed replaces only these.
 *   - state: singletons the seed resets in place.
 *   - ledger: everything a player or a payment wrote (users, balances, pulls, receipts, obligations, deposits, faucet grants,
 *     inventory, \u2026). A remote reseed never touches these, and refuses while any of them references the catalog.
 */
export const CATALOG_TABLES = ['albums', 'cards', 'album_cards', 'stock_items', 'odds_configs', 'odds_config_tiers',
  'gachas', 'gacha_inventory_versions', 'gacha_inventory'];
export const STATE_TABLES = ['gacha_state'];
export const LEDGER_TABLES = ['users', 'balances', 'user_inventory', 'inventory_consumptions', 'pulls', 'pull_outcomes',
  'pull_settlements', 'payment_receipts', 'payment_obligations', 'refunds', 'refund_attempts', 'sweep_checks', 'faucet_grants', 'deposits', 'idempotency',
  'album_completions', 'completion_rewards', 'jupiter_gift_claims', 'season_ticket_balances', 'season_ticket_grants',
  'season_streaks', 'season_streak_grants'];

/** The tables schema.sql creates, each with the tables it references (FOREIGN KEY / REFERENCES), in file order. */
export function schemaTables(schema) {
  const tables = [];
  for (const match of schema.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
    const refs = [...match[2].matchAll(/REFERENCES (\w+)/g)].map((m) => m[1]).filter((ref) => ref !== match[1]);
    tables.push({ name: match[1], refs: [...new Set(refs)] });
  }
  return tables;
}

/** `names`, children before the tables they reference: the order DELETE can run in with foreign keys on. */
export function deleteOrder(tables, names) {
  const wanted = new Set(names);
  const byName = new Map(tables.map((table) => [table.name, table]));
  const order = [];
  const seen = new Set();
  const visit = (name, path = []) => {
    if (seen.has(name)) return;
    if (path.includes(name)) throw new Error(`foreign-key cycle: ${[...path, name].join(' -> ')}`);
    for (const child of tables.filter((table) => table.refs.includes(name))) {
      if (wanted.has(child.name)) visit(child.name, [...path, name]);
    }
    seen.add(name);
    if (wanted.has(name)) order.push(name);
  };
  for (const name of names) {
    if (!byName.has(name)) throw new Error(`${name} is not a table in schema.sql`);
    visit(name);
  }
  return order;
}

/** Ledger tables that reference a catalog table: while any has a row, replacing the catalog would break it. */
export function catalogDependents(tables) {
  const catalog = new Set(CATALOG_TABLES);
  return tables.filter((table) => !catalog.has(table.name) && !STATE_TABLES.includes(table.name)
    && table.refs.some((ref) => catalog.has(ref))).map((table) => table.name);
}

/**
 * Writes the seed SQL. `mode: 'local'` (the default) is a full reset of a disposable local database: every table is
 * emptied, children first, so no foreign key can stop it half-way (a hand-written list missed three tables and failed on the
 * first paid pull, #275). `mode: 'catalog'` is what a remote database gets: only the catalog is replaced, and no ledger
 * table is written or deleted; scripts/seed-remote.mjs refuses to run it while a ledger row still references the catalog.
 */
export async function buildSeed(options = {}) {
  const mode = options.mode ?? 'local';
  if (mode !== 'local' && mode !== 'catalog') throw new Error(`unknown seed mode ${mode}`);
  const tables = schemaTables(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  // Pull pool: the locked 75. Completion holos stay a finite vault and are not members of any pull gacha (#313).
  const liveAlbums = await loadV0Catalog();
  const design = JSON.parse(await readFile(new URL('../../data/design_cards.json', import.meta.url), 'utf8'));
  const generatedDir = new URL('../.generated/', import.meta.url);
  const output = new URL(options.output ?? (mode === 'local' ? '../.generated/dev-seed.sql' : '../.generated/catalog-seed.sql'), import.meta.url);
  const q = (value) => value === null ? 'NULL' : typeof value === 'number'
    ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
  const rows = (table, columns, values, chunkSize = 100) => {
    if (!values.length) return '';
    const statements = [];
    for (let offset = 0; offset < values.length; offset += chunkSize) {
      const chunk = values.slice(offset, offset + chunkSize);
      statements.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${chunk
        .map((row) => `  (${row.map(q).join(', ')})`).join(',\n')};`);
    }
    return `${statements.join('\n')}\n`;
  };

  const albums = liveAlbums.map((album) => ({
    id: album.id, title: album.title, subtitle: album.sub, cards: album.cards,
  }));
  const soonTitles = ['Ember Grove', 'Cloud Meadow', 'Starlit Burrow', 'Mossy Hollow', 'Coral Court', 'Frost Peaks'];
  const allCards = new Map();
  for (const album of liveAlbums) for (const card of album.cards) {
    allCards.set(card.id, {
      id: card.id, name: card.name, set: card.set, number: card.number, rarity: card.rarity,
      img_small: card.imgSmall, img_large: card.imgLarge,
    });
  }
  // Completion reward only. Not inserted into gacha_inventory, so a pull or a burn cannot draw one.
  const holoQuantity = 12;
  for (const card of design.holo_rares) {
    if (!allCards.has(card.id)) allCards.set(card.id, card);
  }
  const inventoryRows = [
    ...albums.flatMap((album) => album.cards.map((card) => [
      `common:${album.id}:${card.id}`, card.id, album.id, 'common', 0, 'infinite', 0,
    ])),
    ...design.holo_rares.map((card) => [`holo:${card.id}`, card.id, null, 'holo', holoQuantity, 'finite', 0]),
  ];
  const now = '2026-01-01T00:00:00.000Z';
  const paidOddsId = 'odds:paid:v1';
  const freeOddsId = 'odds:free-common:v1';
  // Commons only (Ben, 27 Sept 2026). A positive weight on reverse/holo/ultra/graded makes prepare
  // demand that tier's vault for every card in a \u00d75/\u00d710. Album P1 is infinite; those tiers are not
  // offered. Completion holos stay finite stock_items and are claimed by tier, not through these odds.
  const oddsTierRows = [
    [paidOddsId, 'common', 1_000_000, 'Album card', 50_000, 0],
    [freeOddsId, 'common', 1_000_000, 'Album card', 50_000, 0],
  ];
  const gachaRows = [
    ['all-cards', null, 'All Cards', 'active', 0, paidOddsId, freeOddsId, 1_000_000, 1_500_000, now, now],
    ...albums.map((album) => [
      `album:${album.id}`, album.id, album.title, 'active', 1, paidOddsId, freeOddsId,
      1_000_000, 1_500_000, now, now,
    ]),
  ];
  // R2 is album-then-card. Each live album is 25 cards at selection_weight 1, so a flat draw over the
  // 75 (or over one album's 25) is the same distribution. Weights are not the tier table.
  const gachaInventoryRows = inventoryRows.flatMap(([inventoryKey, , albumId, tier]) => {
    if (tier !== 'common' || !albumId) return [];
    return [
      ['all-cards', 1, inventoryKey, 1, 1],
      [`album:${albumId}`, 1, inventoryKey, 1, 1],
    ];
  });
  const emptied = mode === 'local'
    ? tables.map((table) => table.name).filter((name) => !STATE_TABLES.includes(name))
    : CATALOG_TABLES;
  const reset = [
    ...deleteOrder(tables, emptied).map((name) => `DELETE FROM ${name};`),
    ...(mode === 'local' ? ['UPDATE gacha_state SET next_pull_sequence = 1 WHERE singleton = 1;'] : []),
  ];

  const sql = [
    `-- Generated by scripts/build-seed.mjs (mode: ${mode}) from data/catalog/gachapon-v0-albums-75.csv. Do not hand-edit.`,
    'PRAGMA foreign_keys = ON;', ...reset,
    mode === 'local' ? rows('users', ['id', 'wallet', 'country', 'free_paid', 'free_common', 'streak', 'created_at'], [[
      'demo-user', '7xKpQm2vR8tW3nHd9fQaLm4sT6uVbN1cXeYz8wKpRq', 'MY', 0, 0, 0, now,
    ]]) : '',
    mode === 'local' ? rows('balances', ['user_id', 'asset', 'amount'], [['demo-user', 'USDC', 50_000_000], ['demo-user', 'USDT', 0]]) : '',
    rows('albums', ['id', 'title', 'subtitle', 'cover_url', 'size', 'status', 'sort_order'], [
      ...albums.map((album, index) => [album.id, album.title, album.subtitle, album.cards[0].imgSmall, album.cards.length, 'live', index]),
      ...soonTitles.map((title, index) => [`soon-${index + 1}`, title, 'Coming soon', '', 25, 'soon', albums.length + index]),
    ]),
    rows('cards', ['id', 'name', 'set_name', 'number', 'printed_rarity', 'image_small', 'image_large'],
      [...allCards.values()].map((card) => [card.id, card.name, card.set.toUpperCase(), card.number, card.rarity, card.img_small ?? card.imgSmall, card.img_large ?? card.imgLarge])),
    rows('album_cards', ['album_id', 'card_id', 'slot'], albums.flatMap((album) => album.cards.map((card, index) => [album.id, card.id, index + 1]))),
    rows('odds_configs', ['id', 'kind', 'version', 'total_weight', 'created_at'], [
      [paidOddsId, 'paid', 1, 1_000_000, now], [freeOddsId, 'free_common', 1, 1_000_000, now],
    ]),
    rows('odds_config_tiers', ['odds_config_id', 'tier', 'weight', 'label', 'value_base', 'sort_order'], oddsTierRows),
    rows('stock_items', ['inventory_key', 'card_id', 'album_id', 'tier', 'available', 'supply', 'serial_counter'], inventoryRows),
    rows('gachas', ['id', 'album_id', 'name', 'status', 'supports_targeted', 'paid_odds_config_id',
      'free_odds_config_id', 'price_base', 'targeted_price_base', 'created_at', 'updated_at'], gachaRows),
    rows('gacha_inventory_versions', ['gacha_id', 'inventory_version', 'created_at'], gachaRows.map(([id]) => [id, 1, now])),
    rows('gacha_inventory', ['gacha_id', 'inventory_version', 'inventory_key', 'selection_weight', 'enabled'], gachaInventoryRows),
  ].filter(Boolean).join('\n\n');

  await mkdir(generatedDir, { recursive: true });
  await writeFile(output, `${sql}\n`);
  console.log(`Wrote ${fileURLToPath(output)} (${mode}: ${allCards.size} cards, ${inventoryRows.length} inventory pools)`);
  return fileURLToPath(output);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) await buildSeed({ mode: process.argv.includes('--catalog') ? 'catalog' : 'local' });
