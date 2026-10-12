-- Paid streak (#376) on a D1 that already has the raffle tables. Safe to run twice.
-- Do not re-apply schema.sql and do not reset the database.
-- Apply before the Worker that reads these tables: a paid commit inserts season_streaks,
-- and without the table that batch rolls back.

CREATE TABLE IF NOT EXISTS season_streaks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0 AND count < 5),
  last_day TEXT NOT NULL,
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE IF NOT EXISTS season_streak_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tickets INTEGER NOT NULL CHECK (tickets = 2),
  pull_id TEXT NOT NULL REFERENCES pulls(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, season_id, day)
);
