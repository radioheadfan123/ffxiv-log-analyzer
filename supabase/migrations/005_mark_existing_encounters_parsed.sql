-- Mark existing encounters as already parsed for backwards compatibility
-- This ensures that encounters that were parsed before the two-stage system
-- are marked as having their details already parsed

UPDATE encounters 
SET details_parsed = TRUE 
WHERE details_parsed IS NULL OR details_parsed = FALSE;

-- For encounters without raw_log_path, we can't re-parse them, so mark them as parsed
-- (they already have their data from the old single-stage system)
UPDATE encounters 
SET details_parsed = TRUE 
WHERE raw_log_path IS NULL;