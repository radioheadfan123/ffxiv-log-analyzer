import { createClient as createSbClient } from "@supabase/supabase-js";
import instanceBossLibrary from "./instanceBossLibrary.json" assert { type: "json" };
import { ActorClassifier } from "./actor-classifier-deno.ts";
import { loadAllJobs } from "./job-loader-deno.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SB_URL")!;
const SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const supa = createSbClient(SUPABASE_URL, SERVICE_ROLE);

type InvokeBody = { upload_id: string; path: string };

let _uploadId = "";

// Helper: Strip server name from player name by truncating at the third capital letter
function stripServer(name: string) {
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

async function note(s: string) {
  try {
    if (!_uploadId) return;
    console.log("[NOTE]", s);
    await supa.from("uploads").update({ error: s }).eq("id", _uploadId);
  } catch (err) {
    console.log("[NOTE ERROR]", err);
  }
}

function toMs(s?: string) {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d.getTime() : null;
}
function toIso(s?: string) {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString() : null;
}

// Parse party members from 03 lines (first 200 lines for safety, with debug and Unicode support)
function parsePartyMembers(lines: string[]) {
  const scanLines = lines.slice(0, 200); // scan more lines!
  const party = new Set<string>();
  for (const line of scanLines) {
    const p = line.split("|");
    if (p.length < 4) continue;
    if (p[0] === "03") {
      let name = stripServer(p[3]);
      // Unicode letter support in regex (\p{L}), needs /u flag
      const nameValid = !!(
        name &&
        /^[\p{L} '\-]+$/u.test(name) &&
        name.length >= 3 &&
        !name.toLowerCase().includes("carbuncle") &&
        !name.toLowerCase().includes("eos") &&
        !name.toLowerCase().includes("selene")
      );
      console.log(`[DEBUG] 03 line: |${p[3]}| parsed as: |${name}| regex valid: ${nameValid}`);
      if (nameValid) {
        party.add(name);
      }
    }
    if (party.size >= 8) break;
  }
  console.log("[DEBUG] Parsed party members:", Array.from(party));
  return Array.from(party);
}

// Inlined matchInstanceAndBoss
function matchInstanceAndBoss(lines: string[], instanceBossLibrary: any) {
  for (const line of lines) {
    for (const entry of instanceBossLibrary) {
      if (entry.instance && line.includes(entry.instance)) {
        let boss = entry.bosses ? entry.bosses.find((b: string) => line.includes(b)) : undefined;
        if (!boss && entry.bosses && entry.bosses.length === 1) {
          boss = entry.bosses[0];
        }
        if (boss) {
          return { instance: entry.instance, boss };
        }
      }
    }
  }
  for (const line of lines) {
    for (const entry of instanceBossLibrary) {
      if (entry.bosses) {
        const boss = entry.bosses.find((b: string) => line.includes(b));
        if (boss) return { instance: entry.instance ?? "Unknown Duty", boss };
      }
    }
  }
  return null;
}

function getBossNameAndInstance(lines: string[]) {
  try {
    const result = matchInstanceAndBoss(lines, instanceBossLibrary) || {};
    if (result.instance && result.boss) {
      console.log("[DEBUG] matchInstanceAndBoss found:", result);
      return { instance: result.instance, boss: result.boss };
    }
  } catch (err) {
    console.log("[DEBUG] matchInstanceAndBoss error:", err);
  }
  for (const line of lines) {
    const m = /defeats\s+(.+?)\./i.exec(line);
    if (m) {
      console.log("[DEBUG] Fallback boss found by defeat line:", m[1]);
      return { boss: m[1], instance: "Unknown Duty" };
    }
    const n = /hits\s+(.+?)\s+for\s+\d+\s+damage/i.exec(line);
    if (n) {
      console.log("[DEBUG] Fallback boss found by hit line:", n[1]);
      return { boss: n[1], instance: "Unknown Duty" };
    }
  }
  console.log("[DEBUG] No boss/instance found, using Unknowns");
  return { instance: "Unknown Duty", boss: "Unknown Boss" };
}

function splitEncountersByBossOrWipe(lines: string[], minLines = 8, minDurMs = 8000) {
  const partyArray = parsePartyMembers(lines);
  if (!partyArray.length) {
    console.log("[ERROR] No party members detected, cannot split encounters.");
    return [];
  }
  let bossInfo = getBossNameAndInstance(lines);
  let bossName = bossInfo.boss;
  let instanceName = bossInfo.instance;

  // Only recognize these actions as resurrections
  const raiseActions = [
    "Raise",
    "Resurrection",
    "Ascend",
    "Arise",
    "Undead Rising"
  ];

  // Set YOU as the first party member parsed
  const localPlayerName = partyArray[0];

  // --- Build a mapping from actor ID to name (from 03 lines) ---
  const idToName = new Map<string, string>();
  for (const line of lines.slice(0, 200)) {
    const p = line.split("|");
    if (p[0] === "03") {
      idToName.set(p[2], stripServer(p[3]));
    }
  }
  console.log("[DEBUG] idToName map:", Array.from(idToName.entries()));

  let encounters: { lines: string[]; start: string; end: string; boss: string; instance: string }[] = [];
  let current: string[] = [];
  let partyStatus = new Map<string, boolean>();
  for (const name of partyArray) partyStatus.set(name, true);

  let encounterStart: string | undefined = undefined;
  let inEncounter = false;
  let wipePendingSince: number | null = null;
  const WIPE_GRACE_MS = 3000;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const p = line.split("|");
    if (p.length < 2) continue;
    const ts = p[1];
    const tsMs = toMs(ts) || 0;

    // --- LOG: Print every candidate for encounter start ---
    if (
      !inEncounter &&
      (p[0] === "21" || p[0] === "22" || p[0] === "15" || p[0] === "16" || p[0] === "38" || p[0] === "26")
    ) {
      // Use the actor ID to look up the name
      const actorId = p[2];
      const actorName = idToName.get(actorId) ?? stripServer(actorId); // fallback: just in case
      const hasParty = partyStatus.has(actorName);
      console.log(`[DEBUG] Checking encounter start at line ${i}: type=${p[0]} actorId='${actorId}' actorName='${actorName}' party.has(actorName)? ${hasParty}`);
      if (hasParty) {
        inEncounter = true;
        encounterStart = ts;
        current = [];
        console.log(`[DEBUG] Encounter started at line ${i}, time ${ts}, actor ${actorName}, type ${p[0]}`);
      }
    }

    if (inEncounter) current.push(line);

    // --- DEATH PARSING: Robust for all "is defeated" lines (search both p[3] and p[4]) ---
let deathField = (p[3] && /defeated/i.test(p[3])) ? p[3] : ((p[4] && /defeated/i.test(p[4])) ? p[4] : null);
if (p[0] === "00" && deathField) {
  let name = "";
  if (/^you are defeated\b/i.test(deathField)) {
    name = partyArray[0];
    console.log(`[DEBUG] Mapping "You are defeated." to local player: ${name}`);
  } else {
    const match = /^(.+?) is defeated\b/i.exec(deathField);
    if (match) {
      name = stripServer(match[1].trim());
    }
  }
  if (partyStatus.has(name)) {
    partyStatus.set(name, false);
    console.log(`[DEBUG] Party member marked dead: ${name}`);
  }
}


    // --- REVIVE PARSING: Only by explicit raise/rez actions ---
if ((p[0] === "21" || p[0] === "22") && p[5] && raiseActions.includes(p[5])) {
  let name = p[7];
  if (/^you$/i.test(name)) {
    name = partyArray[0];
  } else {
    name = stripServer(name);
  }
  if (partyStatus.has(name)) {
    partyStatus.set(name, true);
    console.log(`[DEBUG] Party member revived by action: ${name} (${p[5]})`);
  }
}

    // Boss defeat
    if (inEncounter && p[0] === "00" && bossName && new RegExp(`defeats\\s+${bossName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "i").test(line)) {
      const startIso = toIso(encounterStart) ?? new Date().toISOString();
      const endIso = toIso(ts) ?? startIso;
      if (current.length >= minLines && toMs(endIso)! - toMs(startIso)! >= minDurMs) {
        encounters.push({
          lines: [...current],
          start: startIso,
          end: endIso,
          boss: bossName,
          instance: instanceName,
        });
        console.log(`[DEBUG] Encounter ended by boss defeat: ${bossName} (${instanceName}) from ${startIso} to ${endIso}`);
      }
      // Reset
      inEncounter = false;
      current = [];
      encounterStart = undefined;
      partyStatus = new Map();
      for (const name of partyArray) partyStatus.set(name, true);
      wipePendingSince = null;
      continue;
    }

    // Party wipe (all dead)
    if (inEncounter && Array.from(partyStatus.values()).every(alive => !alive)) {
      if (wipePendingSince === null) wipePendingSince = tsMs;
      // Check if all dead for at least grace period or next line is much later
      const nextLineTs = lines[i+1]?.split("|")[1];
      const nextLineMs = toMs(nextLineTs);
      const timeGap = nextLineMs ? nextLineMs - tsMs : 9999;
      if (tsMs - wipePendingSince >= WIPE_GRACE_MS || timeGap > WIPE_GRACE_MS) {
        const startIso = toIso(encounterStart) ?? new Date().toISOString();
        const endIso = toIso(ts) ?? startIso;
        if (current.length >= minLines && toMs(endIso)! - toMs(startIso)! >= minDurMs) {
          encounters.push({
            lines: [...current],
            start: startIso,
            end: endIso,
            boss: bossName,
            instance: instanceName,
          });
          console.log(`[DEBUG] Encounter ended by wipe: ${bossName} (${instanceName}) from ${startIso} to ${endIso}`);
        }
        // Reset
        inEncounter = false;
        current = [];
        encounterStart = undefined;
        partyStatus = new Map();
        for (const name of partyArray) partyStatus.set(name, true);
        wipePendingSince = null;
        continue;
      }
    } else {
      wipePendingSince = null;
    }

    // ACT: Split on system/zone lines
    if (
      p[0] === "01" && /You have entered|The instance will shut down|zone|reset/i.test(line)
    ) {
      if (inEncounter && current.length > 0 && encounterStart) {
        const lastTs = toIso(current[current.length - 1].split("|")[1]);
        if (
          current.length >= minLines &&
          toMs(lastTs)! - toMs(encounterStart)! >= minDurMs
        ) {
          encounters.push({
            lines: [...current],
            start: toIso(encounterStart)!,
            end: lastTs!,
            boss: bossName,
            instance: instanceName,
          });
          console.log(`[DEBUG] Encounter ended by system/zone event: ${bossName} (${instanceName}) from ${toIso(encounterStart)!} to ${lastTs!}`);
        }
      }
      // Reset
      inEncounter = false;
      current = [];
      encounterStart = undefined;
      partyStatus = new Map();
      for (const name of partyArray) partyStatus.set(name, true);
      wipePendingSince = null;
      continue;
    }
  }

  // trailing encounter (if log ends)
  if (inEncounter && current.length > 0 && encounterStart) {
    const lastTs = toIso(current[current.length - 1].split("|")[1]);
    if (
      current.length >= minLines &&
      toMs(lastTs)! - toMs(encounterStart)! >= minDurMs
    ) {
      encounters.push({
        lines: [...current],
        start: toIso(encounterStart)!,
        end: lastTs!,
        boss: bossName,
        instance: instanceName,
      });
      console.log(`[DEBUG] Trailing encounter: ${bossName} (${instanceName}) from ${toIso(encounterStart)!} to ${lastTs!}`);
    }
  }
  console.log(`[DEBUG] Total encounters found: ${encounters.length}`);
  return encounters;
}

// --- MAIN HANDLER ---
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const body: InvokeBody = await req.json();
    _uploadId = body.upload_id;
    await note("fetching log from storage (private bucket, using signed URL)");

    // Generate a signed URL valid for 60 seconds for the private "logs" bucket
    const { data: signed, error: signErr } = await supa
      .storage
      .from("logs")
      .createSignedUrl(body.path, 60);
    if (signErr || !signed?.signedUrl) {
      await note(`signed url error: ${signErr?.message || "unknown"}`);
      throw new Error(`Failed to get signed URL for log file: ${signErr?.message || "unknown"}`);
    }
    const fileUrl = signed.signedUrl;

    await note("fetching log via signed url");
    const resp = await fetch(fileUrl);
    if (!resp.ok) {
      await note(`fetch ${resp.status}`);
      throw new Error(`fetch log failed (${resp.status})`);
    }
    await note("reading text");
    const text = await resp.text();
    if (!text) {
      await note("empty file");
      throw new Error("file empty");
    }
    await note("splitting encounters by boss/wipe");
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      await note("Not enough lines in log file");
      throw new Error("Not enough lines in log file");
    }
    const fights = splitEncountersByBossOrWipe(lines, 8, 8000);
    await note(`encounters=${fights.length}`);

    const encounterIds: string[] = [];
    for (let fIdx = 0; fIdx < fights.length; fIdx++) {
      const fight = fights[fIdx];
      await note(`encounter ${fIdx + 1}/${fights.length}: create header`);
      const { data: enc, error: encErr } = await supa
        .from("encounters")
        .insert({
          upload_id: body.upload_id,
          duty: fight.instance,
          boss: { name: fight.boss },
          start_ts: fight.start,
          end_ts: fight.end,
          details_parsed: false,
          raw_log_path: body.path
        })
        .select("id")
        .single();
      if (encErr) {
        await note(`encounter insert err: ${encErr.message || encErr}`);
        console.log("[ERROR] DB insert:", encErr);
        throw encErr;
      }
      encounterIds.push(enc.id as string);
      await note(`encounter ${fIdx + 1}: header created`);
    }

    await note(`parsed ${fights.length} encounter headers`);
    await supa.from("uploads").update({ status: "complete" }).eq("id", _uploadId);

    return new Response(JSON.stringify({ encounters: encounterIds }), { headers: corsHeaders });
  } catch (err) {
    await note(`[error] ${err?.stack || err}`);
    console.log("[FATAL ERROR]", err?.stack || err);
    return new Response(JSON.stringify({ error: `${err}` }), { status: 500, headers: corsHeaders });
  }
});