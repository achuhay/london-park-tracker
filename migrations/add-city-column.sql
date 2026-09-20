-- Add city column to parks (multi-city support: London + Edinburgh)
-- Run against the Railway database after deploying the code changes.

ALTER TABLE parks ADD COLUMN IF NOT EXISTS city TEXT;

-- Backfill all existing rows as 'london' (every current row IS London data)
UPDATE parks SET city = 'london' WHERE city IS NULL;

-- Now enforce NOT NULL going forward
ALTER TABLE parks ALTER COLUMN city SET NOT NULL;

-- Index for the city filter (every getParks/getFilterOptions/badge/leaderboard query will filter on it)
CREATE INDEX IF NOT EXISTS parks_city_idx ON parks(city);

-- Composite index matching the existing park_name_borough_idx pattern, city-aware
CREATE INDEX IF NOT EXISTS park_city_borough_idx ON parks(city, borough);
