// Deno-compatible actor classification utility for FFXIV log parsing
// Classifies actors as boss, add, or player using damage heuristics and job data

import { JobData, loadAllJobs, findJobBySkillName } from './job-loader-deno.ts';

export interface ActorInfo {
  name: string;
  id?: string;
  job?: string;
  role?: 'tank' | 'healer' | 'dps';
  classification?: 'boss' | 'add' | 'player';
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

  constructor() {
    this.allJobs = loadAllJobs();
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

    // First pass: identify players by skill usage
    for (const actor of actors) {
      const jobInfo = this.getActorJob(Array.from(actor.skillsUsed));
      if (jobInfo.job) {
        actor.job = jobInfo.job;
        actor.role = jobInfo.role;
        actor.classification = 'player';
        classified.partyMembers.push(actor);
      }
    }

    // Second pass: classify remaining actors as boss/adds
    const npcs = actors.filter(actor => actor.classification !== 'player');
    
    if (npcs.length === 0) {
      return classified;
    }

    // Sort NPCs by damage taken (descending) to identify bosses
    npcs.sort((a, b) => b.totalDamageTaken - a.totalDamageTaken);

    // Boss heuristics
    const avgDamageTaken = npcs.reduce((sum, a) => sum + a.totalDamageTaken, 0) / npcs.length;
    const avgHitCount = npcs.reduce((sum, a) => sum + a.hitCount, 0) / npcs.length;

    for (const actor of npcs) {
      const classification = this.classifySingleNPC(actor, avgDamageTaken, avgHitCount);
      actor.classification = classification;

      if (classification === 'boss') {
        // Take the first (highest damage taken) as primary boss
        if (!classified.boss) {
          classified.boss = actor;
        } else {
          // Additional boss-like entities become adds
          actor.classification = 'add';
          classified.adds.push(actor);
        }
      } else {
        classified.adds.push(actor);
      }
    }

    // Fallback: if no clear boss, promote the strongest add
    if (!classified.boss && classified.adds.length > 0) {
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
   * Classify a single NPC actor as boss or add
   */
  private classifySingleNPC(actor: ActorInfo, avgDamageTaken: number, avgHitCount: number): 'boss' | 'add' {
    // Boss heuristics:
    // - Takes significantly more damage than average (target of many attacks)
    // - Has high hit count (many people attacking it)
    // - Has substantial absolute damage taken
    
    const damageRatio = avgDamageTaken > 0 ? actor.totalDamageTaken / avgDamageTaken : 0;
    const hitRatio = avgHitCount > 0 ? actor.hitCount / avgHitCount : 0;

    // Boss: high damage taken, high hit count, substantial absolute damage
    if (damageRatio >= 2.0 && hitRatio >= 1.5 && actor.totalDamageTaken > 10000) {
      return 'boss';
    }

    // Alternative boss criteria: very high absolute damage taken
    if (actor.totalDamageTaken > 50000 && hitRatio >= 1.2) {
      return 'boss';
    }

    // Default to add
    return 'add';
  }

  /**
   * Get job information for an actor based on skill usage
   */
  getActorJob(skillsUsed: string[]): { job?: string; role?: 'tank' | 'healer' | 'dps' } {
    const jobHits = new Map<string, number>();

    for (const skillName of skillsUsed) {
      const job = findJobBySkillName(skillName);
      if (job) {
        jobHits.set(job.abbreviation, (jobHits.get(job.abbreviation) || 0) + 1);
      }
    }

    if (jobHits.size === 0) {
      return {};
    }

    // Find the job with the most skill matches
    const bestMatch = Array.from(jobHits.entries())
      .sort((a, b) => b[1] - a[1])[0];

    const job = this.allJobs.find(j => j.abbreviation === bestMatch[0]);
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