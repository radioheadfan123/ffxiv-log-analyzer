-- Add column to track encounter parsing status
-- This enables the two-stage parsing system where headers are parsed first,
-- then detailed parsing happens on-demand

ALTER TABLE encounters ADD COLUMN IF NOT EXISTS details_parsed BOOLEAN DEFAULT FALSE;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS raw_log_path TEXT; -- Store path to original log for re-parsing

-- Add comments for documentation
COMMENT ON COLUMN encounters.details_parsed IS 'Boolean indicating if detailed events/actors/metrics have been parsed for this encounter';
COMMENT ON COLUMN encounters.raw_log_path IS 'Path to the original log file in storage for on-demand parsing';

-- Add index for querying unparsed encounters
CREATE INDEX IF NOT EXISTS idx_encounters_details_parsed ON encounters (details_parsed);