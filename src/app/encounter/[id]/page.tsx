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
  const [encounter, setEncounter] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const u = await ensureUser(); // ensure session
      if (!u) {
        setErr('auth failed');
        setLoading(false);
        return;
      }

      // First check if encounter exists and is parsed
      const { data: encData, error: encError } = await supabase
        .from('encounters')
        .select('id,duty,start_ts,end_ts,details_parsed,boss')
        .eq('id', id)
        .single();

      if (encError) {
        setErr(encError.message);
        setLoading(false);
        return;
      }

      setEncounter(encData);

      if (!encData.details_parsed) {
        setLoading(false);
        return; // Don't try to load actors/metrics if not parsed
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
        <a href="/encounter" className="text-sm underline">All encounters</a>
      </div>

      {encounter && (
        <div className="mb-4 p-3 bg-gray-50 rounded">
          <div className="font-medium">
            {encounter.boss?.name || 'Unknown Boss'} • {encounter.duty || 'Unknown Duty'}
          </div>
          <div className="text-sm text-gray-600">
            {encounter.start_ts ? new Date(encounter.start_ts).toLocaleString() : 'Unknown time'}
          </div>
        </div>
      )}

      {loading && <div>Loading…</div>}
      {err && <div className="text-red-600 text-sm">Error: {err}</div>}

      {!loading && encounter && !encounter.details_parsed && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded mb-4">
          <div className="font-medium text-yellow-800">Details Not Parsed</div>
          <div className="text-yellow-700 text-sm mt-1">
            This encounter only has header information. Go back to the encounter list and click "Parse Details" to load the full data.
          </div>
          <a 
            href="/encounter" 
            className="inline-block mt-2 text-blue-600 hover:text-blue-800 text-sm"
          >
            ← Back to Encounter List
          </a>
        </div>
      )}

      {!loading && encounter?.details_parsed && (
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
