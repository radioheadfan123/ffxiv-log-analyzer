import * as fs from 'fs';
import * as path from 'path';

// Define the structure of job data
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

// Cache for loaded jobs to avoid repeated file system reads
const jobCache = new Map<string, JobData>();
let allJobsCache: JobData[] | null = null;

// Path to the jobs data directory
const JOBS_DATA_PATH = path.join(process.cwd(), 'src', 'data', 'jobs');

/**
 * Load a job by its abbreviation (e.g., 'PLD', 'WAR')
 */
export function loadJobByAbbreviation(abbreviation: string): JobData | null {
  const upperAbbr = abbreviation.toUpperCase();
  
  // Check cache first
  if (jobCache.has(upperAbbr)) {
    return jobCache.get(upperAbbr)!;
  }

  try {
    const filePath = path.join(JOBS_DATA_PATH, `${upperAbbr}.json`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const jobData: JobData = JSON.parse(fileContent);
    
    // Cache the result
    jobCache.set(upperAbbr, jobData);
    
    return jobData;
  } catch (error) {
    console.error(`Error loading job ${upperAbbr}:`, error);
    return null;
  }
}

/**
 * Load a job by its numeric ID
 */
export function loadJobById(jobId: number): JobData | null {
  // First try to find in cache
  const cachedJobs = Array.from(jobCache.values());
  for (const jobData of cachedJobs) {
    if (jobData.id === jobId) {
      return jobData;
    }
  }

  // If not in cache, load all jobs and search
  const allJobs = loadAllJobs();
  return allJobs.find(job => job.id === jobId) || null;
}

/**
 * Load all job data files
 */
export function loadAllJobs(): JobData[] {
  // Return cached result if available
  if (allJobsCache) {
    return allJobsCache;
  }

  const jobs: JobData[] = [];
  
  try {
    if (!fs.existsSync(JOBS_DATA_PATH)) {
      console.error('Jobs data directory not found:', JOBS_DATA_PATH);
      return [];
    }

    const files = fs.readdirSync(JOBS_DATA_PATH);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    for (const file of jsonFiles) {
      const abbreviation = path.basename(file, '.json');
      const jobData = loadJobByAbbreviation(abbreviation);
      
      if (jobData) {
        jobs.push(jobData);
      }
    }
    
    // Cache the result
    allJobsCache = jobs;
    
    return jobs;
  } catch (error) {
    console.error('Error loading all jobs:', error);
    return [];
  }
}

/**
 * Find a skill by its ID across all jobs
 */
export function findSkillById(skillId: number): { job: JobData; skill: JobSkill } | null {
  const allJobs = loadAllJobs();
  
  for (const job of allJobs) {
    const skill = job.skills.find(s => s.id === skillId);
    if (skill) {
      return { job, skill };
    }
  }
  
  return null;
}

/**
 * Find a skill by its name across all jobs (case-insensitive)
 */
export function findSkillByName(skillName: string): { job: JobData; skill: JobSkill } | null {
  const lowerSkillName = skillName.toLowerCase();
  const allJobs = loadAllJobs();
  
  for (const job of allJobs) {
    const skill = job.skills.find(s => s.name.toLowerCase() === lowerSkillName);
    if (skill) {
      return { job, skill };
    }
  }
  
  return null;
}

/**
 * Find all skills matching a partial name (case-insensitive)
 */
export function findSkillsByPartialName(partialName: string): Array<{ job: JobData; skill: JobSkill }> {
  const lowerPartialName = partialName.toLowerCase();
  const allJobs = loadAllJobs();
  const results: Array<{ job: JobData; skill: JobSkill }> = [];
  
  for (const job of allJobs) {
    const matchingSkills = job.skills.filter(s => 
      s.name.toLowerCase().includes(lowerPartialName)
    );
    
    for (const skill of matchingSkills) {
      results.push({ job, skill });
    }
  }
  
  return results;
}

/**
 * Get all jobs of a specific role
 */
export function getJobsByRole(role: 'tank' | 'healer' | 'dps'): JobData[] {
  const allJobs = loadAllJobs();
  return allJobs.filter(job => job.role === role);
}

/**
 * Clear the internal cache (useful for testing or if data files change)
 */
export function clearCache(): void {
  jobCache.clear();
  allJobsCache = null;
}

/**
 * Get job statistics
 */
export function getJobStats(): {
  totalJobs: number;
  totalSkills: number;
  jobsByRole: Record<string, number>;
} {
  const allJobs = loadAllJobs();
  const totalJobs = allJobs.length;
  const totalSkills = allJobs.reduce((sum, job) => sum + job.skills.length, 0);
  
  const jobsByRole = allJobs.reduce((acc, job) => {
    acc[job.role] = (acc[job.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return {
    totalJobs,
    totalSkills,
    jobsByRole
  };
}