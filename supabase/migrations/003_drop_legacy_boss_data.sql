-- Migration to drop any leftover boss_data column if it exists
-- This ensures complete cleanup of the old boss_data field

-- Drop the old boss_data column if it still exists
-- This is safe to run even if the column doesn't exist due to IF EXISTS
ALTER TABLE encounters DROP COLUMN IF EXISTS boss_data;

-- Drop any legacy index that might still reference boss_data
DROP INDEX IF EXISTS idx_encounters_boss_data_name;