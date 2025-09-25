-- Add JSONB columns to encounters table for structured actor data
-- This migration adds support for storing boss, adds, and party member data as JSON objects

-- Add JSONB columns to encounters table
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS boss JSONB;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS adds JSONB[];
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS party_members JSONB[];

-- Add comments for documentation
COMMENT ON COLUMN encounters.boss IS 'JSONB object containing boss information: { name, job?, role?, id? }';
COMMENT ON COLUMN encounters.adds IS 'Array of JSONB objects for add/mob information: [{ name, job?, role?, id? }, ...]';
COMMENT ON COLUMN encounters.party_members IS 'Array of JSONB objects for party member information: [{ name, job?, role?, id? }, ...]';

-- Add indexes for performance on JSONB queries
CREATE INDEX IF NOT EXISTS idx_encounters_boss_name ON encounters USING GIN ((boss->>'name'));
CREATE INDEX IF NOT EXISTS idx_encounters_party_members ON encounters USING GIN (party_members);

-- Example queries for the new structure:
-- Find encounters by boss name: SELECT * FROM encounters WHERE boss->>'name' = 'Titan';
-- Find encounters with specific party size: SELECT * FROM encounters WHERE jsonb_array_length(party_members) = 8;
-- Find encounters with specific job in party: SELECT * FROM encounters WHERE party_members @> '[{"job": "PLD"}]';