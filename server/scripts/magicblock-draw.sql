-- MagicBlock draw columns (#406) on a D1 that predates them. Run ONCE (SQLite has no ADD COLUMN IF NOT EXISTS: a second run
-- fails on the first column and changes nothing). Do not re-apply schema.sql and do not reset the database.
-- Apply before DRAW_SOURCE=magicblock: a MagicBlock pull's insert names draw_source, pool_json and pool_hash. With the switch
-- off the Worker writes none of these columns and reads a missing one as the server proof, so a deploy need not wait for this.
-- schema.sql also carries CHECK (draw_source = 'ecvrf' OR (pool_json IS NOT NULL AND pool_hash IS NOT NULL)); ALTER TABLE
-- cannot add a table CHECK, so on a database migrated this way the Worker's single insert is what keeps them together.

ALTER TABLE pulls ADD COLUMN draw_source TEXT NOT NULL DEFAULT 'ecvrf' CHECK (draw_source IN ('ecvrf', 'magicblock'));
ALTER TABLE pulls ADD COLUMN pool_json TEXT;
ALTER TABLE pulls ADD COLUMN pool_hash TEXT;
ALTER TABLE pulls ADD COLUMN draw_account TEXT;
ALTER TABLE pulls ADD COLUMN draw_request_signature TEXT;
ALTER TABLE pulls ADD COLUMN draw_requested_at TEXT;
ALTER TABLE pulls ADD COLUMN draw_randomness TEXT;
ALTER TABLE pulls ADD COLUMN draw_failed_at TEXT;
ALTER TABLE pulls ADD COLUMN draw_fulfil_signature TEXT;
