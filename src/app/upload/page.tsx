'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ensureUser } from '@/lib/auth';

type Encounter = {
  id: string;
  upload_id: string;
  boss: { name: string; job?: string; role?: string } | null;
  duty: string | null;
  start_ts: string | null;
  end_ts: string | null;
  adds?: Array<{ name: string; job?: string; role?: string }> | null;
  party_members?: Array<{ name: string; job?: string; role?: string }> | null;
  lowest_boss_hp_pct?: number | null;
};

function formatDuration(seconds: number | null): string {
  if (!seconds || isNaN(seconds)) return '';
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}m ${sec}s`;
}

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
      const user = await ensureUser();
      if (!user) {
        setMsg('Authentication failed.');
        setLoading(false);
        return;
      }

      const path = `${user.id}/${Date.now()}_${file.name}`;

      // 1) request signed upload token from server
      const tokenRes = await fetch('/api/get-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || tokenJson.error) throw new Error(tokenJson.error ?? 'Failed to get upload token');

      // 2) upload directly to Supabase Storage using the signed token
      const { error: upErr } = await supabase.storage
        .from('logs')
        .uploadToSignedUrl(path, tokenJson.token, file);
      if (upErr) throw new Error(`Upload error: ${upErr.message}`);

      // 3) tell server to create the uploads DB row and optionally invoke parser
      const createRes = await fetch('/api/create-upload-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, path, invokeParser: true }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok || createJson.error) {
        throw new Error(createJson.error ?? 'Failed to create upload record');
      }

      const uploaded = createJson.upload;
      const parseResultRaw = createJson.parseResult;
      // attempt to extract encounter ids from parseResult
      let ids: string[] =
        parseResultRaw?.encounter_ids ?? parseResultRaw?.encounters ?? parseResultRaw?.ids ?? [];

      // fallback: query encounters by upload_id if server didn't return ids
      if ((!ids || ids.length === 0) && uploaded?.id) {
        const { data: encsByUpload, error: encErr } = await supabase
          .from('encounters')
          .select('id')
          .eq('upload_id', uploaded.id);
        if (!encErr && Array.isArray(encsByUpload) && encsByUpload.length > 0) {
          ids = encsByUpload.map((r: any) => r.id);
        }
      }

      if (!ids || ids.length === 0) {
        setMsg('Uploaded ✓ Parsing… (no encounters available yet)');
        setLoading(false);
        return;
      }

      if (ids.length === 1) {
        router.push(`/encounter/${ids[0]}`);
        return;
      }

      const { data: encs, error: encErr } = await supabase
        .from('encounters')
        .select('id,upload_id,boss,duty,start_ts,end_ts,adds,party_members,lowest_boss_hp_pct')
        .in('id', ids);
      if (encErr) throw new Error(`Load encounters error: ${encErr.message}`);

      const sorted = (encs ?? []).sort((a: any, b: any) => {
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

            const bossName = e.boss?.name || 'Unknown Boss';
            const partySize = e.party_members?.length || 0;

            let bossHpDisplay = '';
            if (typeof e.lowest_boss_hp_pct === 'number') {
              bossHpDisplay =
                e.lowest_boss_hp_pct === 0
                  ? 'Kill'
                  : `${e.lowest_boss_hp_pct.toFixed(1)}% remaining`;
            }

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
                  {dur !== null ? ` • ${formatDuration(dur)}` : ''}
                </div>
                {bossHpDisplay && (
                  <div className="text-xs text-green-600 mt-1">
                    {bossHpDisplay}
                  </div>
                )}
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