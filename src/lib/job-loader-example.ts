// Example usage of the job loader utility
// This file demonstrates how to use the job loader in your application

import {
  loadJobByAbbreviation,
  loadJobById,
  loadAllJobs,
  findSkillById,
  findSkillsByPartialName,
  getJobsByRole,
  getJobStats,
  type JobData
} from './job-loader';

// Example 1: Load a specific job
export function getJobInfo(jobAbbr: string): JobData | null {
  return loadJobByAbbreviation(jobAbbr);
}

// Example 2: Get job by ID (useful when parsing log data)
export function getJobFromId(jobId: number): JobData | null {
  return loadJobById(jobId);
}

// Example 3: Find what job uses a specific skill
export function getSkillInfo(skillId: number): { jobName: string; skillName: string; potency: number } | null {
  const result = findSkillById(skillId);
  if (!result) return null;
  
  return {
    jobName: result.job.name,
    skillName: result.skill.name,
    potency: result.skill.potency
  };
}

// Example 4: Search for skills by name
export function searchSkills(searchTerm: string): Array<{ job: string; skill: string; type: string }> {
  const results = findSkillsByPartialName(searchTerm);
  return results.map(r => ({
    job: r.job.abbreviation,
    skill: r.skill.name,
    type: r.skill.type
  }));
}

// Example 5: Get all jobs for a role
export function getTankJobs(): JobData[] {
  return getJobsByRole('tank');
}

export function getHealerJobs(): JobData[] {
  return getJobsByRole('healer');
}

export function getDpsJobs(): JobData[] {
  return getJobsByRole('dps');
}

// Example 6: Get high-potency damage skills across all jobs
export function getHighPotencySkills(minPotency = 500): Array<{ job: string; skill: string; potency: number }> {
  const allJobs = loadAllJobs();
  const highPotencySkills: Array<{ job: string; skill: string; potency: number }> = [];
  
  for (const job of allJobs) {
    const powerfulSkills = job.skills.filter(
      skill => skill.type === 'damage' && skill.potency >= minPotency
    );
    
    for (const skill of powerfulSkills) {
      highPotencySkills.push({
        job: job.abbreviation,
        skill: skill.name,
        potency: skill.potency
      });
    }
  }
  
  return highPotencySkills.sort((a, b) => b.potency - a.potency);
}

// Example 7: Get healing skills by potency
export function getHealingSkills(): Array<{ job: string; skill: string; potency: number }> {
  const allJobs = loadAllJobs();
  const healingSkills: Array<{ job: string; skill: string; potency: number }> = [];
  
  for (const job of allJobs) {
    const heals = job.skills.filter(skill => skill.type === 'heal' && skill.potency > 0);
    
    for (const skill of heals) {
      healingSkills.push({
        job: job.abbreviation,
        skill: skill.name,
        potency: skill.potency
      });
    }
  }
  
  return healingSkills.sort((a, b) => b.potency - a.potency);
}

// Example 8: Get job summary for display
export function getJobSummary(jobAbbr: string): {
  name: string;
  role: string;
  totalSkills: number;
  damageSkills: number;
  supportSkills: number;
  averagePotency: number;
} | null {
  const job = loadJobByAbbreviation(jobAbbr);
  if (!job) return null;
  
  const damageSkills = job.skills.filter(s => s.type === 'damage');
  const supportSkills = job.skills.filter(s => ['heal', 'shield', 'buff'].includes(s.type));
  const skillsWithPotency = job.skills.filter(s => s.potency > 0);
  const averagePotency = skillsWithPotency.length > 0 
    ? skillsWithPotency.reduce((sum, s) => sum + s.potency, 0) / skillsWithPotency.length 
    : 0;
  
  return {
    name: job.name,
    role: job.role,
    totalSkills: job.skills.length,
    damageSkills: damageSkills.length,
    supportSkills: supportSkills.length,
    averagePotency: Math.round(averagePotency)
  };
}

// Example 9: Usage in log parsing context
export function identifyLogAction(actionId: number, actorName: string): {
  skill: string;
  job: string;
  type: string;
  potency: number;
} | null {
  const result = findSkillById(actionId);
  if (!result) {
    console.warn(`Unknown action ID ${actionId} used by ${actorName}`);
    return null;
  }
  
  return {
    skill: result.skill.name,
    job: result.job.abbreviation,
    type: result.skill.type,
    potency: result.skill.potency
  };
}

// Example 10: Get system statistics
export function getSystemInfo(): {
  stats: ReturnType<typeof getJobStats>;
  highestPotencySkill: { skill: string; job: string; potency: number } | null;
  mostSkillsJob: { job: string; count: number } | null;
} {
  const stats = getJobStats();
  const allJobs = loadAllJobs();
  
  // Find highest potency skill
  let highestPotencySkill: { skill: string; job: string; potency: number } | null = null;
  let mostSkillsJob: { job: string; count: number } | null = null;
  
  for (const job of allJobs) {
    // Check for most skills
    if (!mostSkillsJob || job.skills.length > mostSkillsJob.count) {
      mostSkillsJob = { job: job.name, count: job.skills.length };
    }
    
    // Check for highest potency
    for (const skill of job.skills) {
      if (!highestPotencySkill || skill.potency > highestPotencySkill.potency) {
        highestPotencySkill = {
          skill: skill.name,
          job: job.abbreviation,
          potency: skill.potency
        };
      }
    }
  }
  
  return {
    stats,
    highestPotencySkill,
    mostSkillsJob
  };
}