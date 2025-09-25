// Deno-compatible job loader for Supabase Edge Function
// This is a simplified version that loads job data for actor classification

export interface JobSkill {
  id: number;
  name: string;
  potency: number;
  type: 'damage' | 'heal' | 'shield' | 'buff' | 'debuff' | 'other';
}

export interface JobData {
  id: number;
  abbreviation: string;
  name: string;
  role: 'tank' | 'healer' | 'dps';
  skills: JobSkill[];
}

// Hard-coded job data for Deno environment (subset of most common jobs)
// In a production environment, this could be loaded from an external source
const JOBS_DATA: JobData[] = [
  {
    "id": 19,
    "abbreviation": "PLD",
    "name": "Paladin",
    "role": "tank",
    "skills": [
      { "id": 9, "name": "Fast Blade", "potency": 200, "type": "damage" },
      { "id": 15, "name": "Riot Blade", "potency": 300, "type": "damage" },
      { "id": 21, "name": "Rage of Halone", "potency": 400, "type": "damage" },
      { "id": 24, "name": "Shield Lob", "potency": 100, "type": "damage" },
      { "id": 28, "name": "Iron Will", "potency": 0, "type": "buff" },
      { "id": 30, "name": "Shield Bash", "potency": 110, "type": "damage" }
    ]
  },
  {
    "id": 21,
    "abbreviation": "WAR",
    "name": "Warrior",
    "role": "tank",
    "skills": [
      { "id": 31, "name": "Heavy Swing", "potency": 200, "type": "damage" },
      { "id": 32, "name": "Maim", "potency": 300, "type": "damage" },
      { "id": 33, "name": "Berserk", "potency": 0, "type": "buff" },
      { "id": 35, "name": "Overpower", "potency": 130, "type": "damage" },
      { "id": 37, "name": "Tomahawk", "potency": 100, "type": "damage" }
    ]
  },
  {
    "id": 24,
    "abbreviation": "WHM",
    "name": "White Mage",
    "role": "healer",
    "skills": [
      { "id": 119, "name": "Stone", "potency": 140, "type": "damage" },
      { "id": 120, "name": "Cure", "potency": 500, "type": "heal" },
      { "id": 121, "name": "Aero", "potency": 50, "type": "damage" },
      { "id": 124, "name": "Medica", "potency": 400, "type": "heal" },
      { "id": 125, "name": "Raise", "potency": 0, "type": "other" }
    ]
  },
  {
    "id": 28,
    "abbreviation": "SCH",
    "name": "Scholar",
    "role": "healer",
    "skills": [
      { "id": 163, "name": "Ruin", "potency": 180, "type": "damage" },
      { "id": 190, "name": "Physick", "potency": 450, "type": "heal" },
      { "id": 185, "name": "Adloquium", "potency": 300, "type": "shield" },
      { "id": 186, "name": "Succor", "potency": 200, "type": "shield" }
    ]
  },
  {
    "id": 22,
    "abbreviation": "MNK",
    "name": "Monk",
    "role": "dps",
    "skills": [
      { "id": 53, "name": "Bootshine", "potency": 200, "type": "damage" },
      { "id": 56, "name": "True Strike", "potency": 300, "type": "damage" },
      { "id": 61, "name": "Snap Punch", "potency": 250, "type": "damage" },
      { "id": 54, "name": "Dragon Kick", "potency": 320, "type": "damage" }
    ]
  },
  {
    "id": 30,
    "abbreviation": "DRG",
    "name": "Dragoon", 
    "role": "dps",
    "skills": [
      { "id": 75, "name": "True Thrust", "potency": 200, "type": "damage" },
      { "id": 78, "name": "Vorpal Thrust", "potency": 300, "type": "damage" },
      { "id": 85, "name": "Full Thrust", "potency": 400, "type": "damage" },
      { "id": 86, "name": "Piercing Talon", "potency": 100, "type": "damage" }
    ]
  },
  {
    "id": 25,
    "abbreviation": "BLM",
    "name": "Black Mage",
    "role": "dps", 
    "skills": [
      { "id": 142, "name": "Blizzard", "potency": 180, "type": "damage" },
      { "id": 141, "name": "Fire", "potency": 180, "type": "damage" },
      { "id": 144, "name": "Thunder", "potency": 30, "type": "damage" },
      { "id": 145, "name": "Blizzard II", "potency": 50, "type": "damage" }
    ]
  }
];

// Cache for loaded jobs
let jobsLoaded = false;
const jobCache = new Map<string, JobData>();
const skillToJobMap = new Map<string, JobData>();

/**
 * Load all job data (synchronous in Deno environment)
 */
export function loadAllJobs(): JobData[] {
  if (!jobsLoaded) {
    // Populate caches
    for (const job of JOBS_DATA) {
      jobCache.set(job.abbreviation.toLowerCase(), job);
      
      // Index skills by name for quick lookup
      for (const skill of job.skills) {
        skillToJobMap.set(skill.name.toLowerCase(), job);
      }
    }
    jobsLoaded = true;
  }
  
  return JOBS_DATA;
}

/**
 * Find job by abbreviation
 */
export function findJobByAbbreviation(abbreviation: string): JobData | null {
  loadAllJobs(); // Ensure data is loaded
  return jobCache.get(abbreviation.toLowerCase()) || null;
}

/**
 * Find job by skill name
 */
export function findJobBySkillName(skillName: string): JobData | null {
  loadAllJobs(); // Ensure data is loaded
  return skillToJobMap.get(skillName.toLowerCase()) || null;
}

/**
 * Check if a skill name belongs to any player job
 */
export function isPlayerSkill(skillName: string): boolean {
  return findJobBySkillName(skillName) !== null;
}

/**
 * Get all jobs of a specific role
 */
export function getJobsByRole(role: 'tank' | 'healer' | 'dps'): JobData[] {
  const allJobs = loadAllJobs();
  return allJobs.filter(job => job.role === role);
}