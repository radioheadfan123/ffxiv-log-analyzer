import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SB_URL")!;
const SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

type InvokeBody = { upload_id: string; path: string };

function jobToRole(job?: string) {
  const t = (job || "").toUpperCase();
  if (["PLD", "WAR", "DRK", "GNB"].includes(t)) return "tank";
  if (["WHM", "SCH", "AST", "SGE"].includes(t)) return "healer";
  return "dps";
}

function parseTimestamp(raw: string) {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { upload_id, path } = (await req.json()) as InvokeBody;
    if (!upload_id || !path) {
      return new Response(JSON.stringify({ error: "Missing upload_id or path" }), { status: 400, headers: corsHeaders });
    }

    await supa.from("uploads").update({ status: "parsing", error: null }).eq("id", upload_id);

    const { data: sign, error: signErr } = await supa.storage.from("logs").createSignedUrl(path, 600);
    if (signErr) throw signErr;

    const fileResp = await fetch(sign!.signedUrl);
    if (!fileResp.ok) throw new Error(`fetch log failed (${fileResp.status})`);
    const text = await fileResp.text();

    const lines = text.split(/\r?\n/).filter(Boolean);

    // Split into fights by 30s+ inactivity
    const fights: string[][] = [];
    let current: string[] = [];
    let lastTs: Date | null = null;

    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length < 2) continue;
      const ts = parseTimestamp(parts[1]);
      if (!ts) continue;

      if (lastTs && ts.getTime() - lastTs.getTime() > 30000 && current.length > 0) {
        fights.push(current);
        current = [];
      }
      current.push(line);
      lastTs = ts;
    }
    if (current.length > 0) fights.push(current);

    const encounterIds: string[] = [];

    for (const fight of fights) {
      const { data: enc, error: encErr } = await supa
        .from("encounters")
        .insert({
          upload_id,
          duty: "Unknown Duty",
          boss: "Unknown",
          start_ts: new Date(),
          end_ts: new Date(),
        })
        .select("id")
        .single();
      if (encErr) throw encErr;

      const actorMap = new Map<string, string>();
      const batch: any[] = [];

      for (const line of fight) {
        const parts = line.split("|");
        if (parts[0] !== "21" && parts[0] !== "22") continue;

        const ts = parseTimestamp(parts[1]);
        const name = parts[3] || "Unknown";
        const skill = parts[9] || "Unknown";
        const amount = /^\d+$/.test(parts[10] || "") ? parts[10] : "0";

        if (!actorMap.has(name)) {
          const { data: a } = await supa.from("actors")
            .insert({ encounter_id: enc.id, name, job: "UNK", role: jobToRole("UNK") })
            .select("id").single();
          actorMap.set(name, a!.id);
        }

        batch.push({
          encounter_id: enc.id,
          ts: ts ? ts.toISOString() : new Date().toISOString(),
          actor_id: actorMap.get(name),
          type: "dmg",
          skill,
          amount: Number(amount),
          crit: false,
          direct_hit: false,
        });
      }

      if (batch.length) {
        for (let i = 0; i < batch.length; i += 1000) {
          const chunk = batch.slice(i, i + 1000);
          await supa.from("events").insert(chunk);
        }
      }

      // Simple DPS metric
      for (const [, actor_id] of actorMap) {
        const { data: sums } = await supa.from("events")
          .select("amount").eq("encounter_id", enc.id).eq("actor_id", actor_id).eq("type", "dmg");
        const total = (sums || []).reduce((s, e: any) => s + (e.amount || 0), 0);
        await supa.from("metrics").upsert({
          encounter_id: enc.id,
          actor_id,
          dps: total / Math.max(fight.length, 1),
          hps: 0,
          deaths: 0,
          uptime: 0,
        });
      }

      encounterIds.push(enc.id);
    }

    await supa.from("uploads").update({ status: "complete" }).eq("id", upload_id);

    return new Response(JSON.stringify({ ok: true, encounters: encounterIds }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: corsHeaders });
  }
});
