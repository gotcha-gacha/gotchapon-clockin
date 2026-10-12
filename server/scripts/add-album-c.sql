-- Add album C (Wanderers) to an in-use D1 that already has A and B.
-- For mainnet-dev. This is not a reseed: it does not delete catalog or ledger rows,
-- and it does not update completion holos (tier = holo). Album-complete claims read
-- that vault directly.
--
-- Prerequisite: scripts/commons-only-pulls.sql, so odds:paid:commons exists.
-- album:C points at that config. stock_items.supply must exist (the #313 column).
--
-- The 25 slots are the locked v0 catalog (data/catalog/gachapon-v0-albums-75.csv).
-- C5 is Rolycoly sv5-93. C15 is Wimpod sv4-47. A keeps Girafarig. B keeps Foongus.
-- Card rows the design seed already stored are left as stored (INSERT OR IGNORE).
-- Rolycoly and Wimpod are not in that older card list, so those two are new rows.
--
-- Coming-soon covers seeded when only A and B were live occupy sort_order 2.
-- They move one step later, once, so Wanderers sorts with the live albums.
-- Safe to run twice. Do not run against production.
--
-- Afterward, the five proofs at the bottom of this file.

UPDATE albums
SET sort_order = sort_order + 1
WHERE status = 'soon'
  AND sort_order >= 2
  AND NOT EXISTS (SELECT 1 FROM albums WHERE id = 'C')
  AND EXISTS (SELECT 1 FROM albums WHERE status = 'soon' AND sort_order = 2);

INSERT INTO albums (id, title, subtitle, cover_url, size, status, sort_order)
SELECT 'C', 'Wanderers', '25 from every path',
  'https://images.pokemontcg.io/sv7/88.png', 25, 'live', 2
WHERE NOT EXISTS (SELECT 1 FROM albums WHERE id = 'C');

INSERT OR IGNORE INTO cards (id, name, set_name, number, printed_rarity, image_small, image_large) VALUES
  ('sv7-88', 'Falinks', 'SV7', '88', 'Common', 'https://images.pokemontcg.io/sv7/88.png', 'https://images.pokemontcg.io/sv7/88_hires.png'),
  ('sv2-114', 'Croagunk', 'SV2', '114', 'Common', 'https://images.pokemontcg.io/sv2/114.png', 'https://images.pokemontcg.io/sv2/114_hires.png'),
  ('sv5-136', 'Minccino', 'SV5', '136', 'Common', 'https://images.pokemontcg.io/sv5/136.png', 'https://images.pokemontcg.io/sv5/136_hires.png'),
  ('sv10-132', 'Marnie''s Scraggy', 'SV10', '132', 'Common', 'https://images.pokemontcg.io/sv10/132.png', 'https://images.pokemontcg.io/sv10/132_hires.png'),
  ('sv5-93', 'Rolycoly', 'SV5', '93', 'Common', 'https://images.pokemontcg.io/sv5/93.png', 'https://images.pokemontcg.io/sv5/93_hires.png'),
  ('sv10-97', 'Nosepass', 'SV10', '97', 'Common', 'https://images.pokemontcg.io/sv10/97.png', 'https://images.pokemontcg.io/sv10/97_hires.png'),
  ('sv5-14', 'Cottonee', 'SV5', '14', 'Common', 'https://images.pokemontcg.io/sv5/14.png', 'https://images.pokemontcg.io/sv5/14_hires.png'),
  ('sv5-127', 'Noctowl', 'SV5', '127', 'Common', 'https://images.pokemontcg.io/sv5/127.png', 'https://images.pokemontcg.io/sv5/127_hires.png'),
  ('sv4-10', 'Blipbug', 'SV4', '10', 'Common', 'https://images.pokemontcg.io/sv4/10.png', 'https://images.pokemontcg.io/sv4/10_hires.png'),
  ('sv1-151', 'Skwovet', 'SV1', '151', 'Common', 'https://images.pokemontcg.io/sv1/151.png', 'https://images.pokemontcg.io/sv1/151_hires.png'),
  ('sv9-14', 'Durant', 'SV9', '14', 'Common', 'https://images.pokemontcg.io/sv9/14.png', 'https://images.pokemontcg.io/sv9/14_hires.png'),
  ('sv3-26', 'Charmander', 'SV3', '26', 'Common', 'https://images.pokemontcg.io/sv3/26.png', 'https://images.pokemontcg.io/sv3/26_hires.png'),
  ('sv5-94', 'Carkol', 'SV5', '94', 'Common', 'https://images.pokemontcg.io/sv5/94.png', 'https://images.pokemontcg.io/sv5/94_hires.png'),
  ('sv2-133', 'Sneasel', 'SV2', '133', 'Common', 'https://images.pokemontcg.io/sv2/133.png', 'https://images.pokemontcg.io/sv2/133_hires.png'),
  ('sv4-47', 'Wimpod', 'SV4', '47', 'Common', 'https://images.pokemontcg.io/sv4/47.png', 'https://images.pokemontcg.io/sv4/47_hires.png'),
  ('sv3-171', 'Herdier', 'SV3', '171', 'Common', 'https://images.pokemontcg.io/sv3/171.png', 'https://images.pokemontcg.io/sv3/171_hires.png'),
  ('sv10-99', 'Meditite', 'SV10', '99', 'Common', 'https://images.pokemontcg.io/sv10/99.png', 'https://images.pokemontcg.io/sv10/99_hires.png'),
  ('sv2-1', 'Hoppip', 'SV2', '1', 'Common', 'https://images.pokemontcg.io/sv2/1.png', 'https://images.pokemontcg.io/sv2/1_hires.png'),
  ('sv9-104', 'N''s Klang', 'SV9', '104', 'Common', 'https://images.pokemontcg.io/sv9/104.png', 'https://images.pokemontcg.io/sv9/104_hires.png'),
  ('sv8-122', 'Alolan Diglett', 'SV8', '122', 'Common', 'https://images.pokemontcg.io/sv8/122.png', 'https://images.pokemontcg.io/sv8/122_hires.png'),
  ('sv8-156', 'Oranguru', 'SV8', '156', 'Common', 'https://images.pokemontcg.io/sv8/156.png', 'https://images.pokemontcg.io/sv8/156_hires.png'),
  ('sv4-115', 'Liepard', 'SV4', '115', 'Common', 'https://images.pokemontcg.io/sv4/115.png', 'https://images.pokemontcg.io/sv4/115_hires.png'),
  ('sv10-143', 'Steven''s Beldum', 'SV10', '143', 'Common', 'https://images.pokemontcg.io/sv10/143.png', 'https://images.pokemontcg.io/sv10/143_hires.png'),
  ('sv3-55', 'Cryogonal', 'SV3', '55', 'Common', 'https://images.pokemontcg.io/sv3/55.png', 'https://images.pokemontcg.io/sv3/55_hires.png'),
  ('sv6-37', 'Lampent', 'SV6', '37', 'Common', 'https://images.pokemontcg.io/sv6/37.png', 'https://images.pokemontcg.io/sv6/37_hires.png');

INSERT OR IGNORE INTO album_cards (album_id, card_id, slot) VALUES
  ('C', 'sv7-88', 1),
  ('C', 'sv2-114', 2),
  ('C', 'sv5-136', 3),
  ('C', 'sv10-132', 4),
  ('C', 'sv5-93', 5),
  ('C', 'sv10-97', 6),
  ('C', 'sv5-14', 7),
  ('C', 'sv5-127', 8),
  ('C', 'sv4-10', 9),
  ('C', 'sv1-151', 10),
  ('C', 'sv9-14', 11),
  ('C', 'sv3-26', 12),
  ('C', 'sv5-94', 13),
  ('C', 'sv2-133', 14),
  ('C', 'sv4-47', 15),
  ('C', 'sv3-171', 16),
  ('C', 'sv10-99', 17),
  ('C', 'sv2-1', 18),
  ('C', 'sv9-104', 19),
  ('C', 'sv8-122', 20),
  ('C', 'sv8-156', 21),
  ('C', 'sv4-115', 22),
  ('C', 'sv10-143', 23),
  ('C', 'sv3-55', 24),
  ('C', 'sv6-37', 25);

INSERT OR IGNORE INTO stock_items (
  inventory_key, card_id, album_id, tier, available, supply, serial_counter
) VALUES
  ('common:C:sv7-88', 'sv7-88', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv2-114', 'sv2-114', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv5-136', 'sv5-136', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv10-132', 'sv10-132', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv5-93', 'sv5-93', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv10-97', 'sv10-97', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv5-14', 'sv5-14', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv5-127', 'sv5-127', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv4-10', 'sv4-10', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv1-151', 'sv1-151', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv9-14', 'sv9-14', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv3-26', 'sv3-26', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv5-94', 'sv5-94', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv2-133', 'sv2-133', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv4-47', 'sv4-47', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv3-171', 'sv3-171', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv10-99', 'sv10-99', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv2-1', 'sv2-1', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv9-104', 'sv9-104', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv8-122', 'sv8-122', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv8-156', 'sv8-156', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv4-115', 'sv4-115', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv10-143', 'sv10-143', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv3-55', 'sv3-55', 'C', 'common', 0, 'infinite', 0),
  ('common:C:sv6-37', 'sv6-37', 'C', 'common', 0, 'infinite', 0);

-- Paid odds are the commons-only config. Free odds and prices match album A,
-- which is already live on this database.
INSERT INTO gachas (
  id, album_id, name, status, supports_targeted, inventory_version,
  paid_odds_config_id, free_odds_config_id, price_base, targeted_price_base,
  created_at, updated_at
)
SELECT
  'album:C', 'C', 'Wanderers', 'active', 1, 1,
  'odds:paid:commons', a.free_odds_config_id, a.price_base, a.targeted_price_base,
  '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'
FROM gachas a
WHERE a.id = 'album:A'
  AND NOT EXISTS (SELECT 1 FROM gachas WHERE id = 'album:C');

INSERT OR IGNORE INTO gacha_inventory_versions (gacha_id, inventory_version, created_at)
SELECT 'album:C', inventory_version, '2026-09-28T00:00:00.000Z'
FROM gachas WHERE id = 'album:C';

INSERT OR IGNORE INTO gacha_inventory (gacha_id, inventory_version, inventory_key, selection_weight, enabled)
SELECT g.id, g.inventory_version, s.inventory_key, 1, 1
FROM gachas g
JOIN stock_items s ON s.album_id = 'C' AND s.tier = 'common' AND s.supply = 'infinite'
WHERE g.id = 'album:C';

-- Current all-cards version only. A prepared pull pins the version it quoted;
-- older versions stay as they were. Enabled count on the current version goes
-- from the live 50 (A+B) to 75.
INSERT OR IGNORE INTO gacha_inventory (gacha_id, inventory_version, inventory_key, selection_weight, enabled)
SELECT g.id, g.inventory_version, s.inventory_key, 1, 1
FROM gachas g
JOIN stock_items s ON s.album_id = 'C' AND s.tier = 'common' AND s.supply = 'infinite'
WHERE g.id = 'all-cards';

-- Proofs to run after. Expected: one live Wanderers row (25 slots, C5 Rolycoly,
-- C15 Wimpod); album:C active on odds:paid:commons; 25 infinite C commons;
-- album:C enabled inventory 25; all-cards enabled inventory 75.
--
-- SELECT a.id, a.title, a.status, a.size,
--   (SELECT COUNT(*) FROM album_cards WHERE album_id = 'C') AS slots,
--   (SELECT c.name FROM album_cards ac JOIN cards c ON c.id = ac.card_id WHERE ac.album_id = 'C' AND ac.slot = 5) AS c5,
--   (SELECT c.name FROM album_cards ac JOIN cards c ON c.id = ac.card_id WHERE ac.album_id = 'C' AND ac.slot = 15) AS c15
-- FROM albums a WHERE a.id = 'C';
--
-- SELECT id, status, paid_odds_config_id, free_odds_config_id, inventory_version
-- FROM gachas WHERE id = 'album:C';
--
-- SELECT COUNT(*) AS n,
--   SUM(CASE WHEN supply = 'infinite' AND available = 0 THEN 1 ELSE 0 END) AS infinite_zero
-- FROM stock_items WHERE album_id = 'C' AND tier = 'common';
--
-- SELECT COUNT(*) AS n
-- FROM gacha_inventory gi
-- JOIN gachas g ON g.id = gi.gacha_id AND gi.inventory_version = g.inventory_version
-- WHERE g.id = 'album:C' AND gi.enabled = 1;
--
-- SELECT COUNT(*) AS n
-- FROM gacha_inventory gi
-- JOIN gachas g ON g.id = gi.gacha_id AND gi.inventory_version = g.inventory_version
-- WHERE g.id = 'all-cards' AND gi.enabled = 1;
