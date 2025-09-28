import instanceBossLibrary from "./instanceBossLibrary.json" assert { type: "json" };

// --- Utility ---
export function stripServer(name: string) {
  let capCount = 0;
  for (let i = 0; i < name.length; i++) {
    if (name[i] >= 'A' && name[i] <= 'Z') {
      capCount++;
      if (capCount === 3) {
        return name.slice(0, i).trim();
      }
    }
  }
  return name.trim();
}

function findInstanceAndBoss(line: string) {
  for (const entry of instanceBossLibrary) {
    for (const keyword of [...(entry.duty_keywords || []), ...(entry.aliases || [])]) {
      if (line.toLowerCase().includes(keyword.toLowerCase())) {
        return { instance: entry.instance, boss: entry.bosses?.[0] ?? "" };
      }
    }
    for (const boss of entry.bosses || []) {
      if (line.toLowerCase().includes(boss.toLowerCase())) {
        return { instance: entry.instance, boss };
      }
    }
    for (const bossKeyword of entry.boss_keywords || []) {
      if (line.toLowerCase().includes(bossKeyword.toLowerCase())) {
        return { instance: entry.instance, boss: entry.bosses?.[0] ?? bossKeyword };
      }
    }
  }
  return { instance: "Unknown Duty", boss: "Unknown Boss" };
}

function isBossAction(line: string, bossNames: string[]): boolean {
  const p = line.split("|");
  if (["21", "22", "15", "16", "38", "26"].includes(p[0])) {
    const target = p[7] ? stripServer(p[7]) : "";
    if (bossNames.some(boss => target && target.toLowerCase().includes(boss.toLowerCase()))) {
      return true;
    }
    const actor = p[3] ? stripServer(p[3]) : "";
    if (bossNames.some(boss => actor && actor.toLowerCase().includes(boss.toLowerCase()))) {
      return true;
    }
  }
  return false;
}

function isBossKill(line: string, bossNames: string[]): boolean {
  const p = line.split("|");
  if (p[0] === "00") {
    for (const boss of bossNames) {
      const regex = new RegExp(`^${boss}\\s+is defeated\\.?$`, "i");
      if ((p[3] && regex.test(stripServer(p[3]))) || (p[4] && regex.test(stripServer(p[4])))) {
        return true;
      }
    }
    for (const boss of bossNames) {
      const regex = new RegExp(`defeats\\s+${boss}`, "i");
      if (line.match(regex)) return true;
    }
  }
  return false;
}

function matchDeath(line: string, partyArray: string[]): { name: string, ts: string } | null {
  const p = line.split("|");
  if (p[0] === "00") {
    for (const fieldIdx of [3, 4]) {
      let field = p[fieldIdx];
      if (!field) continue;
      if (/^you are defeated\b/i.test(field)) {
        return { name: partyArray[0], ts: getTimestamp(line) };
      }
      const match = /^(.+?) is defeated\b/i.exec(field);
      if (match) {
        const deadName = stripServer(match[1].trim());
        for (const pName of partyArray) {
          if (stripServer(pName) === deadName) return { name: pName, ts: getTimestamp(line) };
        }
        return { name: deadName, ts: getTimestamp(line) };
      }
    }
  }
  return null;
}

function matchRevive(line: string, partyArray: string[]): { name: string, ts: string } | null {
  const p = line.split("|");
  // Look for true revive messages
  // 1. System message: "<player> is revived!" or "<player> has returned to the battle!"
  if (p[0] === "00") {
    for (const idx of [3, 4]) {
      const field = p[idx];
      if (!field) continue;
      // You can add more patterns here as you encounter them in logs
      const reviveMatch = /^(.+?) (?:is revived|has returned to the battle)/i.exec(field);
      if (reviveMatch) {
        const revivedName = stripServer(reviveMatch[1].trim());
        for (const pName of partyArray) {
          if (stripServer(pName) === revivedName) return { name: pName, ts: getTimestamp(line) };
        }
        return { name: revivedName, ts: getTimestamp(line) };
      }
    }
  }
  // 2. Optionally: Detect HP going from 0 to >0 (not implemented here, but can be added if you track HP)
  // 3. Do NOT match "gains the effect of Raise" or similar
  return null;
}

