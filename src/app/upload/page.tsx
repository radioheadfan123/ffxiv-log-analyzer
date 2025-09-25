'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ensureUser } from '@/lib/auth';

type Encounter = {
  id: string;
  boss: string | null;
  duty: string | null;
  start_ts: string | null;
  end_ts: string | null;
  // New JSONB fields
  boss_data?: { name: string; job?: string; role?: string } | null;
  party_members?: Array<{ name: string; job?: string; role?: string }> | null;
};

export default function UploadPage() {
  const [msg, setMsg] = useState<string>('');
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMsg('');
    setEncounters([]);
    setLoading(true);

    try {
      // 1) Make sure we have a session
      const user = await ensureUser();
      if (!user) {
        setMsg('Authentication failed.');
        setLoading(false);
        return;
      }

      // 2) Create a signed upload URL and upload the file
      const path = `${user.id}/${Date.now()}_${file.name}`;

      const { data: signed, error: signErr } = await supabase
        .storage.from('logs')
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message ?? 'unknown'}`);

      const { error: upErr } = await supabase
        .storage.from('logs')
        .uploadToSignedUrl(path, signed.token, file);
      if (upErr) throw new Error(`Upload error: ${upErr.message}`);

      // 3) Insert upload record
      const { data: ins, error: insErr } = await supabase
        .from('uploads')
        .insert({ user_id: user.id, path, status: 'uploaded' })
        .select('id')
        .single();
      if (insErr || !ins) throw new Error(`DB insert error: ${insErr?.message ?? 'unknown'}`);

      setMsg('Uploaded ✓ Parsing…');

      // 4) Invoke the parser
      const fn = await supabase.functions.invoke('parse-log', {
        body: { upload_id: ins.id, path },
      });

      if (fn.error) {
        throw new Error(`Edge error: ${fn.error.message}`);
      }

      const responseData = fn.data as { encounter_ids?: string[]; encounters?: string[]; ids?: string[] } | null;
      const ids: string[] =
        responseData?.encounter_ids ??
        responseData?.encounters ??
        responseData?.ids ??
        [];

      if (ids.length === 0) {
        setMsg('Parsed, but no encounters with data were found.');
        setLoading(false);
        return;
      }

      if (ids.length === 1) {
        // Single encounter → navigate immediately
        router.push(`/encounter/${ids[0]}`);
        return;
      }

      // 5) Multiple encounters → fetch metadata and show a picker
      const { data: encs, error: encErr } = await supabase
        .from('encounters')
        .select('id,boss,duty,start_ts,end_ts,boss_data,party_members')
        .in('id', ids);
      if (encErr) throw new Error(`Load encounters error: ${encErr.message}`);

      // Sort by start time descending for convenience
      const sorted = (encs ?? []).sort((a, b) => {
        const ta = a.start_ts ? new Date(a.start_ts).getTime() : 0;
        const tb = b.start_ts ? new Date(b.start_ts).getTime() : 0;
        return tb - ta;
      });

      setEncounters(sorted);
      setMsg(`Select an encounter (${sorted.length} found)`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setMsg(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl mb-4">Upload ACT Log</h1>

      <input
        type="file"
        accept=".log,.csv,.txt"
        onChange={handleUpload}
        disabled={loading}
        className="block"
      />

      {msg && <p className="mt-4 text-sm">{msg}</p>}

      {encounters.length > 0 && (
        <div className="mt-6 space-y-2">
          {encounters.map((e) => {
            const start = e.start_ts ? new Date(e.start_ts) : null;
            const end = e.end_ts ? new Date(e.end_ts) : null;
            const dur =
              start && end ? Math.max(1, Math.round((+end - +start) / 1000)) : null;
            
            // Use JSONB boss data if available, fallback to string boss
            const bossName = e.boss_data?.name || e.boss || 'Unknown Boss';
            const partySize = e.party_members?.length || 0;
            
            return (
              <a
                key={e.id}
                href={`/encounter/${e.id}`}
                className="block rounded-xl border p-3 hover:bg-zinc-50"
              >
                <div className="font-medium">
                  {bossName}{' '}
                  <span className="text-zinc-500">({e.duty || 'Unknown Duty'})</span>
                  {partySize > 0 && (
                    <span className="text-xs text-blue-600 ml-2">
                      {partySize} players
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {start ? start.toLocaleString() : '—'}
                  {dur ? ` • ${dur}s` : ''}
                </div>
              </a>
            );
          })}
        </div>
      )}

      {encounters.length > 0 && (
        <button
          className="mt-4 rounded-lg border px-3 py-1 text-sm"
          onClick={() => {
            setEncounters([]);
            setMsg('');
          }}
        >
          Upload another file
        </button>
      )}
    </div>
  );
}
