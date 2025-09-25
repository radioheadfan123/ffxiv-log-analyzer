// supabase/functions/parse-encounter/index.ts
// Stage 2 parsing: Load specific encounter from log and parse detailed events/actors/metrics
import { createClient as createSbClient } from "@supabase/supabase-js";
import { ActorClassifier, ActorInfo } from './actor-classifier-deno.ts';
import { loadAllJobs } from './job-loader-deno.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SB_URL")!;
const SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const supa = createSbClient(SUPABASE_URL, SERVICE_ROLE);

// Eagerly load all job data at startup
const allJobs = loadAllJobs();
console.log(`Loaded ${allJobs.length} job definitions for actor classification`);

type InvokeBody = { encounter_id: string };

const RE_HIT   = /^(.*?)\s+hits\s+(.+?)\s+for\s+(\d+)\s+damage\.?$/i;
const RE_TAKES = /^(?:critical!\s*|direct hit!\s*)?(.+?)\s+takes\s+(\d+)\s+damage\.?$/i;

const toMs  = (s?: string) => { const d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? d.getTime() : null; };
const toIso = (s?: string) => { const d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

// --- Breadcrumb helper (writes to encounters.error) ---
let _encounterId = "";
async function note(s: string) {
  try {
    if (!_encounterId) return;
    // We could add an error field to encounters table for detailed parsing status
    console.log(`[${_encounterId}] ${s}`);
  } catch {
    // swallow: breadcrumbs must never crash the function
  }
}

// Extract lines for specific encounter from full log
function extractEncounterLines(allLines: string[], startTs: string, endTs: string): string[] {
  const startMs = toMs(startTs);
  const endMs = toMs(endTs);
  if (!startMs || !endMs) return [];

  const encounterLines: string[] = [];
  
  for (const line of allLines) {
    const parts = line.split("|");
    if (parts.length < 2) continue;
    
    const lineTs = toMs(parts[1]);
    if (!lineTs) continue;
    
    // Include lines within the encounter timeframe (with small buffer)
    if (lineTs >= startMs - 5000 && lineTs <= endMs + 5000) {
      encounterLines.push(line);
    }
  }
  
  return encounterLines;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Parse body
    let body: InvokeBody | null = null;
    try { body = await req.json(); } catch { body = null; }

    const encounter_id = body?.encounter_id;
    _encounterId = encounter_id || "";

    if (!encounter_id) {
      await note("bad body (missing encounter_id)");
      return new Response(JSON.stringify({ error: "Missing encounter_id" }), { status: 400, headers: corsHeaders });
    }

    await note("fetching encounter info");
    
    // Get encounter details and check if already parsed
    const { data: encounter, error: encErr } = await supa
      .from("encounters")
      .select("id, upload_id, start_ts, end_ts, details_parsed, raw_log_path")
      .eq("id", encounter_id)
      .single();
      
    if (encErr || !encounter) {
      await note(`encounter not found: ${encErr?.message}`);
      return new Response(JSON.stringify({ error: "Encounter not found" }), { status: 404, headers: corsHeaders });
    }

    if (encounter.details_parsed) {
      await note("encounter already parsed");
      return new Response(JSON.stringify({ ok: true, note: "Encounter already parsed" }), { status: 200, headers: corsHeaders });
    }

    if (!encounter.raw_log_path) {
      await note("no raw log path available");
      return new Response(JSON.stringify({ error: "No raw log path available for this encounter" }), { status: 400, headers: corsHeaders });
    }

    await note("signing url for log file");
    const { data: sign, error: signErr } = await supa.storage.from("logs").createSignedUrl(encounter.raw_log_path, 600);
    if (signErr) { await note("signed url err"); throw signErr; }

    await note("fetching log file for encounter");
    const resp = await fetch(sign!.signedUrl);
    if (!resp.ok) { await note(`fetch ${resp.status}`); throw new Error(`fetch log failed (${resp.status})`); }

    await note("reading log text");
    const text = await resp.text();
    if (!text) { await note("empty file"); throw new Error("file empty"); }

    await note("extracting encounter lines");
    const allLines = text.split(/\r?\n/).filter(Boolean);
    const encounterLines = extractEncounterLines(allLines, encounter.start_ts, encounter.end_ts);
    await note(`extracted ${encounterLines.length} lines for encounter`);

    if (encounterLines.length === 0) {
      await note("no lines found for encounter timeframe");
      return new Response(JSON.stringify({ error: "No log data found for encounter timeframe" }), { status: 400, headers: corsHeaders });
    }

    // Now process this encounter's lines (same logic as original parse-log but for single encounter)
    await note("parsing encounter events");
    
    // Parse chat damage and collect actor statistics
    const actorStats = new Map<string, ActorInfo>();
    type Ev = {
      tmpName: string; encounter_id: string; ts: string; actor_id: string | null;
      type: string; skill: string; amount: number; crit: boolean; direct_hit: boolean;
    };
    const events: Ev[] = [];

    // Initialize actor classifier
    const classifier = new ActorClassifier();

    for (const line of encounterLines) {
      const p = line.split("|");
      if (p[0] !== "00") continue;

      const tsIso = toIso(p[1]) ?? new Date().toISOString();
      const rawMsg = (p[4] ?? p[3] ?? p[2] ?? "").trim().replace(/^[^\w]*\s*/, "");

      const mHit   = rawMsg.match(RE_HIT);
      const mTakes = rawMsg.match(RE_TAKES);
      if (!mHit && !mTakes) continue;

      let attacker = "";
      let target = "";
      let amount = 0;
      const isCrit = /critical/i.test(rawMsg);
      const isDH   = /direct hit/i.test(rawMsg);

      if (mHit) {
        attacker = mHit[1].trim();
        target = mHit[2].trim();
        amount = Number(mHit[3] || 0);
      } else {
        attacker = "Unknown";
        target = mTakes![1].trim();
        amount = Number(mTakes![2] || 0);
      }

      if (!attacker || !target || !Number.isFinite(amount) || amount <= 0) continue;

      // Update attacker stats
      if (!actorStats.has(attacker)) {
        actorStats.set(attacker, {
          name: attacker,
          totalDamageDealt: 0,
          totalDamageTaken: 0,
          hitCount: 0,
          skillsUsed: new Set<string>()
        });
      }
      const attackerStat = actorStats.get(attacker)!;
      attackerStat.totalDamageDealt += amount;
      attackerStat.skillsUsed.add("chat"); // Basic skill tracking from chat

      // Update target stats
      if (!actorStats.has(target)) {
        actorStats.set(target, {
          name: target,
          totalDamageDealt: 0,
          totalDamageTaken: 0,
          hitCount: 0,
          skillsUsed: new Set<string>()
        });
      }
      const targetStat = actorStats.get(target)!;
      targetStat.totalDamageTaken += amount;
      targetStat.hitCount += 1;

      events.push({
        tmpName: attacker,
        encounter_id,
        ts: tsIso,
        actor_id: null,
        type: "dmg",
        skill: "chat",
        amount,
        crit: isCrit,
        direct_hit: isDH,
      });
    }

    await note("classifying actors");
    // Classify actors using comprehensive heuristics
    const classification = classifier.classifyActors(actorStats);
    
    // Prepare JSONB data for encounter
    const bossData = classification.boss ? ActorClassifier.toJsonObject(classification.boss) : null;
    const addsData = classification.adds.map(add => ActorClassifier.toJsonObject(add));
    const partyData = classification.partyMembers.map(member => ActorClassifier.toJsonObject(member));

    // Update encounter with structured data
    const encounterUpdateData: Record<string, unknown> = {
      boss: bossData,
      adds: addsData,
      party_members: partyData
    };

    await supa.from("encounters").update(encounterUpdateData).eq("id", encounter_id);

    await note("inserting/updating actors");
    // Ensure actors with enhanced job detection
    const allActorNames = Array.from(actorStats.keys());
    const idByName = new Map<string, string>();

    if (allActorNames.length) {
      const { data: existing, error: exErr } = await supa
        .from("actors")
        .select("id,name")
        .eq("encounter_id", encounter_id)
        .in("name", allActorNames);
      if (exErr) { await note(`actors select err`); throw exErr; }
      if (existing) for (const a of existing) idByName.set(a.name, a.id);

      const missing = allActorNames.filter((n) => !idByName.has(n)).map((name) => {
        const actorInfo = actorStats.get(name);
        return {
          encounter_id, 
          name, 
          job: actorInfo?.job || "UNK", 
          role: actorInfo?.role || "dps",
        };
      });
      
      if (missing.length) {
        const { data: inserted, error: insErr } = await supa
          .from("actors")
          .insert(missing)
          .select("id,name");
        if (insErr) { await note(`actors insert err`); throw insErr; }
        if (inserted) for (const a of inserted) idByName.set(a.name, a.id);
      }
    }

    await note("inserting events");
    // Insert events
    const ready = events
      .map(ev => ({
        encounter_id: ev.encounter_id,
        ts: ev.ts,
        actor_id: idByName.get(ev.tmpName) || null,
        type: ev.type,
        skill: ev.skill,
        amount: ev.amount,
        crit: ev.crit,
        direct_hit: ev.direct_hit,
      }))
      .filter(e => !!e.actor_id);

    if (ready.length === 0) {
      await note("no valid events found");
      return new Response(JSON.stringify({ error: "No valid events found for this encounter" }), { status: 400, headers: corsHeaders });
    }

    // Insert events in chunks
    const CHUNK = 5000;
    for (let i = 0; i < ready.length; i += CHUNK) {
      const chunk = ready.slice(i, i + CHUNK);
      const { error } = await supa.from('events').insert(chunk);
      if (error) { await note(`events insert err`); throw error; }
    }

    await note("calculating metrics");
    // Calculate and insert metrics
    const startMs = toMs(encounter.start_ts) ?? Date.now();
    const endMs   = toMs(encounter.end_ts) ?? startMs;
    const durSec  = Math.max(1, Math.round((endMs - startMs) / 1000));

    const { data: sums, error: sumsErr } = await supa
      .from("events")
      .select("actor_id, amount")
      .eq("encounter_id", encounter_id)
      .eq("type", "dmg");
    if (sumsErr) { await note(`metrics select err`); throw sumsErr; }

    const totals = new Map<string, number>();
    for (const r of sums || []) {
      if (!r.actor_id) continue;
      totals.set(r.actor_id, (totals.get(r.actor_id) || 0) + (r.amount || 0));
    }

    const metricsRows = Array.from(totals, ([actor_id, total]) => ({
      encounter_id, actor_id, dps: total / durSec, hps: 0, deaths: 0, uptime: 0,
    }));
    
    if (metricsRows.length) {
      const { error: upErr } = await supa.from("metrics").upsert(metricsRows);
      if (upErr) { await note(`metrics upsert err`); throw upErr; }
    }

    await note("marking encounter as parsed");
    // Mark encounter as fully parsed
    await supa.from("encounters").update({ details_parsed: true }).eq("id", encounter_id);

    const finalNote = `parsed encounter ${encounter_id}: actors=${allActorNames.length} events=${ready.length} metrics=${metricsRows.length}`;
    await note(finalNote);

    return new Response(
      JSON.stringify({ ok: true, note: finalNote }),
      { status: 200, headers: corsHeaders },
    );

  } catch (e: unknown) {
    await note(`ERR: ${String((e as Error)?.message || e)}`);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});