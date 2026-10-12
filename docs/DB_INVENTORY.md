# D1 prize inventory

For the first release, D1 is the ownership boundary for every prize. Solana is
used only to verify an SPL-token payment before a paid pull settles. Cards are
not minted or transferred onchain.

`stock_items` stores one row per card and tier. `supply = 'finite'` is a vault
count: allocation decrements `available`, and a burn returns one unit. Album P1
for the locked 75 (`data/catalog/gachapon-v0-albums-75.csv`) is
`supply = 'infinite'`: `available` stays 0, nothing decrements it, and those
SKUs are never out of stock. A stock row can appear in multiple versioned
`gacha_inventory` memberships. Overlapping gachas share that one row, so a
finite unit is never duplicated.

Every card award creates one `user_inventory` row, including commons, reverse holos,
holos, ultras, graded cards, and burn rewards. Album Claim pack (#402) does not:
it stores one `jupiter_gift_claims` row and does not insert a completion item.
`pull_outcomes.user_inventory_item_id` links a pull result to that exact item.
Serialized tiers also store their serial on the item row.

Pull settlement is one D1 batch: it claims the pull settlement, records the
verified payment receipt when required, inserts outcomes and player items,
decrements finite stock, and stores the idempotent response. Unique constraints
and the non-negative-stock trigger make concurrent commits safe. An infinite
row is skipped by the decrement (`supply = 'finite'`).

Burns are append-only in `inventory_consumptions`. A trigger atomically marks
the item burned and returns one unit to stock only when that row is finite.
Its primary key prevents two competing requests from consuming or crediting
the same item twice.

The app reads grouped display lines from `GET /me/inventory`; each line includes
the underlying item IDs and any serials. `GET /me/holdings` remains a temporary
compatibility alias.
