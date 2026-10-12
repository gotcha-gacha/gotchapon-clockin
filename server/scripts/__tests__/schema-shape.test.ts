// The pre-deploy schema check (README.md, "Before every deploy to a D1 that already exists") passes only when the live
// database's shape equals schema.sql's. Each case here takes schema.sql, breaks one thing a deploy can depend on, and
// requires scripts/schema-shape.sql to print a different shape; an unchanged copy must print the same one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const schema = readFileSync(new URL('schema.sql', root), 'utf8');
const query = readFileSync(new URL('scripts/schema-shape.sql', root), 'utf8');

function shape(sql: string): string[] {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  return (db.prepare(query).all() as { line: string }[]).map((row) => row.line);
}

function broken(find: string, replace: string): string {
  const at = schema.indexOf(find);
  assert.notEqual(at, -1, `schema.sql no longer contains ${JSON.stringify(find)}`);
  assert.equal(schema.indexOf(find, at + 1), -1, `${JSON.stringify(find)} is not unique in schema.sql`);
  return schema.replace(find, replace);
}

const want = shape(schema);

test('schema.sql against itself, and against a copy laid out differently, has one shape', () => {
  assert.ok(want.length > 200, `only ${want.length} lines: the query read almost nothing`);
  assert.deepEqual(shape(schema), want);
  // The stored SQL of a CREATE INDEX or trigger keeps its layout; the check must not read a reflow as a change, including
  // one that splits a line (newlines are folded, not only spaces).
  assert.deepEqual(shape(schema.replaceAll('\n  ', '\n\n    ')), want);
});

