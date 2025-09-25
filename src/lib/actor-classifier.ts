// Actor classification utility for FFXIV log parsing
// Classifies actors as boss, add, or player using damage heuristics and job data

import { JobData, loadAllJobs } from './job-loader';

export interface ActorInfo {
  name: string;
  id?: string;
  job?: string;
  role?: 'tank' | 'healer' | 'dps';
  classification: 'boss' | 'add' | 'player';
  totalDamageDealt: number;
  totalDamageTaken: number;
  hitCount: number;
  skillsUsed: Set<string>;
}

export interface ClassificationResult {
  boss: ActorInfo | null;
  adds: ActorInfo[];
  partyMembers: ActorInfo[];
}

export class ActorClassifier {
  private allJobs: JobData[];
  private playerSkillIds: Set<number>;
  private jobsBySkillId: Map<number, JobData>;
  private jobsByAbbreviation: Map<string, JobData>;

  constructor() {
    this.allJobs = loadAllJobs();
    this.playerSkillIds = new Set();
    this.jobsBySkillId = new Map();
    this.jobsByAbbreviation = new Map();

    // Build lookup maps for efficient classification
    for (const job of this.allJobs) {
      this.jobsByAbbreviation.set(job.abbreviation.toLowerCase(), job);
      for (const skill of job.skills) {
        this.playerSkillIds.add(skill.id);
        this.jobsBySkillId.set(skill.id, job);
      }
    }
  }

  /**
   * Classify actors based on damage patterns and skill usage
   */
  classifyActors(actorStats: Map<string, ActorInfo>): ClassificationResult {
    const actors = Array.from(actorStats.values());

    const classified: ClassificationResult = {
      boss: null,
      adds: [],
      partyMembers: []
    };

    for (const actor of actors) {
      const classification = this.classifySingleActor(actor, actors);
      actor.classification = classification;

      switch (classification) {
        case 'boss':
          // Take the highest damage-taken actor as the primary boss
          if (!classified.boss || actor.totalDamageTaken > classified.boss.totalDamageTaken) {
            if (classified.boss) {
              // Demote previous boss to add
              classified.boss.classification = 'add';
              classified.adds.push(classified.boss);
            }
            classified.boss = actor;
          } else {
            // Secondary boss-like entity becomes an add
            actor.classification = 'add';
            classified.adds.push(actor);
          }
          break;
        case 'add':
          classified.adds.push(actor);
          break;
        case 'player':
          classified.partyMembers.push(actor);
          break;
      }
    }

    // Final validation: ensure we have reasonable results
    if (!classified.boss && classified.adds.length > 0) {
      // Promote the strongest add to boss
      const strongestAdd = classified.adds.reduce((prev, curr) => 
        curr.totalDamageTaken > prev.totalDamageTaken ? curr : prev
      );
      classified.boss = strongestAdd;
      classified.boss.classification = 'boss';
      classified.adds = classified.adds.filter(add => add !== strongestAdd);
    }

    return classified;
  }

  /**
   * Classify a single actor based on their behavior patterns
   */
  private classifySingleActor(actor: ActorInfo, allActors: ActorInfo[]): 'boss' | 'add' | 'player' {
    // Check if actor uses player skills
    const usesPlayerSkills = this.usesPlayerSkills(actor);
    if (usesPlayerSkills) {
      return 'player';
    }

    // Calculate damage ratios for heuristics
    const avgDamageTaken = allActors.reduce((sum, a) => sum + a.totalDamageTaken, 0) / allActors.length;

    // Boss heuristics:
    // - Takes significantly more damage than average (target of many attacks)
    // - Has high hit count (many people attacking it)
    // - Doesn't use player job skills
    const damageRatio = avgDamageTaken > 0 ? actor.totalDamageTaken / avgDamageTaken : 0;
    const avgHitCount = allActors.reduce((sum, a) => sum + a.hitCount, 0) / allActors.length;
    const hitRatio = avgHitCount > 0 ? actor.hitCount / avgHitCount : 0;

    // Boss: high damage taken, high hit count
    if (damageRatio >= 2.0 && hitRatio >= 1.5 && actor.totalDamageTaken > 10000) {
      return 'boss';
    }

    // Add: moderate damage taken, but not boss-level
    if (damageRatio >= 1.2 && actor.totalDamageTaken > 1000) {
      return 'add';
    }

    // Default to add for non-player entities
    return 'add';
  }

  /**
   * Check if an actor uses skills from player jobs
   */
  private usesPlayerSkills(actor: ActorInfo): boolean {
    for (const skillName of actor.skillsUsed) {
      // Try to find this skill in our job data
      for (const job of this.allJobs) {
        const skill = job.skills.find(s => s.name.toLowerCase() === skillName.toLowerCase());
        if (skill) {
          // Update actor's job info if we found a match
          actor.job = job.abbreviation;
          actor.role = job.role;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get job information for an actor based on skill usage
   */
  getActorJob(skillsUsed: string[]): { job?: string; role?: 'tank' | 'healer' | 'dps' } {
    const jobHits = new Map<string, number>();

    for (const skillName of skillsUsed) {
      for (const job of this.allJobs) {
        const skill = job.skills.find(s => s.name.toLowerCase() === skillName.toLowerCase());
        if (skill) {
          jobHits.set(job.abbreviation, (jobHits.get(job.abbreviation) || 0) + 1);
        }
      }
    }

    if (jobHits.size === 0) {
      return {};
    }

    // Find the job with the most skill matches
    const bestMatch = Array.from(jobHits.entries())
      .sort((a, b) => b[1] - a[1])[0];

    const job = this.jobsByAbbreviation.get(bestMatch[0].toLowerCase());
    return job ? { job: job.abbreviation, role: job.role } : {};
  }

  /**
   * Convert ActorInfo to JSON format for JSONB storage
   */
  static toJsonObject(actor: ActorInfo): object {
    return {
      name: actor.name,
      id: actor.id || null,
      job: actor.job || null,
      role: actor.role || null
    };
  }
}