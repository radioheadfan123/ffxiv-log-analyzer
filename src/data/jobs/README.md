# FFXIV Job Data

This directory contains JSON data files for all Final Fantasy XIV jobs, including their skills and abilities.

## Structure

Each job file is named by its abbreviation (e.g., `PLD.json`, `WAR.json`) and contains:

- `id`: Numeric job identifier
- `abbreviation`: 3-letter job code
- `name`: Full job name
- `role`: Job role (`tank`, `healer`, or `dps`)
- `skills`: Array of job skills/abilities

### Skill Structure

Each skill in the `skills` array contains:

- `id`: Numeric action identifier
- `name`: Skill/ability name
- `potency`: Base potency value
- `type`: Skill type (`damage`, `heal`, `shield`, `buff`, `debuff`, `other`)

## Jobs Included

### Tanks (4)
- **PLD** - Paladin
- **WAR** - Warrior  
- **DRK** - Dark Knight
- **GNB** - Gunbreaker

### Healers (4)
- **WHM** - White Mage
- **SCH** - Scholar
- **AST** - Astrologian
- **SGE** - Sage

### DPS Jobs (14)

#### Melee DPS (6)
- **MNK** - Monk
- **DRG** - Dragoon
- **NIN** - Ninja
- **SAM** - Samurai
- **RPR** - Reaper
- **VPR** - Viper

#### Physical Ranged DPS (3)
- **BRD** - Bard
- **MCH** - Machinist
- **DNC** - Dancer

#### Magical Ranged DPS (4)
- **BLM** - Black Mage
- **SMN** - Summoner
- **RDM** - Red Mage
- **PCT** - Pictomancer

#### Limited Jobs (1)
- **BLU** - Blue Mage

## Usage

Use the TypeScript loader utility at `src/lib/job-loader.ts` to access this data:

```typescript
import { loadJobByAbbreviation, findSkillById } from '@/lib/job-loader';

// Load a job
const paladin = loadJobByAbbreviation('PLD');

// Find a skill across all jobs
const skill = findSkillById(9); // Fast Blade
```

## Data Sources

Job and skill data is based on the FFXIV ACT Plugin (@ravahn/FFXIV_ACT_Plugin) for accuracy and completeness.

## Statistics

- **Total Jobs**: 22
- **Total Skills**: 468
- **Average Skills per Job**: 21.3