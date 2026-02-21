-- Migration: Add Strava integration tables
-- Run this to create the new tables

CREATE TABLE IF NOT EXISTS strava_runs (
  id SERIAL PRIMARY KEY,
  strava_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  start_date TIMESTAMP NOT NULL,
  distance INTEGER,
  moving_time INTEGER,
  gpx_data TEXT NOT NULL,
  coordinates JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS park_visits (
  id SERIAL PRIMARY KEY,
  park_id INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL REFERENCES strava_runs(id) ON DELETE CASCADE,
  visit_date TIMESTAMP NOT NULL,
  entry_point JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS park_wishlist (
  id SERIAL PRIMARY KEY,
  park_id INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES strava_runs(id) ON DELETE SET NULL,
  near_miss_distance INTEGER,
  added_date TIMESTAMP DEFAULT NOW() NOT NULL,
  visited BOOLEAN DEFAULT FALSE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_park_visits_park_id ON park_visits(park_id);
CREATE INDEX IF NOT EXISTS idx_park_visits_run_id ON park_visits(run_id);
CREATE INDEX IF NOT EXISTS idx_park_wishlist_park_id ON park_wishlist(park_id);
CREATE INDEX IF NOT EXISTS idx_strava_runs_start_date ON strava_runs(start_date);
