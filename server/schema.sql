-- Complete database definition. Applied once when a new D1 database is created.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  privy_wallet_id TEXT UNIQUE,
  privy_session_id TEXT,
  privy_synced_at TEXT,
  wallet TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'XX',
  -- No sign-up grant (#292). New accounts start at 0. free_common is the burn credit (#294).
  free_paid INTEGER NOT NULL DEFAULT 0 CHECK (free_paid >= 0),
  free_common INTEGER NOT NULL DEFAULT 0 CHECK (free_common >= 0),
  -- Retired with the daily capsule (#376). Not read. The paid streak is season_streaks.
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  last_daily TEXT,
  created_at TEXT NOT NULL,
  deletion_requested_at TEXT,
  deleted_at TEXT
);

CREATE TABLE balances (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL CHECK (asset IN ('USDC', 'USDT')),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (user_id, asset)
);

CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  status TEXT NOT NULL CHECK (status IN ('live', 'soon', 'restocking')),
  sort_order INTEGER NOT NULL
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  set_name TEXT NOT NULL,
  number TEXT NOT NULL,
  printed_rarity TEXT NOT NULL,
  image_small TEXT NOT NULL,
  image_large TEXT NOT NULL
);

CREATE TABLE album_cards (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  slot INTEGER NOT NULL CHECK (slot > 0),
  PRIMARY KEY (album_id, card_id),
  UNIQUE (album_id, slot)
);

-- Prize stock. This is not a gacha inventory: a stock item may be eligible for any
-- number of gachas through gacha_inventory below.
-- supply = 'infinite' is album P1 (the locked 75): no vault count, never decremented,
-- never out of stock. supply = 'finite' is everything else (completion holos, and later
-- seasonal gold and partner credits). available is meaningful only for finite rows.
CREATE TABLE stock_items (
  inventory_key TEXT PRIMARY KEY,
  card_id TEXT REFERENCES cards(id),
  album_id TEXT REFERENCES albums(id),
  tier TEXT NOT NULL CHECK (tier IN ('common', 'reverse', 'holo', 'ultra', 'graded')),
  available INTEGER NOT NULL CHECK (available >= 0),
  supply TEXT NOT NULL DEFAULT 'finite' CHECK (supply IN ('finite', 'infinite')),
  serial_counter INTEGER NOT NULL DEFAULT 0 CHECK (serial_counter >= 0)
);

-- Odds are immutable once referenced by a pull. Publishing a change means
-- inserting a new config/version and pointing a gacha at it; prepared pulls
-- retain the version they quoted.
CREATE TABLE odds_configs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('paid', 'free_common')),
  version INTEGER NOT NULL CHECK (version > 0),
  total_weight INTEGER NOT NULL CHECK (total_weight > 0),
  created_at TEXT NOT NULL,
  UNIQUE (kind, version)
);

CREATE TABLE odds_config_tiers (
  odds_config_id TEXT NOT NULL REFERENCES odds_configs(id),
  tier TEXT NOT NULL CHECK (tier IN ('common', 'reverse', 'holo', 'ultra', 'graded')),
  weight INTEGER NOT NULL CHECK (weight >= 0),
  label TEXT NOT NULL,
  value_base INTEGER NOT NULL CHECK (value_base >= 0),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (odds_config_id, tier),
  UNIQUE (odds_config_id, sort_order)
);

-- Every gacha owns an explicit, versioned inventory membership. There is no
-- global/default inventory; clients select a gacha for every pull.
CREATE TABLE gachas (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES albums(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'retired')),
  supports_targeted INTEGER NOT NULL DEFAULT 0 CHECK (supports_targeted IN (0, 1)),
  inventory_version INTEGER NOT NULL DEFAULT 1 CHECK (inventory_version > 0),
  paid_odds_config_id TEXT NOT NULL REFERENCES odds_configs(id),
  free_odds_config_id TEXT NOT NULL REFERENCES odds_configs(id),
  price_base INTEGER NOT NULL CHECK (price_base >= 0),
  targeted_price_base INTEGER NOT NULL CHECK (targeted_price_base >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (supports_targeted = 0 OR album_id IS NOT NULL)
);

