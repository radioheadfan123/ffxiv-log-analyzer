import { createClient as createSbClient } from "@supabase/supabase-js";
import instanceBossLibrary from "./instanceBossLibrary.json" assert { type: "json" };
import { scanLogForEncounters } from "./encounter-indexer.ts";

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

const DEBUG_BUCKET = "debug-logs";

// Extra debug logging function (prints, updates DB, and pushes to debugLines)
async function note(s: string, debugLines?: string[]) {
  try {
    if (debugLines) debugLines.push(`[NOTE] ${s}`);
    if (!_uploadId) {
      console.log("[NOTE]", s);
      return;
    }
    console.log("[NOTE]", s);
    await supa.from("uploads").update({ error: s }).eq("id", _uploadId);
  } catch (err) {
    console.log("[NOTE ERROR]", err);
    if (debugLines) debugLines.push(`[NOTE ERROR] ${err}`);
  }
}

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

function parsePartyMembers(lines: string[]) {
  const scanLines = lines.slice(0, 200);
  const party = new Set<string>();
  for (const line of scanLines) {
    const p = line.split("|");
    if (p.length < 4) continue;
    if (p[0] === "03") {
      let name = stripServer(p[3]);
      const nameValid = !!(
        name &&
        /^[\p{L} '\-]+$/u.test(name) &&
        name.length >= 3 &&
        !name.toLowerCase().includes("carbuncle") &&
        !name.toLowerCase().includes("eos") &&
        !name.toLowerCase().includes("selene")
      );
      if (nameValid) {
        party.add(name);
      }
    }
    if (party.size >= 8) break;
  }
  return Array.from(party);
}

function guessBossNames(lines: string[]): string[] {
  const found: Set<string> = new Set();
  for (const entry of instanceBossLibrary) {
    for (const boss of entry.bosses || []) {
      for (const line of lines) {
        if (line.toLowerCase().includes(boss.toLowerCase())) {
          found.add(boss);
        }
      }
    }
  }
  if (found.size > 0) return Array.from(found);
  for (const line of lines) {
    const m = /defeats\s+(.+?)\./i.exec(line);
    if (m) found.add(m[1]);
    const n = /(.+?) is defeated\./i.exec(line);
    if (n) found.add(n[1]);
  }
  return Array.from(found).length > 0 ? Array.from(found) : ["Unknown Boss"];
}

Deno.serve(async (req) => {
  const debugLines: string[] = [];
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    await note("Received request", debugLines);
    const body: InvokeBody = await req.json();
    _uploadId = body.upload_id;
    await note(`Parsed body: ${JSON.stringify(body)}`, debugLines);

    await note("Requesting signed URL for log fetch", debugLines);
    const { data: signed, error: signErr } = await supa
      .storage
      .from("logs")
      .createSignedUrl(body.path, 60);
    if (signErr || !signed?.signedUrl) {
      await note(`signed url error: ${signErr?.message || "unknown"}`, debugLines);
      throw new Error(`Failed to get signed URL for log file: ${signErr?.message || "unknown"}`);
    }
    const fileUrl = signed.signedUrl;
    await note(`Got signed URL: ${fileUrl}`, debugLines);

    await note("Fetching log via signed URL", debugLines);
    const resp = await fetch(fileUrl);
    if (!resp.ok) {
      await note(`fetch failed with status ${resp.status}`, debugLines);
      throw new Error(`fetch log failed (${resp.status})`);
    }
    await note("Reading text from fetched log", debugLines);
    const text = await resp.text();
    if (!text) {
      await note("empty file", debugLines);
      throw new Error("file empty");
    }

    const lines = text.split(/\r?\n/).filter(Boolean);
    await note(`Parsed log lines: ${lines.length} lines`, debugLines);

    if (lines.length < 2) {
      await note("Not enough lines in log file", debugLines);
      throw new Error("Not enough lines in log file");
    }
    const partyArray = parsePartyMembers(lines);
    await note(`Parsed party: ${JSON.stringify(partyArray)}`, debugLines);
    if (!partyArray.length) {
      await note("No party members detected.", debugLines);
      throw new Error("No party members detected.");
    }
    const bossNames = guessBossNames(lines);
    await note(`Guessed bosses: ${JSON.stringify(bossNames)}`, debugLines);

    await note("Scanning for encounters", debugLines);
    const encounters = scanLogForEncounters(lines, bossNames, partyArray, debugLines);
    await note(`Found encounters: ${encounters.length}`, debugLines);

    const encounterIds: string[] = [];
    for (let fIdx = 0; fIdx < encounters.length; fIdx++) {
      const enc = encounters[fIdx];
      await note(`Creating encounter header ${fIdx + 1}/${encounters.length}`, debugLines);
      const { data: inserted, error: encErr } = await supa
        .from("encounters")
        .insert({
          upload_id: body.upload_id,
          duty: enc.instance,
          boss: { name: enc.boss },
          start_ts: enc.startTimestamp,
          end_ts: enc.endTimestamp,
          details_parsed: false,
          raw_log_path: body.path
        })
        .select("id")
        .single();
      if (encErr) {
        await note(`encounter insert err: ${encErr.message || encErr}`, debugLines);
        console.log("[ERROR] DB insert:", encErr);
        throw encErr;
      }
      encounterIds.push(inserted.id as string);
      await note(`Created encounter header with id: ${inserted.id}`, debugLines);
    }

    await note(`Parsed ${encounters.length} encounter headers`, debugLines);
    await supa.from("uploads").update({ status: "complete" }).eq("id", _uploadId);

    // Upload the full debug log to Supabase Storage
    const debugBlob = new Blob([debugLines.join("\n")], { type: "text/plain" });
    const debugFilePath = `parse-log-debug-${_uploadId}.txt`;
    const { error: uploadErr } = await supa.storage
      .from(DEBUG_BUCKET)
      .upload(debugFilePath, debugBlob, { upsert: true });

    if (uploadErr) {
      await note("Failed to upload debug log: " + uploadErr.message, debugLines);
    } else {
      await note("Uploaded debug log: " + debugFilePath, debugLines);
    }

    await note("Returning successful response", debugLines);
    return new Response(JSON.stringify({ encounters: encounterIds, debugLog: debugFilePath }), { headers: corsHeaders });
  } catch (err) {
    await note(`[error] ${err?.stack || err}`, debugLines);
    console.log("[FATAL ERROR]", err?.stack || err);

    // Attempt to upload debug log even if an error occurs
    try {
      const debugBlob = new Blob([debugLines.join("\n")], { type: "text/plain" });
      const debugFilePath = `parse-log-debug-${_uploadId || "unknown"}.txt`;
      await supa.storage
        .from(DEBUG_BUCKET)
        .upload(debugFilePath, debugBlob, { upsert: true });
    } catch (e) {
      // ignore
    }

    return new Response(JSON.stringify({ error: `${err}` }), { status: 500, headers: corsHeaders });
  }
});