function getTimestamp(line: string): string {
  const p = line.split("|");
  return p[1] || "";
}

// --- Helper to extract boss HP entries from 38/39 log lines ---
function extractBossHpFromLines(
  lines: string[],
  bossName: string
): Array<{ hp: number; maxHp: number; ts: string; line: string }> {
  const boss = bossName.toLowerCase();
  const HP_OPCODES = new Set(["38", "39"]);
  const result: Array<{ hp: number; maxHp: number; ts: string; line: string }> = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 7) continue;
    if (!HP_OPCODES.has(parts[0])) continue;
    if (!(parts[3] && parts[3].toLowerCase().includes(boss))) continue;
    // FFXIV 38/39 lines: curHP = parts[5], maxHP = parts[6]
    const hp = Number(parts[5]);
    const maxHp = Number(parts[6]);
    if (!isNaN(hp) && !isNaN(maxHp)) {
      result.push({
        hp,
        maxHp,
        ts: parts[1] || "",
        line
      });
    }
  }
  return result;
}

type EncounterSummary = {
  startLine: number;
  endLine: number;
  startTimestamp: string;
  endTimestamp: string;
  boss: string;
  instance: string;
  type: "kill" | "wipe";
  lowestBossHp?: number | null;
  maxHp?: number | null;
  lowestBossHpPct?: number | null;
  bossHpEntries?: Array<{ hp: number; maxHp: number; ts: string; line: string }>;
  debug: {
    log: string[];
  };
};

