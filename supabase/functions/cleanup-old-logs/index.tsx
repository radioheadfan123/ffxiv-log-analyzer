import { createClient } from "@supabase/supabase-js";

const RETENTION_DAYS = 7;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STORAGE_BUCKET = "logs";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (_req) => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: uploads, error: uploadErr } = await supabase
    .from("uploads")
    .select("id, path")
    .lt("created_at", cutoff)
    .limit(1000);

  if (uploadErr) {
    return new Response(JSON.stringify({ error: "DB fetch error" }), { status: 500 });
  }
  if (!uploads || uploads.length === 0) {
    return new Response(JSON.stringify({ message: "No old uploads to clean." }));
  }

  let deletedCount = 0;
  for (const upload of uploads) {
    await supabase.from("encounters").delete().eq("upload_id", upload.id);
    if (upload.path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([upload.path]);
    }
    await supabase.from("uploads").delete().eq("id", upload.id);
    deletedCount++;
  }

  return new Response(
    JSON.stringify({ message: "Cleanup complete", deleted_uploads: deletedCount }),
    { headers: { "Content-Type": "application/json" } }
  );
});