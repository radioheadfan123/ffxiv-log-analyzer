# FFXIV Log Parser Guide

This guide explains how the enhanced FFXIV log parser works with comprehensive actor classification and JSONB schema support.

## Overview

The parser has been enhanced to provide:
- **Comprehensive actor classification** using damage heuristics and job data
- **Structured JSONB storage** for boss, adds, and party member data  
- **Enhanced job detection** using the complete FFXIV job database
- **Backward compatibility** with existing string-based encounter data

## Parser Architecture

### Job Data Loading
```typescript
// Jobs are eagerly loaded at startup for optimal performance
const allJobs = loadAllJobs(); // Loads all 22 FFXIV jobs with skills
console.log(`Loaded ${allJobs.length} job definitions for actor classification`);
```

### Actor Classification Process

1. **Data Collection**: Parse combat logs to collect actor statistics:
   - Total damage dealt/taken per actor
   - Hit counts (how many times each actor was targeted)
   - Skills used by each actor

2. **Player Identification**: Match actor skills against job database:
   ```typescript
   // Example: Actor using "Fast Blade" → identified as Paladin (PLD)
   const job = findJobBySkillName("Fast Blade"); // Returns PLD job data
   ```

3. **Boss/Add Classification**: Use damage heuristics:
   - **Boss**: High damage taken (>2x average) + high hit count (>1.5x average)
   - **Add**: Moderate damage taken, secondary NPCs
   - **Player**: Uses identifiable job skills

### JSONB Schema Structure

```typescript
// Encounters table new columns:
interface EncounterData {
  // Legacy string fields (maintained for compatibility)
  boss: string;           // "Titan"
  duty: string;           // "The Navel (Extreme)"
  
  // New JSONB fields  
  boss_data: {            // Single boss object
    name: string;         // "Titan"
    job?: string;         // null for NPCs
    role?: string;        // null for NPCs  
    id?: string;          // database actor ID
  } | null;
  
  adds: Array<{           // Array of add/mob objects
    name: string;         // "Granite Gaol"
    job?: string;         // null for NPCs
    role?: string;        // null for NPCs
    id?: string;          // database actor ID
  }>;
  
  party_members: Array<{  // Array of player objects
    name: string;         // "John Doe"
    job?: string;         // "PLD"
    role?: string;        // "tank"
    id?: string;          // database actor ID
  }>;
}
```

## Actor Classification Logic

### Player Detection
Players are identified by matching their skill usage against the job database:

```typescript
// Example skill patterns:
- Uses "Fast Blade" → Paladin (PLD, tank)
- Uses "Cure" → White Mage (WHM, healer)  
- Uses "Heavy Swing" → Warrior (WAR, tank)
```

### Boss Detection Heuristics
Bosses are identified using multiple criteria:

```typescript
const damageRatio = actor.totalDamageTaken / avgDamageTaken;
const hitRatio = actor.hitCount / avgHitCount;

// Boss criteria:
if (damageRatio >= 2.0 && hitRatio >= 1.5 && actor.totalDamageTaken > 10000) {
  return 'boss';
}
```

### Add Classification
Adds (additional monsters/NPCs) are classified as:
- Non-player entities (don't use job skills)
- Moderate damage taken (not boss-level)
- Secondary targets in encounters

## Database Migration

Run the migration to add JSONB columns:

```sql
-- supabase/migrations/001_add_jsonb_columns.sql
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS boss_data JSONB;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS adds JSONB[];
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS party_members JSONB[];
```

## Querying JSONB Data

### Find encounters by boss name:
```sql
SELECT * FROM encounters 
WHERE boss_data->>'name' = 'Titan';
```

### Find encounters with specific party size:
```sql  
SELECT * FROM encounters 
WHERE jsonb_array_length(party_members) = 8;
```

### Find encounters with specific job in party:
```sql
SELECT * FROM encounters 
WHERE party_members @> '[{"job": "PLD"}]';
```

### Complex party composition queries:
```sql
-- Find encounters with at least one tank
SELECT * FROM encounters 
WHERE party_members @> '[{"role": "tank"}]';

-- Count encounters by party job distribution
SELECT 
  boss_data->>'name' as boss_name,
  jsonb_array_length(party_members) as party_size,
  COUNT(*) as encounter_count
FROM encounters 
WHERE boss_data IS NOT NULL
GROUP BY boss_data->>'name', jsonb_array_length(party_members);
```

## Performance Considerations

### Indexes
The migration includes performance indexes:
```sql
-- Fast boss name lookups
CREATE INDEX idx_encounters_boss_data_name ON encounters USING GIN ((boss_data->>'name'));

-- Fast party member queries  
CREATE INDEX idx_encounters_party_members ON encounters USING GIN (party_members);
```

### Caching
- Job data is cached in memory for fast skill lookups
- Actor classification results are computed once per encounter

## Backward Compatibility

The parser maintains full backward compatibility:

1. **Legacy encounters** continue to work with string `boss` and `duty` fields
2. **UI components** gracefully fallback to legacy data when JSONB is not available
3. **Database queries** work with both old and new schemas

## Usage Examples

### Frontend Components
```typescript
// Encounter list component
const bossName = encounter.boss_data?.name || encounter.boss || 'Unknown Boss';
const partySize = encounter.party_members?.length || 0;
```

### API Queries
```typescript
// Fetch encounters with JSONB data
const { data } = await supabase
  .from('encounters')
  .select('id,boss,duty,boss_data,adds,party_members')
  .order('start_ts', { ascending: false });
```

## Troubleshooting

### Common Issues

1. **JSONB columns not found**: Migration hasn't been run yet
   - Solution: Parser gracefully handles this and uses legacy format

2. **Job detection failing**: Actor uses unrecognized skills
   - Solution: Parser falls back to "UNK" job and "dps" role defaults

3. **Boss classification incorrect**: Unusual damage patterns  
   - Solution: Manual verification via actor damage/hit statistics

### Debug Information
The parser logs classification results:
```
Loaded 22 job definitions for actor classification
encounter 1/3: create
encounter 1: actors select/insert  
```

## Future Enhancements

Potential improvements:
- **Duty detection**: Enhanced logic to identify specific duties/raids
- **Skill-based classification**: More sophisticated NPC identification
- **Timeline analysis**: Actor behavior patterns over time
- **Advanced metrics**: Performance scoring based on job-specific criteria