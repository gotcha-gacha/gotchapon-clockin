-- Point active gachas at 100% common paid odds, and disable rare pull membership.
-- For an in-use D1 (mainnet-dev). This is not a reseed: it does not DELETE catalog or ledger rows.
--
-- Odds already quoted by a pull stay as stored (schema: immutable once referenced). Active gachas
-- switch to a new paid config. Rare gacha_inventory rows are disabled, including on versions a
-- prepared pull still pins, so those pulls cannot draw reverse/holo/ultra/graded either.
-- Completion holos stay stock_items (tier = holo, supply = finite). This file does not update them.
-- Album-complete claims read that vault directly; they do not go through gacha_inventory.
--
-- Safe to run twice. Do not run against production.

INSERT INTO odds_configs (id, kind, version, total_weight, created_at)
SELECT 'odds:paid:commons', 'paid',
  COALESCE((SELECT MAX(version) FROM odds_configs WHERE kind = 'paid'), 0) + 1,
  1000000,
  '2026-09-27T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM odds_configs WHERE id = 'odds:paid:commons');

INSERT INTO odds_config_tiers (odds_config_id, tier, weight, label, value_base, sort_order)
SELECT 'odds:paid:commons', 'common', 1000000, 'Album card', 50000, 0
WHERE NOT EXISTS (
  SELECT 1 FROM odds_config_tiers WHERE odds_config_id = 'odds:paid:commons' AND tier = 'common'
);

UPDATE odds_configs SET total_weight = 1000000 WHERE id = 'odds:paid:commons';

UPDATE odds_config_tiers SET weight = 1000000
WHERE odds_config_id = 'odds:paid:commons' AND tier = 'common';

UPDATE odds_config_tiers SET weight = 0
WHERE odds_config_id = 'odds:paid:commons' AND tier != 'common';

UPDATE gachas
SET paid_odds_config_id = 'odds:paid:commons', updated_at = '2026-09-27T00:00:00.000Z'
WHERE status = 'active' AND paid_odds_config_id != 'odds:paid:commons';

UPDATE gacha_inventory
SET enabled = 0
WHERE enabled = 1
  AND gacha_id IN (SELECT id FROM gachas WHERE status = 'active')
  AND inventory_key IN (SELECT inventory_key FROM stock_items WHERE tier != 'common');
