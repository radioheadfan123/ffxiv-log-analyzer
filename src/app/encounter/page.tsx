'use client';

import { useEffect, useState } from 'react';
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
};

export default function EncounterListPage() {
  const [rows, setRows] = useState<Encounter[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const u = await ensureUser();
      if (!u) {
        setErr('auth failed');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('encounters')
        .select('id,upload_id,boss,duty,start_ts,end_ts,adds,party_members')
        .order('start_ts', { ascending: false })
        .limit(50);

      if (error) setErr(error.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl mb-4">Your Encounters</h1>

      {loading && <div>Loading…</div>}
      {err && <div className="text-red-600 text-sm">{err}</div>}

      {!loading && !err && rows.length === 0 && (
        <div className="text-zinc-500">No encounters yet. Upload a log first.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((e) => {
            const start = e.start_ts ? new Date(e.start_ts) : null;
            const end = e.end_ts ? new Date(e.end_ts) : null;
            const dur =
              start && end ? Math.max(1, Math.round((+end - +start) / 1000)) : null;

            const bossName = e.boss?.name || 'Unknown Boss';
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
    </div>
  );
}
