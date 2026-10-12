-- The refunds table (#268) on a D1 that predates it. Safe to run twice. Do not re-apply schema.sql and do not reset the
-- database. Apply before deploying the Worker whose sweep writes it.
CREATE TABLE IF NOT EXISTS refunds (
  pull_id TEXT PRIMARY KEY REFERENCES payment_obligations(pull_id) ON DELETE RESTRICT,
  payment_signature TEXT NOT NULL UNIQUE REFERENCES payment_receipts(signature) ON DELETE RESTRICT,
  wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'prepared', 'sent')),
  signature TEXT UNIQUE,
  transaction_base64 TEXT,
  last_valid_block_height INTEGER,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  CHECK ((status = 'reserved' AND signature IS NULL AND transaction_base64 IS NULL AND sent_at IS NULL)
    OR (status = 'prepared' AND signature IS NOT NULL AND transaction_base64 IS NOT NULL AND sent_at IS NULL)
    OR (status = 'sent' AND signature IS NOT NULL AND transaction_base64 IS NOT NULL AND sent_at IS NOT NULL))
);

-- When the sweep last tried each refund, so refunds that keep failing (an unreadable payment, a mint no longer configured)
-- go to the back of the queue instead of holding every sweep's places (#420's review).
CREATE TABLE IF NOT EXISTS refund_attempts (
  pull_id TEXT PRIMARY KEY REFERENCES payment_obligations(pull_id) ON DELETE RESTRICT,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  attempted_at TEXT NOT NULL
);

-- When the refund sweep last looked at each pull it is deciding, so pulls it can only skip (a draw chain it cannot read, a
-- settle that keeps failing) go to the back instead of holding every sweep's places (#420's review, round 2).
CREATE TABLE IF NOT EXISTS sweep_checks (
  pull_id TEXT PRIMARY KEY REFERENCES pulls(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL
);