-- Publishing a version claims this unique row first. Concurrent admin edits
-- cannot both construct the same next inventory version.
CREATE TABLE gacha_inventory_versions (
  gacha_id TEXT NOT NULL REFERENCES gachas(id) ON DELETE CASCADE,
  inventory_version INTEGER NOT NULL CHECK (inventory_version > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (gacha_id, inventory_version)
);

-- The same stock item may belong to any number of gacha inventories.
-- A finite row is decremented once, on the canonical stock_items row, so overlap never
-- duplicates a vault count and a win through one gacha affects every overlapping gacha.
-- An infinite row is not a vault count: membership still overlaps, and nothing decrements it.
CREATE TABLE gacha_inventory (
  gacha_id TEXT NOT NULL REFERENCES gachas(id) ON DELETE CASCADE,
  inventory_version INTEGER NOT NULL DEFAULT 1 CHECK (inventory_version > 0),
  inventory_key TEXT NOT NULL REFERENCES stock_items(inventory_key) ON DELETE CASCADE,
  selection_weight INTEGER NOT NULL DEFAULT 1 CHECK (selection_weight > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (gacha_id, inventory_version, inventory_key)
);

CREATE TABLE gacha_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  next_pull_sequence INTEGER NOT NULL CHECK (next_pull_sequence > 0)
);

INSERT INTO gacha_state (singleton, next_pull_sequence) VALUES (1, 1);

-- Materialized player inventory. Every awarded card, including commons, owns
-- one row; non-common serials therefore remain first-class instead of being
-- packed into an aggregate JSON column.
CREATE TABLE user_inventory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inventory_key TEXT NOT NULL REFERENCES stock_items(inventory_key),
  card_id TEXT NOT NULL REFERENCES cards(id),
  tier TEXT NOT NULL CHECK (tier IN ('common', 'reverse', 'holo', 'ultra', 'graded')),
  serial TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('pull', 'completion', 'burn')),
  source_id TEXT NOT NULL,
  outcome_index INTEGER NOT NULL CHECK (outcome_index >= 0),
  status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned', 'burned')),
  acquired_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE (source_kind, source_id, outcome_index),
  UNIQUE (inventory_key, serial),
  CHECK ((status = 'owned' AND consumed_at IS NULL) OR (status = 'burned' AND consumed_at IS NOT NULL))
);

