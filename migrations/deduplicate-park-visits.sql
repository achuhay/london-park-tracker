-- Migration: Deduplicate park_visits and add unique constraint
-- This fixes a bug where the same activity could record multiple visits
-- to the same park (e.g. Du Cane Court appearing 5x from one run).
--
-- Run this ONCE against your database before deploying the updated code.

-- Step 1: Remove duplicate rows, keeping only the earliest record per
-- (park_id, activity_id) pair. The MIN(id) trick keeps the first-inserted row.
DELETE FROM park_visits
WHERE id NOT IN (
  SELECT MIN(id)
  FROM park_visits
  GROUP BY park_id, activity_id
);

-- Step 2: Add a unique constraint so the database enforces 1 visit per
-- (park, activity) pair from now on. Duplicate inserts will now error
-- instead of silently succeeding.
ALTER TABLE park_visits
ADD CONSTRAINT park_visits_unique_visit UNIQUE (park_id, activity_id);
