# Gachapon API

Cloudflare Worker API backed by one complete D1 schema. The first release keeps
all card stock and player ownership in D1. Solana is used only to verify payment
when a paid pull is committed; cards are not minted or transferred onchain.

## Local development

From the repository root:

```sh
pnpm --dir server db:reset
pnpm --dir server db:seed
pnpm --dir server dev
```

The local profile uses deterministic mock payments and the seeded `demo-user`.
Every non-health application route still passes through authentication; local
development auth is deliberately rejected outside `ENVIRONMENT=local`.

Validation:

```sh
pnpm --dir server verify
pnpm --dir server test:e2e:payments
```

The optional Surfpool payment lane creates an SPL token locally, executes a real
memo-bearing token transfer, and verifies the confirmed transaction through the
same payment verifier used by the Worker.

## Seeding

- `pnpm --dir server db:seed` is a **full reset of the local database**: every table is emptied, children before the tables
  they reference (the order is derived from `schema.sql`), then the catalog and the `demo-user` are written.
- `pnpm --dir server db:seed:mainnet-dev -- --confirm` **replaces the catalog only** (albums, cards, odds, gachas, stock) on
  the remote mainnet-dev database. It never writes or deletes a user, balance, pull, receipt, obligation, deposit or faucet
  grant, and it refuses, having changed nothing, while any ledger row references the catalog (pulls, user inventory,
  outcomes, album completions). Without `--confirm` it only says what it would do.
- A remote database that is **in use** is not reseeded: replacing its catalog would break its ledger. Create a new D1 and
  apply `schema.sql` to it instead.