const CASES: [string, string, string][] = [
  // [what changes, find in schema.sql, replace with]. Keys and references:
  ['a column-level PRIMARY KEY (one signature, one payment)', 'signature TEXT PRIMARY KEY,\n  pull_id TEXT NOT NULL UNIQUE', 'signature TEXT,\n  pull_id TEXT NOT NULL UNIQUE'],
  // An INTEGER PRIMARY KEY is the rowid: SQLite builds no index for it, so only the column's pk field can show it gone.
  ['an INTEGER PRIMARY KEY', 'singleton INTEGER PRIMARY KEY CHECK (singleton = 1),', 'singleton INTEGER CHECK (singleton = 1),'],
  ['ON CONFLICT REPLACE on a key (a second signature overwrites the first)', 'signature TEXT PRIMARY KEY,\n  pull_id TEXT NOT NULL UNIQUE', 'signature TEXT PRIMARY KEY ON CONFLICT REPLACE,\n  pull_id TEXT NOT NULL UNIQUE'],
  ['ON CONFLICT split across lines', 'signature TEXT PRIMARY KEY,\n  pull_id TEXT NOT NULL UNIQUE', 'signature TEXT PRIMARY KEY ON\n    CONFLICT REPLACE,\n  pull_id TEXT NOT NULL UNIQUE'],
  ['a column-level UNIQUE', 'wallet TEXT NOT NULL UNIQUE,', 'wallet TEXT NOT NULL,'],
  ['a table-level UNIQUE (one source, one award)', '  UNIQUE (source_kind, source_id, outcome_index),\n', ''],
  ['the order of a composite key', '  claimed_at TEXT,\n  PRIMARY KEY (user_id, album_id)\n);', '  claimed_at TEXT,\n  PRIMARY KEY (album_id, user_id)\n);'],
  ['the order of a UNIQUE', '  UNIQUE (source_kind, source_id, outcome_index),', '  UNIQUE (outcome_index, source_kind, source_id),'],
  ['DESC on a key column', '  claimed_at TEXT,\n  PRIMARY KEY (user_id, album_id)\n);', '  claimed_at TEXT,\n  PRIMARY KEY (user_id DESC, album_id)\n);'],
  ['a column REFERENCES', 'pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE RESTRICT,', 'pull_id TEXT NOT NULL UNIQUE,'],
  ['a REFERENCES ON DELETE', 'pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE RESTRICT,', 'pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE CASCADE,'],
  ['a REFERENCES ON UPDATE', 'pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE RESTRICT,', 'pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE RESTRICT ON UPDATE CASCADE,'],
  ['DEFERRABLE on a REFERENCES', 'pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE RESTRICT,', 'pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,'],
  ['the parent table of a REFERENCES', 'album_id TEXT NOT NULL REFERENCES albums(id),\n  completed_at', 'album_id TEXT NOT NULL REFERENCES cards(id),\n  completed_at'],
  ['the parent column of a REFERENCES', 'album_id TEXT NOT NULL REFERENCES albums(id),\n  completed_at', 'album_id TEXT NOT NULL REFERENCES albums(slug),\n  completed_at'],
  ['the pairing of a composite REFERENCES', 'REFERENCES album_completions(user_id, album_id) ON DELETE CASCADE\n);', 'REFERENCES album_completions(album_id, user_id) ON DELETE CASCADE\n);'],
  // payment_obligations has two references: each one's action is its own, not the table's.
  ['the action of the first of two REFERENCES', 'pull_id TEXT PRIMARY KEY REFERENCES pulls(id) ON DELETE RESTRICT,', 'pull_id TEXT PRIMARY KEY REFERENCES pulls(id) ON DELETE CASCADE,'],
  ['the action of the second of two REFERENCES', 'RESTRICT,\n  signature TEXT NOT NULL UNIQUE REFERENCES payment_receipts(signature) ON DELETE RESTRICT,', 'RESTRICT,\n  signature TEXT NOT NULL UNIQUE REFERENCES payment_receipts(signature) ON DELETE CASCADE,'],
  // Columns:
  ['a column type', 'free_paid INTEGER NOT NULL DEFAULT 0', 'free_paid TEXT NOT NULL DEFAULT 0'],
  ['a NOT NULL', 'wallet TEXT NOT NULL UNIQUE,', 'wallet TEXT UNIQUE,'],
  ['a column default', 'free_paid INTEGER NOT NULL DEFAULT 0', 'free_paid INTEGER NOT NULL DEFAULT 3'],
  ['a column', '  free_common INTEGER NOT NULL DEFAULT 0 CHECK (free_common >= 0),\n', ''],
  // Same name, type, NULL and default: only hidden tells a generated column from a stored one.
  ['a column that became generated', '  claimed_at TEXT,\n  PRIMARY KEY (user_id, album_id)\n);', '  claimed_at TEXT GENERATED ALWAYS AS (NULL) VIRTUAL,\n  PRIMARY KEY (user_id, album_id)\n);'],
  ['a generated column', '  free_common INTEGER NOT NULL DEFAULT 0 CHECK (free_common >= 0),\n', '  free_common INTEGER NOT NULL DEFAULT 0 CHECK (free_common >= 0),\n  free_total INTEGER GENERATED ALWAYS AS (free_paid + free_common) VIRTUAL,\n'],
  // Tables and the rest:
  // Key columns already NOT NULL, and the key has its index either way: only the table line's without_rowid shows it.
  ['WITHOUT ROWID', '  claimed_at TEXT,\n  PRIMARY KEY (user_id, album_id)\n);', '  claimed_at TEXT,\n  PRIMARY KEY (user_id, album_id)\n) WITHOUT ROWID;'],
  ['STRICT', '  next_pull_sequence INTEGER NOT NULL CHECK (next_pull_sequence > 0)\n);', '  next_pull_sequence INTEGER NOT NULL CHECK (next_pull_sequence > 0)\n) STRICT;'],
  ['a table name (one table missing, one more)', 'CREATE TABLE completion_rewards (', 'CREATE TABLE completion_rewards_old ('],
  // `_` is a LIKE wildcard: a table whose name only looks like SQLite's or Cloudflare's must still be compared.
  ['a table named like sqlite_%', 'CREATE TABLE gacha_state (', 'CREATE TABLE sqlitex (\n  a TEXT\n);\nCREATE TABLE gacha_state ('],
  ['a table named like _cf_%', 'CREATE TABLE gacha_state (', 'CREATE TABLE xcfxdata (\n  a TEXT\n);\nCREATE TABLE gacha_state ('],
  ['a view', 'CREATE TABLE gacha_state (', 'CREATE VIEW v AS SELECT 1;\nCREATE TABLE gacha_state ('],
  ['a CREATE INDEX', 'CREATE UNIQUE INDEX idx_faucet_grants_one_per_user ON faucet_grants(user_id);', 'CREATE INDEX idx_faucet_grants_one_per_user ON faucet_grants(user_id);'],
  ['a trigger body', ") AND supply = 'finite';", ');'],
];

for (const [what, find, replace] of CASES) {
  test(`a database that differs in ${what} has a different shape`, () => {
    assert.notDeepEqual(shape(broken(find, replace)), want);
  });
}

test('a view whose body changed has a different shape', () => {
  // The table line names a view; only its SQL says what it selects.
  const at = 'CREATE TABLE gacha_state (';
  assert.notDeepEqual(shape(schema.replace(at, `CREATE VIEW v AS SELECT 1;\n${at}`)),
    shape(schema.replace(at, `CREATE VIEW v AS SELECT 2;\n${at}`)));
});
