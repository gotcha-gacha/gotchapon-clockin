-- One line per thing a deploy can depend on, for the pre-deploy check in README.md ("Before every deploy to a D1 that
-- already exists"). Read against a database built from schema.sql and one built from the live sqlite_master, then diffed.
-- Not seen: a CHECK (table or column) and a COLLATE on a column outside every PRIMARY KEY and UNIQUE constraint.
-- Needs SQLite 3.37+ (pragma_table_list); an older sqlite3 fails under -bail, which reads as a difference. scripts/__tests__/
-- schema-shape.test.ts breaks each thing below in a copy of schema.sql, and each part of this query, and requires a change.
-- `_` is a LIKE wildcard, hence ESCAPE: an unescaped 'sqlite_%' would also skip a table called `sqlitex`.
SELECT line FROM (
  -- Every table and view, with the options no other pragma reports.
  SELECT 'table ' || name || ' ' || type || ' without_rowid ' || wr || ' strict ' || strict AS line
  FROM pragma_table_list
  WHERE schema = 'main' AND name NOT LIKE 'sqlite\_%' ESCAPE '\' AND name NOT LIKE '\_cf\_%' ESCAPE '\'
  UNION ALL
  -- Every column, generated ones included (table_xinfo): type, NOT NULL, default, place in the primary key, and hidden
  -- (2 or 3 = generated).
  SELECT 'column ' || m.name || '.' || p.name || ' ' || p.type || CASE WHEN p."notnull" THEN ' NOT NULL' ELSE '' END
    || ' DEFAULT ' || ifnull(p.dflt_value, '-') || ' pk ' || p.pk || ' hidden ' || p.hidden
  FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\' AND m.name NOT LIKE '\_cf\_%' ESCAPE '\'
  UNION ALL
  -- PRIMARY KEY and UNIQUE constraints, by their key columns in order with each one's DESC and collation. SQLite names
  -- their indexes sqlite_autoindex_<table>_<n>, and n follows declaration order, so the name is not compared.
  SELECT 'key ' || m.name || ' ' || CASE il.origin WHEN 'pk' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END || ' ('
    || (SELECT group_concat(name || CASE WHEN "desc" THEN ' DESC' ELSE '' END || ' ' || coll, ',')
        FROM (SELECT name, "desc", coll FROM pragma_index_xinfo(il.name) WHERE key ORDER BY seqno)) || ')'
  FROM sqlite_master m JOIN pragma_index_list(m.name) il
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\' AND m.name NOT LIKE '\_cf\_%' ESCAPE '\'
    AND il.origin IN ('pk', 'u')
  UNION ALL
  -- Foreign keys, one line per constraint (a composite key's columns in order), with both actions.
  SELECT 'references ' || t || ' (' || group_concat(f, ',') || ') -> ' || parent || ' (' || group_concat(r, ',')
    || ') ON DELETE ' || on_delete || ' ON UPDATE ' || on_update
  FROM (
    SELECT m.name AS t, fk.id, fk.seq, fk."from" AS f, fk."table" AS parent, ifnull(fk."to", '-') AS r, fk.on_delete,
      fk.on_update
    FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) fk
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\' AND m.name NOT LIKE '\_cf\_%' ESCAPE '\'
    ORDER BY m.name, fk.id, fk.seq
  )
  GROUP BY t, id
  UNION ALL
  -- Clauses no pragma reports: ON CONFLICT (a REPLACE on the signature key would let one signature overwrite another's
  -- row) and DEFERRABLE. Counted as single words, CONFLICT not ON CONFLICT: SQLite takes any whitespace or a comment
  -- between ON and CONFLICT. A count, not the kind: schema.sql has none, so any one is a difference. Counted in each table's stored SQL, so a comment naming one counts too: schema.sql's comments
  -- never do, and a database built some other way reads as a difference, never as a pass.
  SELECT 'clause ' || name || ' ' || kw || ' x' || ((length(upper(sql)) - length(replace(upper(sql), kw, ''))) / length(kw))
  FROM sqlite_master, (SELECT 'CONFLICT' AS kw UNION ALL SELECT 'DEFERRABLE')
  WHERE type = 'table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\' AND name NOT LIKE '\_cf\_%' ESCAPE '\'
    AND instr(upper(sql), kw) > 0
  UNION ALL
  -- Indexes written as CREATE INDEX, triggers and views: their SQL with runs of whitespace folded to one space.
  SELECT type || ' ' || name || ': ' || replace(replace(replace(replace(replace(replace(
    sql, char(10), ' '), char(9), ' '), '    ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')
  FROM sqlite_master
  WHERE type IN ('index', 'trigger', 'view') AND name NOT LIKE 'sqlite\_%' ESCAPE '\'
)
ORDER BY line;
