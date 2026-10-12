-- Jupiter gift claims (#402) on a D1 that already has album_completions.
-- Safe to run twice. Do not re-apply schema.sql and do not reset the database.
-- Apply before the Worker that reads this table. Without it, Claim fails closed
-- (temporarily unavailable) and does not award a completion holo.
-- A D1 that already has this table without `attempt` (applied before the takeover fix) needs, once:
--   ALTER TABLE jupiter_gift_claims ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
-- Without it every Claim fails on `no such column: attempt` and gifts nothing.

CREATE TABLE IF NOT EXISTS jupiter_gift_claims (
  user_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  receiver TEXT NOT NULL,
  sender TEXT,
  pack_type TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count = 1),
  gift_id TEXT,
  memo TEXT,
  unsigned_tx TEXT,
  tx_signature TEXT,
  total_cost TEXT,
  open_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  -- Takeover token (claimGift): every takeover of a pending or failed row bumps it, and compares the value it read.
  attempt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, album_id),
  FOREIGN KEY (user_id, album_id) REFERENCES album_completions(user_id, album_id) ON DELETE CASCADE,
  CHECK ((status = 'confirmed' AND gift_id IS NOT NULL AND tx_signature IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status != 'confirmed' AND tx_signature IS NULL AND confirmed_at IS NULL))
);
