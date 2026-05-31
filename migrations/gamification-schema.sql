-- Gamification schema additions
-- Run against the Railway database after deploying the code changes.

-- 1. Add user_id to park_visits (nullable for legacy rows)
ALTER TABLE park_visits ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS park_visits_user_idx ON park_visits(user_id);

-- 2. Add gamification columns to parks
ALTER TABLE parks ADD COLUMN IF NOT EXISTS is_royal_park BOOLEAN DEFAULT FALSE;
ALTER TABLE parks ADD COLUMN IF NOT EXISTS north_of_thames BOOLEAN;

-- 3. Add leaderboard/display columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_on_leaderboard BOOLEAN DEFAULT TRUE;

-- 4. Tag the 8 Royal Parks (matched to actual park names in the database)
UPDATE parks SET is_royal_park = TRUE WHERE name IN (
  'Hyde Park',
  'Richmond Park',
  'Greenwich Park',
  'Green Park *',
  'Kensington Gardens (including Kensington Palace Gardens) *',
  'Kensington Gardens *',
  'Bushy Park (including Upper Lodge Gardens) *',
  'St James''s Park, including Queen Victoria Memorial Gardens *',
  'Regent''s Park (Camden) *',
  'Regent''s Park, including Queen Mary''s Gardens *'
);

-- 5. Compute north_of_thames from latitude (Thames through central London ≈ 51.505°N)
--    Parks north of that line are north_of_thames = true
UPDATE parks
SET north_of_thames = (latitude > 51.505)
WHERE latitude IS NOT NULL;