- `scripts/__tests__/build-seed.test.ts` fails if a table is added to `schema.sql` without being classified as catalog,
  state or ledger in `scripts/build-seed.mjs` (#275).

### Commons-only pulls on a database that is already in use

Paid odds in a fresh seed are 100% common (`odds:paid:v1`, weight 1,000,000 on `common` only). Pull gachas
(`all-cards`, `album:*`) list album commons only. Completion holos stay finite `stock_items` (`tier = 'holo'`)
and are not pull members. `claimCompletion` does not award one: Claim is a Jupiter gift when that path is on, and a soft unavailable when it is not (see **Jupiter gift claims**). The holo rows stay in the vault.

**Do not reseed mainnet-dev** while it has a ledger (`pnpm db:seed:mainnet-dev` refuses, and a catalog wipe
would break pulls). The running Worker already reads odds and membership from D1, so this data change needs
**no Worker deploy** to take effect. Deploy the Worker only when you want the repo and the database to match
after a future empty-database seed. From `server/`:

```sh
# 1. See what active gachas publish and offer today.
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --command \
  "SELECT g.id, t.odds_config_id, t.tier, t.weight FROM gachas g JOIN odds_config_tiers t ON t.odds_config_id = g.paid_odds_config_id WHERE g.status = 'active' AND t.weight > 0 ORDER BY g.id, t.sort_order"
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --command \
  "SELECT gi.gacha_id, i.tier, COUNT(*) AS n FROM gacha_inventory gi JOIN stock_items i ON i.inventory_key = gi.inventory_key JOIN gachas g ON g.id = gi.gacha_id WHERE g.status = 'active' AND gi.enabled = 1 GROUP BY gi.gacha_id, i.tier"

# 2. Publish 100% common paid odds and disable rare pull membership. Does not touch stock_items,
#    so completion holos stay claimable. Safe to run twice. Not for production.
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --file=scripts/commons-only-pulls.sql
```

Free odds are already commons-only in the seed (`odds:free-common:v1`). Confirm the live free config the same
way (`gachas.free_odds_config_id`); the patch file only replaces **paid** odds. After step 2,
`GET /odds?gachaId=all-cards` paid rows are one line, Album card at 100%. A ×10 no longer asks the graded
vault for ten slabs.

### Album C on a database that already has A and B

A mainnet-dev seeded before Wanderers was in the catalog has albums A and B only (25 commons each),
active gachas `all-cards` / `album:A` / `album:B` on `odds:paid:commons`, and no album C. Do not reseed
it. `scripts/add-album-c.sql` inserts the locked 25 (C5 Rolycoly `sv5-93`, C15 Wimpod `sv4-47`), infinite
common stock, gacha `album:C` on `odds:paid:commons`, and those 25 keys on the **current** `all-cards`
version. Completion holos are not in the file. Run `commons-only-pulls.sql` first if `odds:paid:commons`
is missing, and the `stock_items.supply` column (#313) must already exist. Safe to run twice. Not for
production. From `server/`:

```sh
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --file=scripts/add-album-c.sql
```

The five proof queries are comments at the bottom of that file. Expected: Wanderers live with 25 slots,
`album:C` active on `odds:paid:commons`, 25 infinite C commons, album:C enabled inventory 25, all-cards
enabled inventory 75.

## Database model

`schema.sql` is the complete database definition. There are no migrations before
go-live: reset the disposable database and apply the schema from scratch. An additive column can instead be added in place;
each one is run from `server/` (`pnpm exec wrangler d1 execute <db> --env <env> --remote --command "…"`) before the deploy
that reads it:

- `ALTER TABLE pulls ADD COLUMN payment_last_valid_block_height INTEGER` (#273). A row without it is a pull prepared before
  it existed, which the server never expires on chain evidence: it stays retryable instead. Deployed without it, prepare
  fails (no pull can start) and the pinned sweep releases nothing.
- `ALTER TABLE pulls ADD COLUMN payment_checked_at TEXT` (#306). Deployed without it, the pinned-pull sweep reads nothing and
  releases nothing (it logs `pinned-pull sweep could not read its pulls`); requests still succeed.
- `ALTER TABLE faucet_grants ADD COLUMN last_valid_block_height INTEGER` (#304). Deployed without it, a new faucet claim
  fails with a retryable 500 after signing but before anything is stored or sent. A grant from before it is never voided
  by expiry, and meets `BlockhashNotFound` as the hedged hand fix below.
- `ALTER TABLE stock_items ADD COLUMN supply TEXT NOT NULL DEFAULT 'finite' CHECK (supply IN ('finite', 'infinite'))` (#313).
  The default keeps existing vault rows finite. A reseed then marks the 75 album commons `infinite` (`available` stays 0;
  nothing decrements them).
- `CREATE UNIQUE INDEX idx_faucet_grants_one_per_user ON faucet_grants(user_id)` (#276). A backstop: the faucet's own
  conditional insert already allows one grant per account, so a deploy does not wait for it. It fails if an account already
  holds two grants; then leave it off, and never delete `faucet_grants` rows to make room (a grant row is what stops a
  second send).
- `ALTER TABLE deposits ADD COLUMN last_valid_block_height INTEGER` (#266). The height the deposit's blockhash is valid
  through, stored when it is built. A signed deposit whose broadcast proves that signature can never land (expired past
  this height, or failed on chain) is built again under the same idempotency key. Deployed without the column, storing a
  new deposit fails; a signed row from before it is still expired only by the node's blockhash check, and that EXPIRED
  rebuilds it. A database with no `deposits` table uses the note below.

### `deposits` on a database that predates the table (#265)

A D1 created before `deposits` has nothing for that `ALTER` to change. `POST /deposit/build` and `POST /deposit/submit`
500 until the table exists. Do not re-apply `schema.sql` (it fails at the first `CREATE TABLE`) and do not reset the
database. D1 accepts `CREATE TABLE IF NOT EXISTS` for this shape — foreign key, checks, and the unique constraints —
and `CREATE INDEX IF NOT EXISTS` for `idx_deposits_user_status`, so the statements are safe to run twice. An existing
table is left as it is, including one that still lacks `last_valid_block_height` (add that column with the `ALTER`
above). A table created here already includes the column.

From `server/`. The commands name mainnet-dev; another environment uses its own database and `--env`
(`gachapon-production` with `--env production`). Confirm first (no row means the table is missing). Save the SQL
below as a local file — it is not in the repo — and apply it with `--file`, or pass each statement to `--command`.
Then confirm both names.

```sql
CREATE TABLE IF NOT EXISTS deposits (
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

CREATE INDEX IF NOT EXISTS idx_deposits_user_status ON deposits(user_id, status, created_at);
```

```sh
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --command \
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deposits'"
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --file=deposits.sql
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --command \
  "SELECT name FROM sqlite_master WHERE name IN ('deposits', 'idx_deposits_user_status')"
```

The last query returns `deposits` and `idx_deposits_user_status`.

### Paid streak tables (#376)

A database created from the current `schema.sql` already has `season_streaks` and `season_streak_grants`. An existing D1 (mainnet-dev included) does not get them from a reset. Apply `scripts/season-streak.sql` **before** the Worker that reads them. Without `season_streaks`, a paid commit's batch rolls back and the client sees restocking. `CREATE TABLE IF NOT EXISTS` is safe to run twice. Do not re-apply `schema.sql` and do not `db:setup` reset. `users.streak` and `users.last_daily` stay in the table and are unused; do not drop them.

From `server/`. Another environment uses its own database and `--env`.

```sh
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --file=scripts/season-streak.sql
```

Then deploy the Worker, then the web client. `GET /season` from the new Worker includes `streak`; an older client that rejects a missing `streak` must not ship ahead of that Worker.

`#375` adds `GET /me/streak` and `streakBonus` / `streak` on `POST /pulls/commit`. No new columns and no new script: the tables above are the whole streak ledger. A D1 that already has them needs only the Worker deploy.

### Jupiter gift claims (#402)

Album Claim pack is gift-only. The Worker calls Jupiter's public TCG API (`https://tcgapi.jup.ag`) as a house sender and submits one `degen_100` gift to the user's Privy deposit address (`users.wallet`). `album_completions.claimed_at` is written in the same batch that stores `gift_id` and `tx_signature` on `jupiter_gift_claims`. There is no ledger-holo fallback. A confirmed gift replays on the next Claim, including its open link, even if the flag is later turned off. A failure before that batch leaves the album unclaimed.

**Placeholder until ops fills a real keypair.** No private key is in the repo. Every wrangler env ships `JUPITER_GIFT_ENABLED=false`, and `HOUSE_SENDER_ADDRESS` is omitted until it is known. Claim then answers "Your Degen pack is temporarily unavailable. Try again." Tests mock `tcgapi`. They never call Jupiter and they never use a live key.

How Ben turns it on, per environment, after a keypair exists out of band:

1. Apply the table once, before the Worker that reads it. A database created from the current `schema.sql` already has it. An existing D1 does not. From `server/`:

```sh
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --file=scripts/jupiter-gift-claims.sql
```

Production uses `gachapon-production` and `--env production`. `CREATE TABLE IF NOT EXISTS` is safe to run twice. Do not re-apply `schema.sql` and do not reset the database. Without the table, Claim fails closed (temporarily unavailable) and does not award a holo.

If that D1 already had the table before the takeover token (#412), the script is a no-op and leaves the table without
`attempt`: add it once, or every Claim fails on `no such column: attempt` (fail closed; nothing is gifted):

```sh
pnpm exec wrangler d1 execute gachapon-mainnet-dev --env mainnet-dev --remote --command="ALTER TABLE jupiter_gift_claims ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0"
```

2. Fund the house wallet on mainnet. Soft-launch gifts are mainnet: devnet has no `degen_100`. Keep SOL for fees (about 0.05 or more) and USDC for pack face (about $100 per gift; Jupiter debits the sender). Low balance is an ops watch, not a Worker cron.

3. `HOUSE_SENDER_SECRET` is one line, a JSON array of 64 bytes (secret key, then public key), the same shape as `FEE_PAYER_KEYPAIR`. Put it with the two `wrangler secret put HOUSE_SENDER_SECRET` lines in **Authentication and secrets**. Never commit it and never put it in `wrangler.jsonc` `vars`.

4. Set the public address to that same key. It is a var, not a secret. Add `HOUSE_SENDER_ADDRESS` (base58 only) under that env in `wrangler.jsonc` and deploy. The Worker refuses to gift when the secret's public half disagrees with the address.

5. Leave `JUPITER_GIFT_PACK_TYPE=degen_100`, `JUPITER_GIFT_COUNT=1`, `JUPITER_GACHA_OPEN_URL=https://jup.ag/gacha`, and `TCGAPI_BASE_URL=https://tcgapi.jup.ag`. The open URL is allowlisted to `jup.ag` and `www.jup.ag`. Anything else is sent to the client as `https://jup.ag/gacha`.

6. Flip `JUPITER_GIFT_ENABLED` to `"true"` only after one real Claim succeeds against that env. Pause is the same var back to `"false"`: new claims stop, already-confirmed gifts still replay Open on Jupiter. There is no holo fallback while paused.

A submit that landed on Jupiter but missed D1 is reconciled from `GET /v1/gifts` on the next try, matched by the stored gift id or memo. A mash on Claim does not generate a second gift.

- `stock_items` is the canonical stock row for each card/tier. `supply = 'finite'` is a vault count
  (`available` decrements on award and returns on a burn). `supply = 'infinite'` is album P1 for the
  locked 75: `available` stays 0, nothing decrements it, and it is never out of stock.
- `gacha_inventory` gives every gacha explicit, versioned membership. Memberships
  may overlap. A finite row decrements once, on the canonical stock row; an infinite row is not a vault count.
- `user_inventory` contains one row per awarded card for every tier. It records
  the inventory key, serial, acquisition source, status, and timestamp.
- `pull_outcomes` links each immutable pull result to its exact
  `user_inventory` row.
- `payment_receipts` allows one confirmed Solana payment signature to fund only
  one pull.
- `pull_settlements` makes commit/expiry mutually exclusive.

Pull commit inserts the payment receipt, normalized outcome, individual player
inventory row, and — for a finite row — the stock decrement in one D1 batch. The
`stock_never_negative` trigger makes concurrent allocation fail instead of
overselling. Album commons are infinite and skip that decrement. Completion
holos, and later seasonal gold and partner credits, stay finite.

`GET /me/inventory` is the canonical inventory endpoint. `GET /me/holdings`
remains as a compatibility alias and returns the same grouped response, including
individual item IDs and serials.

## Refunds (#268)

A confirmed payment always resolves to pulls or a refund. `src/refunds.ts` is the sweep, run by the Cron Trigger in
`wrangler.jsonc` every 5 minutes (each environment) and by `POST /admin/refunds/run` (admin key) by hand.

**Deciding (always, ledger only).** A paid pull that can no longer become cards is failed into `refund_pending`:

- a MagicBlock draw nobody re-committed, past `DRAW_TIMEOUT_MS` (reason `DRAW_TIMEOUT`);
- any recorded payment (receipt and obligation) still unsettled `REFUND_AFTER_MS` after it was recorded, default 15 minutes
  (reason `UNSETTLED`).

A MagicBlock pull's draw account is read first: a draw that landed after the player's last commit gave up is owed cards, so
its bytes are stored and the pull is settled for the player (counted as `settledForPlayer`); a chain that cannot be read
leaves the pull for the next sweep (`undecided`), never refunded blind. A payment that confirmed on chain after its commit
gave up, and so was never recorded, is not seen here (#144). A pull whose bytes are stored is retried every sweep (a commit is
safe to repeat) and reported only when that fails, so one RPC blip never strands it. At most `OWED_CARDS_PER_SWEEP` (10) of
those are retried a sweep, least recently checked first, so a pile that keeps failing cannot take a sweep past D1's
per-invocation query limit. Every list takes what it looked at least
recently first (`sweep_checks` for deciding, `refund_attempts` for sending), so pulls a sweep can only skip cannot hold every
sweep's places.

The pull is settled `expired` and its free pulls come back in the same batch, so a commit arriving later loses on
`pull_settlements`' key and can never also hand out cards. A pull whose MagicBlock bytes are stored is owed cards, not money: it
is logged every sweep and counted by `/admin/ledger` (`paidPullCannotSettle`), never refunded; it needs a hand fix.

**Sending (only with `REFUNDS_ENABLED=true`).** Each `refund_pending` obligation is paid back from the dedicated refund wallet:

- exactly the receipt's amount, in its mint, to the wallet that signed the payment (the authority of the payment's one
  `TransferChecked` into the treasury, read from the chain), with memo `refund:<pullId>`, creating the recipient's token
  account if needed;
- the faucet's lifecycle (`refunds` table: reserved, prepared, sent): the signed transfer is stored before it is broadcast,
  so a retry rebroadcasts the same bytes and cannot pay twice; a transfer the chain proves can never land is signed again;
  the obligation turns `refunded` only when the transfer confirms;
- `REFUND_BATCH` (5) refunds a sweep and `REFUND_DAILY_CAP_BASE` ($200) a UTC day; a float too low to cover a refund stops
  the sweep and logs `refund wallet float is too low`.

`/admin/ledger` adds `refundsOverdue` (a decided refund unpaid after an hour: the sweep is off, failing, or out of float),
`refundsInconsistent`, `paidPullCannotSettle`, and `magicblockUndecided` (a recorded MagicBlock pull the sweep could not check
on chain for an hour, e.g. draw settings removed while pulls were open).

**Setting it up per environment (Ben):**

1. Apply `scripts/refunds.sql` once to an existing D1, before the Worker (`refunds`, `refund_attempts` and `sweep_checks`;
   `CREATE TABLE IF NOT EXISTS`, safe twice).
2. Create a new keypair for refunds only. Fund it with SOL for fees and a small float of the environment's USDC (it pays
   refunds; Jupiter-gift and fee-payer keys are separate). `REFUND_ADDRESS` is a var; `REFUND_KEYPAIR` is a secret
   (`wrangler secret put REFUND_KEYPAIR --env <env>`, the 64-byte JSON array), never a var.
3. Deploy. The cron then decides refunds and sends none. Watch the logs and `/admin/ledger`, then set
   `REFUNDS_ENABLED` to `"true"` and deploy again. Turning it back off stops sending only; deciding continues.

Proved on devnet (7 Oct 2026) with a test mint: a real 1-token payment marked stuck was refunded by the local Worker's sweep
to the paying wallet (memo `refund:<pullId>`, exactly 1.0), and a second sweep sent nothing.

## MagicBlock draws (#406)

**Off by default.** With `DRAW_SOURCE` unset every pull keeps the server's ECVRF proof (`src/randomness.ts`). With
`DRAW_SOURCE=magicblock`, a new **paid, non-chase** pull whose pool is all unlimited stock draws its cards from MagicBlock VRF
through the draw program in `../onchain/draw` (Anchor). Chase pulls, pulls paid wholly with burned free pulls, and pools holding
finite stock stay on the server proof (Ben, 6 Oct 2026; prepare logs a warning when the switch is on and a pull falls back).
The choice is made at prepare and stored on the pull (`pulls.draw_source`). The frozen pool carries the pull's count and free
split, so the hash the program stores binds which slots are burned free pulls.

How a MagicBlock pull runs:

1. **Prepare** freezes the pool: the offered tiers under the pinned paid and free odds, and every enabled card with its weight,
   as one canonical JSON string (`pool_json`) and its hash (`pool_hash`, sha256 under `gachapon:pool:v1`). It also checks the
   draw settings, so a pull that could never be drawn is refused before anyone pays.
2. **Commit**, once the payment is recorded, sends one `request_draw` for the pull's `sequence` (0.0005 SOL tier, paid by the
   draw authority). The program sets that sequence's bit in a used page and refuses a set bit, so a sequence is requested once,
   ever, even after its draw account is closed. The Worker waits up to `DRAW_WAIT_MS` (10 s) for MagicBlock's 32 bytes, after
   at most 8 s confirming the request, so on a healthy RPC a commit answers inside the app's 30 s request timeout (a slow RPC
   can push it past; the app retries the commit, and nothing is lost).
3. The cards are `deriveSlots(pool, randomness, slots)` (`src/drawDerive.ts`): the frozen pool, never the live tables.
4. Still waiting: `503 TX_NOT_FOUND` ("still being drawn; retry safely"); a later commit picks it up. Past `DRAW_TIMEOUT_MS`
   (60 s) from the first request the pull **expires**: free pulls come back, the obligation goes `refund_pending`
   (`DRAW_TIMEOUT`), and a late answer settles nothing. No fallback to the server key.
5. A draw account requested for a different pull or pool (two databases on one program, a reset database) is never read as this
   pull's; the pull waits out its timeout into a refund. **Each environment needs its own program deployment.**

**The receipt.** A MagicBlock pull's prepare response carries `draw: { source, sequence, poolHash }`, before the user pays,
and the app keeps it (`src/state/drawReceipts.ts`). The program refuses a second request for one *sequence*, but the server
chooses the sequence; it is the receipt that stops the house from requesting one pull under two sequences and publishing the
answer it prefers (round 2 of #410's review, reproduced on devnet: refused with the receipt, passed without one).

`GET /pulls/:id/draw` publishes the pool (with its slots), its hash, the sequence, the request and fulfilment signatures,
the randomness and the settled cards.
`node scripts/verify-draw.ts <draw.json> --receipt <receipts.json> --pull <pullId> [--cluster devnet] [--rpc URL]` recomputes the pull from
those, the receipt and the chain, trusting nothing the server says about where to look:

- the pull is the one the user names with `--pull` (the receipt file holds many pulls, so the server's view must not choose
  which), and its sequence and pool hash come from the receipt;
- the draw program is the one listed in the script for that cluster (**add each environment's program id there when it is
  deployed**);
- the request must name sha256 of the pull's own id;
- the bytes must arrive as an inner `fulfill_draw` on the draw account under MagicBlock's own instruction, once
  (`src/drawFulfil.ts`, the same reading the Worker archives the fulfilment by).

`--no-receipt` runs without one and says the result does not rule out a house that chose between sequences.
`test/drawDerive.test.ts` holds known-answer vectors for implementing the derivation elsewhere.

What the house can still do, none of which the Worker does, and each publicly visible:

- decline to settle a fulfilled draw and refund it instead (the Worker always settles a fulfilled draw; only a draw with no
  bytes fails into a refund): a refund for a pull whose draw account was fulfilled;
- request the draw before broadcasting the user's signed payment, which the server holds, and then not broadcast it when it
  dislikes the card (the Worker requests only after the payment is confirmed and recorded): a fulfilled draw for a pull whose
  payment never landed.

A user's receipts live on their device (`draw-receipts.json`); there is no way to export one from the app yet.

Settings (vars unless noted): `DRAW_SOURCE`, `DRAW_CHAIN` (`solana`; `fake` is local and tests only), `DRAW_PROGRAM_ID`,
`DRAW_RPC_URL` (defaults to `SOLANA_RPC_URL`), `DRAW_AUTHORITY_KEYPAIR` (**secret**, the program's config authority: 64-byte
JSON like `FEE_PAYER_KEYPAIR`), `DRAW_WAIT_MS`, `DRAW_TIMEOUT_MS`, `DRAW_CLUSTER` (`devnet` or `mainnet-beta`: the cluster
`GET /pulls/:id/draw` names, from which the app links the draw's fulfilment on Solana Explorer after the pull; unset, the app
shows no link). Nothing checks it against `DRAW_RPC_URL`: set it to the cluster that RPC serves, or the link opens Explorer's
"not found" page.

Before turning it on anywhere with real money:

- **The refund sweeper (#268) must be sending** (`REFUNDS_ENABLED=true`, a funded refund wallet; see **Refunds (#268)**).
- **The draw RPC must be a provider endpoint.** Solana's public RPCs refuse a request carrying Cloudflare's `CF-Worker` header,
  which every deployed Worker sends (`api.devnet.solana.com` answers 403; measured 5 Oct 2026).
- Apply `scripts/magicblock-draw.sql` once to an existing D1, before `DRAW_SOURCE` is set there. A Worker with the switch
  off writes none of its columns, so deploying this code does not wait for the script (`test/draw.test.ts`, "a D1 that
  predates #406"). Deploy the program per environment, run its
  `initialize` with the draw authority, and fund that authority with SOL (0.0005 SOL a pull, plus about 0.07 SOL per 81,792
  pulls for the used pages and 0.0014 SOL a pull of draw-account rent until a sweeper closes them).

Devnet program used for Phase 1: `GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut` (`../onchain/draw/PHASE0.md`).

## Authentication and secrets

Production and mainnet-dev use Privy bearer tokens. The Worker verifies the
access token, resolves the primary embedded Solana wallet from Privy, and stores
the Privy user ID and wallet binding in D1. Client-provided wallet addresses are
not accepted as identity.

Set secrets with Wrangler rather than committing them. Both deployed environments need the five auth and payment secrets; `vars` are not
inherited between environments, and neither are secrets. `HOUSE_SENDER_SECRET` is the same shape and is put only once a real house keypair exists (see **Jupiter gift claims**). Do not invent a key to satisfy the command.

```sh
wrangler secret put ADMIN_API_KEY --env mainnet-dev
wrangler secret put PRIVY_APP_SECRET --env mainnet-dev
wrangler secret put ECVRF_SECRET_SEED --env mainnet-dev
wrangler secret put SOLANA_RPC_URL --env mainnet-dev
wrangler secret put FEE_PAYER_KEYPAIR --env mainnet-dev
wrangler secret put HOUSE_SENDER_SECRET --env mainnet-dev
wrangler secret put ADMIN_API_KEY --env production
wrangler secret put PRIVY_APP_SECRET --env production
wrangler secret put ECVRF_SECRET_SEED --env production
wrangler secret put SOLANA_RPC_URL --env production
wrangler secret put FEE_PAYER_KEYPAIR --env production
wrangler secret put HOUSE_SENDER_SECRET --env production
```

`PRIVY_APP_ID`, token mint addresses, treasury token-account addresses and the fee payer's public address
(`FEE_PAYER_ADDRESS`, the keypair's public half) are public configuration values in `wrangler.jsonc`; the `REPLACE_WITH_…`
ones in `production` are still to be supplied (#272).

**Every deploy names its environment** (#274). `wrangler.jsonc` has no top-level `vars` and no top-level D1 binding, so a
bare `wrangler deploy` publishes a worker with no `ENVIRONMENT`, and `src/config.ts` makes that worker refuse every request.
The local profile is `--env local` (`pnpm --dir server dev`, `db:seed`, `db:reset` and the tests already pass it). Its
`ECVRF_SECRET_SEED` is published in the repo, so `src/randomness.ts` refuses that seed anywhere but `local`, at prepare as well
as at commit, so no one is asked to pay for a pull that cannot resolve. Each deployed environment sets its own: generate it
fresh (`openssl rand -hex 32`), never by editing the local one, which the check compares exactly and would not catch.
A bare deploy still creates (or overwrites) a public worker named `gachapon-api`; it answers 503 to everything.

**The VRF library** (#277). The draw's proof comes from `@blueshift-gg/solana-ecvrf`, an RFC 9381 ECVRF over edwards25519 built
on `@noble/curves` / `@noble/hashes`, used in `src/randomness.ts`. It is a `0.0.x` release on the money path, so it is pinned to
one exact version in `package.json` and by integrity hash in `pnpm-lock.yaml`; `scripts/__tests__/vrf-pin.test.ts` fails if
either becomes a range or loses its hash. `test/api.test.ts` verifies a committed pull's stored proof with the same library's
`Proof.verify`, which checks internal consistency, not the library against the RFC's test vectors. Why this library was chosen
over another ECVRF implementation is not written down anywhere in the repo; Dev 2 to record it here. An upgrade is its own PR
that says what changed upstream.

**`GET /admin/ledger` checks the payment ledger** (#277; `X-Admin-API-Key`). It counts the rows that break a payment-ledger rule
(`src/health.ts`: a receipt with no obligation, a receipt whose amount or asset is not its pull's, a fulfilled obligation with no
committed pull, a committed pull whose obligation is still pending) and answers 503 with the counts when any is non-zero. Stock
cannot go negative (a CHECK and a trigger refuse it), so it is not counted. The scans read rows in proportion to every paid pull
ever made, so they are not on the public `/health`, which stays one `SELECT 1` and claims no ledger check.

Every application route except `/health` and CORS preflight requires a logged-in
account. Admin inventory membership uses `X-Admin-API-Key` and is independent
from Privy so operational scripts can call it directly.

Cloudflare's edge country is enforced on every authenticated route. The launch
block list matches the app's geo screen and returns HTTP 451 with
`GEO_BLOCKED`. Mainnet-dev sets `GEO_BLOCK` to `off` (Ben, 11 Oct 2026, for the
Solana Mobile CLOCK IN judges): the Worker skips the block and `/me` answers
`country: "XX"`, so the app never closes itself; the stored country is kept.
Unset, or any other value, keeps the block, and only mainnet-dev may set it
(`scripts/__tests__/wrangler-config.test.ts`). `ALLOWED_ORIGINS` is a comma-separated browser allowlist. CORS
does not expose the admin header or admin methods; admin scripts remain direct
HTTP clients authenticated by the API key.

## Payment flow

`POST /pulls/prepare` reserves free pulls, pins gacha/odds/inventory versions,
and returns the exact SPL-token transfer request for paid pulls. The transfer
memo is the immutable pull ID.

`POST /pulls/commit` verifies a confirmed successful transfer with the expected:

- signer wallet;
- token mint and treasury token account;
- base-unit amount;
- pull-ID memo.

Only after verification does the transactional D1 settlement materialize the
cards in `user_inventory`. Mock D1 balances exist only for deterministic local
tests.

The confirmed receipt and a `payment_obligations` row are persisted before card
allocation. A concurrent stock change therefore leaves a visible, retryable
obligation instead of an orphaned treasury payment. Successful allocation marks
the obligation fulfilled in the same D1 batch as the cards. Winning tiers are
never silently substituted with commons.

Prepared pulls expire after their quoted window. An expired pull with no signed
payment is marked expired and its `free_paid` and `free_common` reservations are
restored exactly once on the user's next authenticated request. A signed payment
presented to `/pulls/commit` is pinned before broadcast and remains retryable;
it is never raced by expiry cleanup or refunded as abandoned.

`/prepare` persists the API-built transaction with both required signature slots
empty. Privy signs the user slot. `/commit` requires the stored message bytes
unchanged and verifies that user signature before the API adds its fee-payer
signature and broadcasts. This prevents `/prepare` from leaking sponsored
transactions that can drain the fee payer. Since #353 (30 Sept) the phone signs
too: native Privy signs with the embedded wallet (`src/auth/nativeSolanaSigner.ts`)
after the same pinned-treasury guard as the web.

## Mainnet-dev test token

The repository-root signing files are ignored and remain local. `operator.json`
creates the test payment mint and funds the faucet. `fee-payer.json` is installed
as the mainnet-dev `FEE_PAYER_KEYPAIR` secret: it pays account/transaction fees
and owns the faucet token account. `vault.json` remains unused while prizes are
materialized in D1.

Public setup values live in `config/mainnet-dev.json`. Review mode signs nothing:

```sh
pnpm --dir server setup:test-token
```

The command prints the deterministic mint, treasury ATA, supply delta, account
rent, and approval digest. Repeat with
`--execute --approve-digest <digest>` only after reviewing those exact values.
The mint has no metadata, no freeze authority, and must never be represented as
Circle-issued USDC.

`POST /funding/faucet` is authenticated, mainnet-dev-only, and grants the
configured test-USDC amount once per user. It stores the exact signed transaction
before broadcasting; an ambiguous retry resends the same signature rather than
paying twice. Production has no faucet configuration.

- **Sending (#304).** A retry asks the chain first, by #273's rule (`paymentState`):
  - A transfer that landed, even with its first answer lost, is marked `sent`.
  - A transfer that failed on chain, or whose confirmed block height is past the stored `last_valid_block_height` with still no status from a node that far along, moved nothing. The grant goes back to `reserved` and is signed again, once per claim.
  - `last_valid_block_height` is read just after signing, at `processed`, so it is never below the transfer's own.
- **Which wallet it pays.** A `reserved` grant has nothing signed yet, so it goes to the wallet the claim names, which the route has already checked as the account's. A `prepared` grant is bound to its wallet, and is sent only while Privy still lists that wallet on the account.
- **A grant that may be stuck.** The claim answers 409, and the Wallet says it "may need a hand fix", in four cases:
  - it was reserved under another mint or amount;
  - its prepared wallet has been unlinked;
  - a transfer from before the stored lifetime (its `last_valid_block_height` is null) meets `BlockhashNotFound`, which a lagging node also says about a fresh blockhash;
  - on a database from the old per-wallet key, another of the account's rows already names the wallet.

  To clear a row that is not `sent`:
  1. **A `reserved` row** (the mint or amount case) has nothing signed. Reset it directly with the UPDATE below.
  2. **A `prepared` row:** read its signature's status on two RPC providers:
     `getSignatureStatuses([signature], { searchTransactionHistory: true })`.
     - A status **without** `err` means the transfer landed. Mark it sent, and never sign another:
       `UPDATE faucet_grants SET status = 'sent', sent_at = '<now, ISO 8601>' WHERE id = '<grant id>' AND status = 'prepared';`
     - A status **with** `err` means it moved nothing. The row may be reset.
     - **No status on either provider** is not yet proof, because a provider may not search that far back. Also list the
       recipient's USDC token account with `getSignaturesForAddress(<recipient token account>)` and look for a transaction
       with the memo `faucet:<grant id>`. Reset only if there is none, and only at least five minutes after the 409 (a
       blockhash is valid for about 150 blocks, 60 to 90 seconds).
  3. **The old per-wallet key's conflict** (a database from before #276, with two rows for one account): a reset does not
     clear it, because the claim keeps naming the wallet the other row holds. Keep the account's oldest row, and delete the
     other one that is **not** `sent` and names the claimed wallet:
     `DELETE FROM faucet_grants WHERE id = '<the other grant id>' AND status <> 'sent';`

  To reset:

  ```sql
  UPDATE faucet_grants SET status = 'reserved', signature = NULL, transaction_base64 = NULL, last_valid_block_height = NULL, mint = '<USDC_MINT>', amount = <FAUCET_GRANT_BASE> WHERE id = '<grant id>' AND status <> 'sent';
  ```

## Deployment

Replace the public placeholders and D1 database IDs in `wrangler.jsonc`, create
a new empty database, and apply `schema.sql` once:

```sh
pnpm --dir server db:setup:remote
pnpm --dir server deploy
```

For the isolated mainnet-dev environment, use `db:setup:mainnet-dev`,
`db:seed:mainnet-dev`, and `deploy:mainnet-dev`. Mainnet-dev enables only its
configured test USDC mint; production can enable additional assets separately.

### Before every deploy to a D1 that already exists

There is no migration record, so nothing tells a deploy which of the scripts and `ALTER`s in this file a database still
lacks, and a Worker deployed ahead of its schema can fail on it. On 7 Oct 2026 mainnet-dev was found missing
`pulls.payment_checked_at` (#306; every request logged `pinned-pull sweep could not read its pulls`) and
`idx_faucet_grants_one_per_user` (#276), still giving new accounts `users.free_paid DEFAULT 3` (removed by #321), and still
running the `inventory_consumption_applies` trigger from before #314. Compare the database with the `schema.sql` you are
about to deploy, from `server/` on that commit (production: `env=production db=gachapon-production`):

```sh
env=mainnet-dev db=gachapon-mainnet-dev; out="/tmp/$db-schema.sql"
shape() { sqlite3 -bail :memory: ".read $1" ".read scripts/schema-shape.sql"; }
pnpm exec wrangler d1 execute "$db" --env "$env" --remote --json --command "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE '\_cf\_%' ESCAPE '\' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END" \
  | node -e 'for (const r of JSON.parse(require("fs").readFileSync(0, "utf8"))[0].results) console.log(r.sql + ";")' > "$out" \
  && want=$(shape schema.sql) && have=$(shape "$out") && [ -n "$want" ] && [ -n "$have" ] \
  && { diff <(printf '%s\n' "$want") <(printf '%s\n' "$have") && echo "IN STEP"; } || echo "OUT OF STEP, OR THE CHECK DID NOT RUN"
```

It only reads `sqlite_master`. Do not use `wrangler d1 export` for this: even with `--no-data` it warns that the database is
unavailable to serve queries while it runs (so does `d1 execute --remote --file`, which goes through the same import).

`scripts/schema-shape.sql` is the comparison. It prints one line for each: table and view (with `WITHOUT ROWID` and
`STRICT`); column, generated ones included (type, NOT NULL, default, place in the primary key); `PRIMARY KEY` and `UNIQUE`
constraint (its columns in order, with `DESC` and collation); `REFERENCES` (columns, parent, `ON DELETE`, `ON UPDATE`); any
`ON CONFLICT` or `DEFERRABLE` clause; and `CREATE INDEX`, trigger and view, by its SQL with whitespace folded.
`scripts/__tests__/schema-shape.test.ts` changes each of those in a copy of `schema.sql` and requires a different shape.
**It cannot see a `CHECK`** (table or column; `ALTER TABLE` cannot add one, see `magicblock-draw.sql`) **or a `COLLATE` on a
column outside every `PRIMARY KEY` and `UNIQUE` constraint**, and it needs `sqlite3` 3.37 or later (an older one fails,
which reads as a difference). A comment that names `CONFLICT` or `DEFERRABLE` inside a `CREATE TABLE` counts as the
clause: `schema.sql` has none, and a database built some other way then reads as a difference, never as a pass.

Only a last line of `IN STEP` is a pass. Anything else is not: a failed query, a missing `sqlite3` or a `schema.sql` that
cannot be read ends in the same last line as a real difference, so read what printed above it. In the diff, each `<` line
is what `schema.sql` wants and each `>` line is what the database has; a changed line shows as a `<` and `>` pair, and a
`>`-only line (something the database has that `schema.sql` does not) also stops `IN STEP`. Close each `<` line before the
deploy that needs it: the script or `ALTER` that adds it (**Database model** above, and the feature sections'
`refunds.sql`, `magicblock-draw.sql`, `jupiter-gift-claims.sql`, `season-streak.sql`), then run the check again. Some lines
do not block a given deploy: since #419 a Worker with `DRAW_SOURCE` off does not need `magicblock-draw.sql`, the #276 index
is a backstop (**Database model**), and #426 makes mainnet-dev's `free_paid DEFAULT 3` harmless. A changed default cannot
be fixed by `ALTER` (SQLite rebuilds the table to change one); a trigger is dropped and created again from `schema.sql`.

Measured on mainnet-dev on 7 Oct 2026: against the deployed commit's `schema.sql` (`6f07a3d`) it listed only
the `free_paid` default and the trigger; against `ca6ebcf` it also listed the 16 `refunds`, `refund_attempts` and
`sweep_checks` columns that `refunds.sql` adds. A wrong database name, production's placeholder id, a missing `schema.sql`
and no `sqlite3` on `PATH` each ended in `OUT OF STEP, OR THE CHECK DID NOT RUN`, and a file left by an earlier run was
emptied rather than read. With the full comparison (same day, `d2b2134`'s `schema.sql`), mainnet-dev listed only the
`free_paid` default: its 51 `PRIMARY KEY` / `UNIQUE` constraints and 46 `REFERENCES` all matched.

Seed data is local-only. Production stock/catalog import should be a controlled
admin operation. Admin membership changes use:

- `PUT /admin/gachas/:gachaId/inventory/:inventoryKey`
- `DELETE /admin/gachas/:gachaId/inventory/:inventoryKey`

Each change publishes a new inventory version so already-prepared pulls retain
the exact membership they quoted.
