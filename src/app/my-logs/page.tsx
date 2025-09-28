'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ensureUser } from '@/lib/auth';
import { useRouter } from 'next/navigation';

type Upload = {
  id: string;
  path: string;
  created_at: string;
};

export default function MyLogsPage() {
  const [logs, setLogs] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [encounters, setEncounters] = useState<any[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const user = await ensureUser();
      if (!user) return;
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('uploads')
        .select('id, path, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (!error) setLogs(data ?? []);
      setLoading(false);
    })();
  }, []);

  const handleReupload = async (upload: Upload) => {
    setMsg('Loading encounters...');
    // Query encounters for this upload
    const { data: encs, error } = await supabase
      .from('encounters')
      .select('id,upload_id,boss,duty,start_ts,end_ts,adds,party_members,lowest_boss_hp_pct')
      .eq('upload_id', upload.id)
      .order('start_ts', { ascending: true });

    if (error) {
      setMsg(`Failed to load encounters: ${error.message}`);
      setEncounters(null);
      return;
    }
    if (!encs || encs.length === 0) {
      setMsg('No encounters found in this log.');
      setEncounters(null);
      return;
    }
    if (encs.length === 1) {
      router.push(`/encounter/${encs[0].id}`);
      return;
    }
    // Multiple encounters: show selection UI
    setEncounters(encs);
    setMsg('');
  };

  if (loading) return <div>Loading…</div>;
  if (!logs.length) return <div>No logs uploaded in last 7 days.</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl mb-4">My Recent Logs (last 7 days)</h1>
      {msg && <div className="mb-4 text-blue-800">{msg}</div>}
      <ul className="space-y-3">
        {logs.map(log => (
          <li key={log.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between border rounded p-3">
            <div>
              <div className="font-mono text-sm break-all">{log.path}</div>
              <div className="text-xs text-zinc-500">
                Uploaded {new Date(log.created_at).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2 mt-2 sm:mt-0">
              <button
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
                onClick={() => handleReupload(log)}
              >
                Reupload
              </button>
            </div>
          </li>
        ))}
      </ul>
      {/* Encounter selection UI if multiple */}
      {encounters && encounters.length > 1 && (
        <div className="mt-7">
          <h2 className="font-semibold mb-3">Select an encounter:</h2>
          <ul className="space-y-2">
            {encounters.map(e => {
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
                <li key={e.id}>
                  <Link
                    href={`/encounter/${e.id}`}
                    className="block rounded border p-3 hover:bg-zinc-100"
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
                      {e.start_ts ? new Date(e.start_ts).toLocaleString() : '—'}
                    </div>
                    {bossHpDisplay && (
                      <div className="text-xs text-green-600 mt-1">
                        {bossHpDisplay}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <button
            className="mt-5 underline text-blue-600"
            onClick={() => setEncounters(null)}
          >
            Back to logs
          </button>
        </div>
      )}
    </div>
  );
}