-- Consuming an item is an append-only operation. The primary key prevents two
-- concurrent burns from returning the same card to stock twice.
CREATE TABLE inventory_consumptions (
  inventory_item_id TEXT PRIMARY KEY REFERENCES user_inventory(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);

CREATE TABLE pulls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idem TEXT NOT NULL,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
  gacha_id TEXT NOT NULL REFERENCES gachas(id),
  inventory_version INTEGER NOT NULL CHECK (inventory_version > 0),
  album_id TEXT REFERENCES albums(id),
  odds_config_id TEXT NOT NULL REFERENCES odds_configs(id),
  free_odds_config_id TEXT NOT NULL REFERENCES odds_configs(id),
  client_seed TEXT NOT NULL,
  seed_source TEXT NOT NULL CHECK (seed_source IN ('client', 'server')),
  count INTEGER NOT NULL CHECK (count IN (1, 5, 10)),
  targeted INTEGER NOT NULL CHECK (targeted IN (0, 1)),
  asset TEXT NOT NULL CHECK (asset IN ('USDC', 'USDT')),
  cost_base INTEGER NOT NULL CHECK (cost_base >= 0),
  reserved_paid INTEGER NOT NULL DEFAULT 0 CHECK (reserved_paid >= 0),
  reserved_common INTEGER NOT NULL DEFAULT 0 CHECK (reserved_common >= 0),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'committed', 'expired')),
  expires_at TEXT NOT NULL,
  payment_transaction_base64 TEXT,
  -- The payment blockhash's last valid block height, from the getLatestBlockhash that built it (#273). The transaction can
  -- still land in the block at this height + 1 (agave accepts a blockhash while it is at most 150 hashes old, counted from
  -- the parent's): a confirmed height past it proves only that no LATER block can hold it, and the expiry then rests on a
  -- status read from a node at least that far along (src/payments.ts paymentState). NULL (a free pull, or a row from
  -- before this column) never expires on chain evidence.
  payment_last_valid_block_height INTEGER,
  -- When the pinned-pull sweep last asked the chain about this pull (#306). The sweep takes the least recently checked
  -- first, so pulls it can never settle (a confirmed payment nobody committed, #268) cannot hold its window for good.
  payment_checked_at TEXT,
  tx_signature TEXT,
  vrf_public_key TEXT,
  vrf_input TEXT,
  vrf_proof TEXT,
  vrf_output TEXT,
  -- Where the cards come from (#406): the server's ECVRF proof above, or MagicBlock VRF through the draw program. Decided at
  -- prepare. A MagicBlock pull freezes its pool there (pool_json, the exact canonical string; pool_hash = sha256 of it, as
  -- the program stores it), and commit draws only from that string, never the live tables.
  draw_source TEXT NOT NULL DEFAULT 'ecvrf' CHECK (draw_source IN ('ecvrf', 'magicblock')),
  pool_json TEXT,
  pool_hash TEXT,
  -- The program's per-pull draw account, the request transaction, when the request was first sent (the timeout counts
  -- from here), the 32 bytes MagicBlock delivered (hex), and when the pull failed for want of them.
  draw_account TEXT,
  draw_request_signature TEXT,
  draw_requested_at TEXT,
  draw_randomness TEXT,
  draw_failed_at TEXT,
  -- The oracle's fulfilment transaction, archived with the bytes (public RPCs prune history).
  draw_fulfil_signature TEXT,
  resolved_at TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  CHECK (targeted = 0 OR album_id IS NOT NULL),
  CHECK (draw_source = 'ecvrf' OR (pool_json IS NOT NULL AND pool_hash IS NOT NULL)),
  UNIQUE (user_id, idem),
  UNIQUE (tx_signature)
);

-- Immutable normalized results. This is the operational ledger used for
-- reconciliation; response_json is only an idempotent API snapshot.
CREATE TABLE pull_outcomes (
  pull_id TEXT NOT NULL REFERENCES pulls(id) ON DELETE CASCADE,
  outcome_index INTEGER NOT NULL CHECK (outcome_index >= 0),
  inventory_key TEXT NOT NULL REFERENCES stock_items(inventory_key),
  user_inventory_item_id TEXT NOT NULL UNIQUE REFERENCES user_inventory(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  tier TEXT NOT NULL CHECK (tier IN ('common', 'reverse', 'holo', 'ultra', 'graded')),
  serial TEXT,
  is_dupe INTEGER NOT NULL CHECK (is_dupe IN (0, 1)),
  randomness_tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pull_id, outcome_index)
);

-- A pull may settle exactly once. Inserting this row as the first statement in
-- the allocation batch turns concurrent commit/expiry requests into a unique
-- constraint failure and rolls the losing batch back.
CREATE TABLE pull_settlements (
  pull_id TEXT PRIMARY KEY REFERENCES pulls(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('committed', 'expired')),
  created_at TEXT NOT NULL
);

-- A confirmed Solana payment can fund exactly one pull. This dedicated receipt
-- ledger makes that invariant explicit and lets settlement reconcile payments
-- independently from the API response snapshot.
CREATE TABLE payment_receipts (
  signature TEXT PRIMARY KEY,
  pull_id TEXT NOT NULL UNIQUE REFERENCES pulls(id) ON DELETE RESTRICT,
  asset TEXT NOT NULL CHECK (asset IN ('USDC', 'USDT')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  destination TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot >= 0),
  finalized_at TEXT NOT NULL
);

-- A confirmed payment is an obligation even when prize allocation cannot finish
-- immediately. The receipt and this row are inserted together before allocation;
-- retries fulfill the same pull, while operations can reconcile every pending
-- obligation instead of discovering an orphaned treasury payment from chain data.
CREATE TABLE payment_obligations (
  pull_id TEXT PRIMARY KEY REFERENCES pulls(id) ON DELETE RESTRICT,
  signature TEXT NOT NULL UNIQUE REFERENCES payment_receipts(signature) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'refund_pending', 'refunded')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Mainnet-dev faucet grants: one per authenticated account, to the wallet it first asks for (#276; enforced by claimFaucet's
-- conditional insert, and by the unique index below on a database created from this file). The exact signed
-- transaction is persisted before broadcast, so retries resend one signature.
-- A refund owed on a confirmed payment that will never become cards (#268): one per pull, sent from the dedicated refund
-- wallet to the wallet that signed the payment, for exactly the receipt's amount. The faucet's lifecycle (#304): reserved,
-- then prepared (the signed transfer stored BEFORE it is broadcast, so a retry rebroadcasts the same bytes and can never pay
-- twice), then sent once the chain confirms it; the obligation turns `refunded` in that same batch. A prepared transfer the
-- chain proves can never land (failed, or expired with no status) goes back to reserved and is signed again.
CREATE TABLE refunds (
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
CREATE TABLE refund_attempts (
  pull_id TEXT PRIMARY KEY REFERENCES payment_obligations(pull_id) ON DELETE RESTRICT,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  attempted_at TEXT NOT NULL
);

-- When the refund sweep last looked at each pull it is deciding, so pulls it can only skip (a draw chain it cannot read, a
-- settle that keeps failing) go to the back instead of holding every sweep's places (#420's review, round 2).
CREATE TABLE sweep_checks (
  pull_id TEXT PRIMARY KEY REFERENCES pulls(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL
);

CREATE TABLE faucet_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'prepared', 'sent')),
  signature TEXT UNIQUE,
  transaction_base64 TEXT,
  -- An upper bound on the block height the signed transfer's blockhash is valid through, read just after signing (#304).
  -- Past it with no status, the transfer can never land, so the grant is signed again rather than stuck. Null on rows from
  -- before the column, and on reserved rows.
  last_valid_block_height INTEGER,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (user_id, wallet),
  CHECK ((status = 'reserved' AND signature IS NULL AND transaction_base64 IS NULL AND sent_at IS NULL)
    OR (status = 'prepared' AND signature IS NOT NULL AND transaction_base64 IS NOT NULL AND sent_at IS NULL)
    OR (status = 'sent' AND signature IS NOT NULL AND transaction_base64 IS NOT NULL AND sent_at IS NOT NULL))
);

-- Connected-wallet deposits are built and broadcast by the API, but paid and
-- authorized only by the connected source wallet. Persisting the exact bytes
-- makes retries reuse one signature even if the first RPC response is lost.
-- When that signature is proven dead, those bytes are dropped and the same
-- idempotency key is built again (#266).
CREATE TABLE deposits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idem TEXT NOT NULL,
  source_wallet TEXT NOT NULL,
  destination_wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'signed', 'committed')),
  expires_at TEXT NOT NULL,
  transaction_base64 TEXT NOT NULL,
  signed_transaction_base64 TEXT,
  tx_signature TEXT UNIQUE,
  -- The last block height the built blockhash is valid through (#266). Past it with no status, the signature can
  -- never land, so the same idempotency key is built again. Null on rows from before the column.
  last_valid_block_height INTEGER,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  UNIQUE (user_id, idem),
  CHECK ((status = 'prepared' AND signed_transaction_base64 IS NULL AND tx_signature IS NULL AND committed_at IS NULL)
    OR (status = 'signed' AND signed_transaction_base64 IS NOT NULL AND tx_signature IS NOT NULL AND committed_at IS NULL)
    OR (status = 'committed' AND signed_transaction_base64 IS NOT NULL AND tx_signature IS NOT NULL AND committed_at IS NOT NULL))
);

CREATE TABLE idempotency (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idem TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, operation, idem)
);

