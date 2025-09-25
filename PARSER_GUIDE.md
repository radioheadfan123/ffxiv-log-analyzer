# FFXIV Log Parser Guide

This guide explains how the enhanced FFXIV log parser works with comprehensive actor classification and JSONB schema support.

## Overview

The parser provides:
- **Comprehensive actor classification** using damage heuristics and job data
- **Structured JSONB storage** for boss, adds, and party member data  
- **Enhanced job detection** using the complete FFXIV job database
- **Clean schema design** using only current standardized fields

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
// Encounters table schema:
interface EncounterData {
  id: string;               // Unique encounter identifier
  upload_id: string;        // Reference to upload record
  duty: string;             // "The Navel (Extreme)"
  start_ts: string;         // ISO timestamp of encounter start
  end_ts: string;           // ISO timestamp of encounter end
  
  // JSONB fields  
  boss: {                   // Single boss object (JSONB)
    name: string;           // "Titan"
    job?: string;           // null for NPCs
    role?: string;          // null for NPCs  
    id?: string;            // database actor ID
  } | null;
  
  adds: Array<{             // Array of add/mob objects
    name: string;           // "Granite Gaol"
    job?: string;           // null for NPCs
    role?: string;          // null for NPCs
    id?: string;            // database actor ID
  }>;
  
  party_members: Array<{    // Array of player objects
    name: string;           // "John Doe"
    job?: string;           // "PLD"
    role?: string;          // "tank"
    id?: string;            // database actor ID
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

The current schema uses JSONB columns for structured data:

```sql
-- Core encounter table structure
CREATE TABLE encounters (
  id UUID PRIMARY KEY,
  upload_id UUID REFERENCES uploads(id),
  duty TEXT NOT NULL,
  start_ts TIMESTAMPTZ,
  end_ts TIMESTAMPTZ,
  boss JSONB,
  adds JSONB[],
  party_members JSONB[]
);
```

## Querying JSONB Data

### Find encounters by boss name:
```sql
SELECT * FROM encounters 
WHERE boss->>'name' = 'Titan';
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
  boss->>'name' as boss_name,
  jsonb_array_length(party_members) as party_size,
  COUNT(*) as encounter_count
FROM encounters 
WHERE boss IS NOT NULL
GROUP BY boss->>'name', jsonb_array_length(party_members);
```

## Performance Considerations

### Indexes
The schema includes performance indexes:
```sql
-- Fast boss name lookups
CREATE INDEX idx_encounters_boss_name ON encounters USING GIN ((boss->>'name'));

-- Fast party member queries  
CREATE INDEX idx_encounters_party_members ON encounters USING GIN (party_members);
```

### Caching
- Job data is cached in memory for fast skill lookups
- Actor classification results are computed once per encounter

## Usage Examples

### Frontend Components
```typescript
// Encounter list component
const bossName = encounter.boss?.name || 'Unknown Boss';
const partySize = encounter.party_members?.length || 0;
```

### API Queries
```typescript
// Fetch encounters with structured data
const { data } = await supabase
  .from('encounters')
  .select('id,upload_id,boss,duty,adds,party_members,start_ts,end_ts')
  .order('start_ts', { ascending: false });
```

## Troubleshooting

### Common Issues

1. **JSONB columns not found**: Database schema needs to be up to date
   - Solution: Ensure all migrations have been applied correctly

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