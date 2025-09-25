// supabase/functions/parse-log/index.ts
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

type InvokeBody = { upload_id: string; path: string };

const RE_HIT   = /^(.*?)\s+hits\s+(.+?)\s+for\s+(\d+)\s+damage\.?$/i;
const RE_TAKES = /^(?:critical!\s*|direct hit!\s*)?(.+?)\s+takes\s+(\d+)\s+damage\.?$/i;

const toMs  = (s?: string) => { const d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? d.getTime() : null; };
const toIso = (s?: string) => { const d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

// --- Breadcrumb helper (writes to uploads.error) ---
let _uploadId = "";
async function note(s: string) {
  try {
    if (!_uploadId) return;
    await supa.from("uploads").update({ error: s }).eq("id", _uploadId);
  } catch {
    // swallow: breadcrumbs must never crash the function
  }
}

// Split fights by idle time between damage logs. If none found, fallback to whole file.
function splitByDamageIdle(lines: string[], idleMs = 8000) {
  const idxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i].split("|");
    if (p.length < 2) continue;
    const code = p[0];
    if (code === "00") {
      const msg = (p[4] ?? p[3] ?? p[2] ?? "").trim();
      if (/hits\s+.+?\s+for\s+\d+\s+damage/i.test(msg) || /takes\s+\d+\s+damage/i.test(msg)) idxs.push(i);
    } else if (code === "21" || code === "22") {
      idxs.push(i);
    }
  }

  if (idxs.length === 0) {
    if (!lines.length) return [] as { lines: string[]; start: string; end: string }[];
    const firstTs = toIso(lines[0].split("|")[1]);
    const lastTs  = toIso(lines.at(-1)!.split("|")[1]) ?? firstTs ?? new Date().toISOString();
    return [{ lines: [...lines], start: firstTs ?? new Date().toISOString(), end: lastTs }];
  }

  const tsOf = (i: number) => toMs(lines[i].split("|")[1] || "") ?? 0;
  const cuts = [0];
  for (let k = 1; k < idxs.length; k++) if (tsOf(idxs[k]) - tsOf(idxs[k - 1]) > idleMs) cuts.push(k);
  cuts.push(idxs.length);

  const fights: { lines: string[]; start: string; end: string }[] = [];
  for (let c = 0; c < cuts.length - 1; c++) {
    const a = idxs[cuts[c]], b = idxs[cuts[c + 1] - 1];
    const slice = lines.slice(a, b + 1);
    const startIso = toIso(slice[0].split("|")[1]) ?? new Date().toISOString();
    const endIso   = toIso(slice.at(-1)!.split("|")[1]) ?? startIso;
    fights.push({ lines: slice, start: startIso, end: endIso });
  }
  return fights;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Parse body first (for breadcrumbs)
    let body: InvokeBody | null = null;
    try { body = await req.json(); } catch { body = null; }

    const upload_id = body?.upload_id;
    const path = body?.path;
    _uploadId = upload_id || "";

    if (!upload_id || !path) {
      await note("bad body (missing upload_id or path)");
      return new Response(JSON.stringify({ error: "Missing upload_id or path" }), { status: 400, headers: corsHeaders });
    }

    await supa.from("uploads").update({ status: "parsing", error: "start" }).eq("id", upload_id);

    await note("signing url");
    const { data: sign, error: signErr } = await supa.storage.from("logs").createSignedUrl(path, 600);
    if (signErr) { await note("signed url err"); throw signErr; }

    await note("fetching file");
    const resp = await fetch(sign!.signedUrl);
    if (!resp.ok) { await note(`fetch ${resp.status}`); throw new Error(`fetch log failed (${resp.status})`); }

    await note("reading text");
    const text = await resp.text();
    if (!text) { await note("empty file"); throw new Error("file empty"); }

    await note("splitting fights");
    const lines  = text.split(/\r?\n/).filter(Boolean);
    const fights = splitByDamageIdle(lines, 8000);
    await note(`fights=${fights.length}`);

    let totalEvents = 0, totalActors = 0, totalEncounters = 0;
    const encounterIds: string[] = []; // <- will return to client

    for (let fIdx = 0; fIdx < fights.length; fIdx++) {
      const fight = fights[fIdx];
      await note(`encounter ${fIdx + 1}/${fights.length}: create`);

      // 1) create encounter
      const { data: enc, error: encErr } = await supa
        .from("encounters")
        .insert({ upload_id, duty: "Unknown Duty", start_ts: fight.start, end_ts: fight.end })
        .select("id")
        .single();
      if (encErr) { await note(`encounter insert err`); throw encErr; }
      const encounter_id = enc.id as string;
      totalEncounters++;

      // 2) parse chat damage and collect actor statistics
      const actorStats = new Map<string, ActorInfo>();
      type Ev = {
        tmpName: string; encounter_id: string; ts: string; actor_id: string | null;
        type: string; skill: string; amount: number; crit: boolean; direct_hit: boolean;
      };
      const events: Ev[] = [];

      // Initialize actor classifier
      const classifier = new ActorClassifier();

      for (const line of fight.lines) {
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

      // 3) classify actors using comprehensive heuristics
      const classification = classifier.classifyActors(actorStats);
      
      // Prepare JSONB data for encounter
      const bossData = classification.boss ? ActorClassifier.toJsonObject(classification.boss) : null;
      const addsData = classification.adds.map(add => ActorClassifier.toJsonObject(add));
      const partyData = classification.partyMembers.map(member => ActorClassifier.toJsonObject(member));

      // Determine duty name (could be enhanced with duty detection logic)
      const dutyName = "Unknown Duty";

      // Update encounter with structured data
      const encounterUpdateData: Record<string, unknown> = {
        duty: dutyName,
        boss: bossData,
        adds: addsData,
        party_members: partyData
      };

      await supa.from("encounters").update(encounterUpdateData).eq("id", encounter_id);

      // 4) ensure actors with enhanced job detection
      const allActorNames = Array.from(actorStats.keys());
      const idByName = new Map<string, string>();

      if (allActorNames.length) {
        await note(`encounter ${fIdx + 1}: actors select/insert`);
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

      totalActors += idByName.size;

      // 5) insert events
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
  // nothing useful in this slice → clean up and skip
  await supa.from('actors').delete().eq('encounter_id', encounter_id);
  await supa.from('encounters').delete().eq('id', encounter_id);
  await note(`encounter ${fIdx + 1}: skipped (no mapped events)`);
  continue; // 🚪 go to next fight
}

// insert events in chunks
const CHUNK = 5000;
for (let i = 0; i < ready.length; i += CHUNK) {
  const chunk = ready.slice(i, i + CHUNK);
  const { error } = await supa.from('events').insert(chunk);
  if (error) { await note(`events insert err`); throw error; }
}
totalEvents += ready.length;

      // 6) metrics
      await note(`encounter ${fIdx + 1}: metrics`);
      const startMs = toMs(fight.start) ?? Date.now();
      const endMs   = toMs(fight.end) ?? startMs;
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
      encounterIds.push(encounter_id);
    }

    const finalNote = `parsed fights=${fights.length} encounters=${totalEncounters} actors≈${totalActors} events=${totalEvents}`;
    await note(finalNote);
    await supa.from("uploads").update({ status: "complete" }).eq("id", _uploadId);

    // Return encounter IDs so the client can navigate immediately
    return new Response(
      JSON.stringify({ ok: true, note: finalNote, encounter_ids: encounterIds }),
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