export function scanLogForEncounters(
  lines: string[],
  bossNames: string[],
  partyArray: string[],
  debugLines: string[]
): EncounterSummary[] {
  const encounters: EncounterSummary[] = [];
  let inEncounter = false;
  let encounterStart = 0;
  let encounterStartTs = "";
  let encounterBoss = "";
  let encounterInstance = "";

  // State for party members (use canonical names)
  const partyCanonical = partyArray.map(stripServer);
  let partyAlive = new Map<string, boolean>();
  let deathLog: { name: string; ts: string }[] = [];
  let reviveLog: { name: string; ts: string }[] = [];

  // Trailing pull protection
  let lastWipeTime: string | null = null;
  let lastWipeMs: number | null = null;
  const PULL_DEBOUNCE_MS = 10000;

  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];

    // Before first pull: parse instance and boss
    if (i === 0) {
      let foundInstance = "";
      let foundBoss = "";
      for (let j = 0; j < Math.min(200, lines.length); ++j) {
        const { instance, boss } = findInstanceAndBoss(lines[j]);
        if (instance !== "Unknown Duty" && !foundInstance) foundInstance = instance;
        if (boss !== "Unknown Boss" && !foundBoss) foundBoss = boss;
      }
      if (foundInstance) encounterInstance = foundInstance;
      if (foundBoss) encounterBoss = foundBoss;
    }

    // Always update partyAlive for new log (first time)
    if (i === 0 || !partyAlive.size) {
      partyAlive = new Map(partyCanonical.map(name => [name, true]));
    }

    // Pull debounce: block new pulls until 10s after last wipe
    const curMs = Date.parse(getTimestamp(line) || "1970-01-01T00:00:00Z");
    let canStartPull = true;
    if (lastWipeMs !== null && curMs - lastWipeMs < PULL_DEBOUNCE_MS) {
      canStartPull = false;
    }

    // Pull detection (first action on boss, NOT already in encounter, NOT in debounce)
    if (!inEncounter && canStartPull && isBossAction(line, bossNames)) {
      inEncounter = true;
      encounterStart = i;
      encounterStartTs = getTimestamp(line);
      // Reset state
      partyAlive = new Map(partyCanonical.map(name => [name, true]));
      deathLog = [];
      reviveLog = [];
      debugLines.push(`[DEBUG] Encounter start: ${encounterInstance} / ${encounterBoss} at ${getTimestamp(line)} (line ${i})`);
      continue;
    }

    // Only track deaths/revives if in encounter!
    if (!inEncounter) continue;

    // Death event detection
    const death = matchDeath(line, partyArray);
    if (death) {
      const canon = stripServer(death.name);
      partyAlive.set(canon, false);
      deathLog.push({ name: canon, ts: death.ts });
      debugLines.push(`[DEBUG] Death: ${canon} at ${death.ts} (line ${i})`);
    }
    // Revive event detection
    const revive = matchRevive(line, partyArray);
    if (revive) {
      const canon = stripServer(revive.name);
      partyAlive.set(canon, true);
      reviveLog.push({ name: canon, ts: revive.ts });
      debugLines.push(`[DEBUG] Revive: ${canon} at ${revive.ts} (line ${i})`);
    }

    // Wipe detection: all unique party members dead
    if (Array.from(partyAlive.values()).every(v => !v)) {
      const wipeTime = getTimestamp(line);
      const encounterLines = lines.slice(encounterStart, i + 1);
      const bossHpEntries = extractBossHpFromLines(encounterLines, encounterBoss);
      const lowestBossHp = bossHpEntries.length
        ? bossHpEntries.reduce((min, entry) => Math.min(min, entry.hp), bossHpEntries[0].hp)
        : null;
      const maxHp = bossHpEntries.length ? bossHpEntries[0].maxHp : null;
      const lowestBossHpPct =
        lowestBossHp === 0
          ? 0
          : lowestBossHp !== null && maxHp
            ? Math.round((lowestBossHp / maxHp) * 1000) / 10 // e.g. 13.7
            : null;
      debugLines.push(
        `[DEBUG] Encounter end (wipe): all dead at ${wipeTime} (line ${i}), lowest boss HP: ${lowestBossHp} (${lowestBossHpPct === 0 ? "kill" : lowestBossHpPct !== null ? lowestBossHpPct + "%" : "no hp data"})`
      );
      encounters.push({
        startLine: encounterStart,
        endLine: i,
        startTimestamp: encounterStartTs,
        endTimestamp: wipeTime,
        boss: encounterBoss,
        instance: encounterInstance,
        type: "wipe",
        lowestBossHp,
        maxHp,
        lowestBossHpPct,
        bossHpEntries,
        debug: { log: [...debugLines] }
      });
      // Reset state for next pull
      inEncounter = false;
      partyAlive = new Map(partyCanonical.map(name => [name, true]));
      deathLog = [];
      reviveLog = [];
      lastWipeTime = wipeTime;
      lastWipeMs = Date.parse(wipeTime || "1970-01-01T00:00:00Z");
      continue;
    }

    // Boss kill detection: end encounter immediately
    if (isBossKill(line, bossNames)) {
      const killTime = getTimestamp(line);
      const encounterLines = lines.slice(encounterStart, i + 1);
      const bossHpEntries = extractBossHpFromLines(encounterLines, encounterBoss);
      const lowestBossHp = bossHpEntries.length
        ? bossHpEntries.reduce((min, entry) => Math.min(min, entry.hp), bossHpEntries[0].hp)
        : null;
      const maxHp = bossHpEntries.length ? bossHpEntries[0].maxHp : null;
      const lowestBossHpPct =
        lowestBossHp === 0
          ? 0
          : lowestBossHp !== null && maxHp
            ? Math.round((lowestBossHp / maxHp) * 1000) / 10
            : null;
      debugLines.push(
        `[DEBUG] Encounter end (kill): boss defeated at ${killTime} (line ${i}), lowest boss HP: ${lowestBossHp} (${lowestBossHpPct === 0 ? "kill" : lowestBossHpPct !== null ? lowestBossHpPct + "%" : "no hp data"})`
      );
      encounters.push({
        startLine: encounterStart,
        endLine: i,
        startTimestamp: encounterStartTs,
        endTimestamp: killTime,
        boss: encounterBoss,
        instance: encounterInstance,
        type: "kill",
        lowestBossHp,
        maxHp,
        lowestBossHpPct,
        bossHpEntries,
        debug: { log: [...debugLines] }
      });
      inEncounter = false;
      partyAlive = new Map(partyCanonical.map(name => [name, true]));
      deathLog = [];
      reviveLog = [];
      lastWipeTime = killTime;
      lastWipeMs = Date.parse(killTime || "1970-01-01T00:00:00Z");
      continue;
    }
  }
  return encounters;
}