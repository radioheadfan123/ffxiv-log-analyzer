// supabase/functions/parse-log/index.ts
// Stage 1 parsing: Extract encounter boundaries and basic info only (no detailed events/actors)
import { createClient as createSbClient } from "@supabase/supabase-js";

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

// Basic duty name detection patterns (can be enhanced)
const DUTY_PATTERNS = [
  { pattern: /The Navel/i, name: "The Navel (Extreme)" },
  { pattern: /Titan/i, name: "The Navel (Extreme)" },
  // Add more patterns as needed
];

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

// Simple duty name detection based on log content
function detectDutyName(lines: string[]): string {
  const sampleText = lines.slice(0, 100).join(" ").toLowerCase();
  
  for (const { pattern, name } of DUTY_PATTERNS) {
    if (pattern.test(sampleText)) {
      return name;
    }
  }
  
  return "Unknown Duty";
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

    let totalEncounters = 0;
    const encounterIds: string[] = []; // <- will return to client

    for (let fIdx = 0; fIdx < fights.length; fIdx++) {
      const fight = fights[fIdx];
      await note(`encounter ${fIdx + 1}/${fights.length}: create header`);

      // Detect duty name from fight content
      const dutyName = detectDutyName(fight.lines);

      // Create encounter header only (no detailed parsing)
      const { data: enc, error: encErr } = await supa
        .from("encounters")
        .insert({ 
          upload_id, 
          duty: dutyName, 
          start_ts: fight.start, 
          end_ts: fight.end,
          details_parsed: false,  // Mark as needing detailed parsing
          raw_log_path: path      // Store path for later detailed parsing
        })
        .select("id")
        .single();
      if (encErr) { await note(`encounter insert err`); throw encErr; }
      const encounter_id = enc.id as string;
      totalEncounters++;
      encounterIds.push(encounter_id);
      
      await note(`encounter ${fIdx + 1}: header created (${dutyName})`);
    }

    const finalNote = `parsed ${fights.length} encounter headers (detailed parsing available on-demand)`;
    await note(finalNote);
    await supa.from("uploads").update({ status: "complete" }).eq("id", _uploadId);

    // Return encounter IDs so the client can navigate immediately
    return new Response(
      JSON.stringify({ ok: true, note: finalNote, encounter_ids: encounterIds }),
      { status: 200, headers: corsHeaders },
    );

  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
    await note(`ERR: ${errorMessage}`);
    return new Response(JSON.stringify({ error: 'Failed to parse log file' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

