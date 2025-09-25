-- Migration to rename boss_data column to boss and preserve old boss as boss_legacy
-- This migration replaces the old 'boss_data' field with the new 'boss' (jsonb) field

-- Step 1: Rename existing boss (string) column to boss_legacy for backward compatibility
ALTER TABLE encounters RENAME COLUMN boss TO boss_legacy;

-- Step 2: Rename boss_data (jsonb) column to boss
ALTER TABLE encounters RENAME COLUMN boss_data TO boss;

-- Step 3: Update column comments
COMMENT ON COLUMN encounters.boss IS 'JSONB object containing boss information: { name, job?, role?, id? }';
COMMENT ON COLUMN encounters.boss_legacy IS 'Legacy string boss field (maintained for compatibility)';

-- Step 4: Drop old index and create new one with updated name
DROP INDEX IF EXISTS idx_encounters_boss_data_name;
CREATE INDEX IF NOT EXISTS idx_encounters_boss_name ON encounters USING GIN ((boss->>'name'));

-- Example queries for the new structure:
-- Find encounters by boss name: SELECT * FROM encounters WHERE boss->>'name' = 'Titan';
-- Find encounters with specific party size: SELECT * FROM encounters WHERE jsonb_array_length(party_members) = 8;
-- Find encounters with specific job in party: SELECT * FROM encounters WHERE party_members @> '[{"job": "PLD"}]';