CREATE TABLE album_completions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES albums(id),
  completed_at TEXT NOT NULL,
  claimed_at TEXT,
  PRIMARY KEY (user_id, album_id)
);

-- A completed album awards at most one card, even when two distinct
-- idempotency keys race.
CREATE TABLE completion_rewards (
  user_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, album_id),
  FOREIGN KEY (user_id, album_id) REFERENCES album_completions(user_id, album_id) ON DELETE CASCADE
);

-- One Jupiter gift per completed album (#402). album_completions.claimed_at is set in the same
-- batch that stores gift_id and tx_signature. A row that is not confirmed has not succeeded:
-- Claim can be tried again, and no second gift is generated while this row holds a memo or
-- unsigned transaction. The house private key is never stored here.
CREATE TABLE jupiter_gift_claims (
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

-- Season One raffle tickets (6a). A count per binder, plus one grant per committed
-- pull so a replay cannot add the same tickets twice. Slabs are not stock.
CREATE TABLE season_ticket_balances (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  tickets INTEGER NOT NULL CHECK (tickets >= 0),
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE season_ticket_grants (
  pull_id TEXT PRIMARY KEY REFERENCES pulls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  tickets INTEGER NOT NULL CHECK (tickets > 0),
  created_at TEXT NOT NULL
);

-- Paid streak (#376). One row per binder per season. count is 0–4: the day a paid pull
-- reaches 5 grants +2 raffle tickets and stores 0. last_day is the Malaysia (UTC+8) calendar
-- day that last counted. A day that is neither today nor yesterday reads as 0.
CREATE TABLE season_streaks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0 AND count < 5),
  last_day TEXT NOT NULL,
  PRIMARY KEY (user_id, season_id)
);

-- One streak bonus per binder per calendar day. The id is streak:<season>:<user>:<day>, so a
-- hit-5 on that day cannot insert twice. The +2 is also added to season_ticket_balances.
CREATE TABLE season_streak_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tickets INTEGER NOT NULL CHECK (tickets = 2),
  pull_id TEXT NOT NULL REFERENCES pulls(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, season_id, day)
);

CREATE INDEX idx_stock_items_tier_available ON stock_items(tier, available);
CREATE INDEX idx_stock_items_album_available ON stock_items(album_id, available);
CREATE INDEX idx_gacha_inventory_key ON gacha_inventory(inventory_key, enabled);
CREATE INDEX idx_gacha_inventory_version ON gacha_inventory(gacha_id, inventory_version, enabled);
CREATE INDEX idx_gachas_status ON gachas(status);
CREATE INDEX idx_user_inventory_owner ON user_inventory(user_id, status, tier, card_id);
CREATE INDEX idx_user_inventory_source ON user_inventory(source_kind, source_id, outcome_index);
CREATE INDEX idx_inventory_consumptions_operation ON inventory_consumptions(operation_id);
CREATE INDEX idx_pulls_user_status ON pulls(user_id, status);
CREATE INDEX idx_payment_receipts_pull ON payment_receipts(pull_id);
CREATE INDEX idx_payment_obligations_status ON payment_obligations(status, created_at);
CREATE INDEX idx_faucet_grants_signature ON faucet_grants(signature);
CREATE UNIQUE INDEX idx_faucet_grants_one_per_user ON faucet_grants(user_id);
CREATE INDEX idx_deposits_user_status ON deposits(user_id, status, created_at);
CREATE INDEX idx_pull_outcomes_card ON pull_outcomes(card_id, tier);

-- A stale candidate can never make stock negative. D1 batch() rolls the full batch
-- back when this trigger aborts, preserving allocation/holding atomicity.
CREATE TRIGGER stock_never_negative
BEFORE UPDATE OF available ON stock_items
WHEN NEW.available < 0
BEGIN
  SELECT RAISE(ABORT, 'inventory depleted');
END;

CREATE TRIGGER inventory_consumption_requires_owned
BEFORE INSERT ON inventory_consumptions
WHEN NOT EXISTS (
  SELECT 1 FROM user_inventory
  WHERE id = NEW.inventory_item_id AND status = 'owned'
)
BEGIN
  SELECT RAISE(ABORT, 'inventory item already consumed');
END;

CREATE TRIGGER inventory_consumption_applies
AFTER INSERT ON inventory_consumptions
BEGIN
  UPDATE stock_items
  SET available = available + 1
  WHERE inventory_key = (
    SELECT inventory_key FROM user_inventory WHERE id = NEW.inventory_item_id
  ) AND supply = 'finite';

  UPDATE user_inventory
  SET status = 'burned', consumed_at = NEW.consumed_at
  WHERE id = NEW.inventory_item_id;
END;
