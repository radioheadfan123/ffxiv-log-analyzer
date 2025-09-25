'use client';
import { use, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ensureUser } from '@/lib/auth';

type Row = {
  id: string;
  name: string;
  job: string | null;
  role: string | null;
  metrics: {
    dps: number | null;
    hps: number | null;
    deaths: number | null;
    uptime: number | null;
  } | null;
};

export default function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); // Next 15 param fix
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const u = await ensureUser(); // ensure session
      if (!u) {
        setErr('auth failed');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
  .from('actors')
  .select('id,name,job,role,metrics(dps,hps,deaths,uptime)')
  .eq('encounter_id', id);

if (error) {
  setErr(error.message);
} else {
  setRows(((data ?? []) as unknown) as Row[]);
}

      setLoading(false);
    })();
  }, [id]);

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Encounter {id}</h1>
        <a href="/encounters" className="text-sm underline">All encounters</a>
      </div>

      {loading && <div>Loading…</div>}
      {err && <div className="text-red-600 text-sm">Error: {err}</div>}

      {!loading && !err && (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Job</th>
                <th className="text-right px-3 py-2">DPS</th>
                <th className="text-right px-3 py-2">HPS</th>
                <th className="text-right px-3 py-2">Deaths</th>
                <th className="text-right px-3 py-2">Uptime</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No actors/metrics yet.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="odd:bg-zinc-50">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.job || 'UNK'}</td>
                  <td className="px-3 py-2 text-right">{Number(r.metrics?.dps || 0).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right">{Number(r.metrics?.hps || 0).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right">{r.metrics?.deaths ?? 0}</td>
                  <td className="px-3 py-2 text-right">{Number(r.metrics?.uptime || 0).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
