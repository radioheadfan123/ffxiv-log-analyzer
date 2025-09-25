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
  details_parsed: boolean;
  adds?: Array<{ name: string; job?: string; role?: string }> | null;
  party_members?: Array<{ name: string; job?: string; role?: string }> | null;
};

export default function EncounterListPage() {
  const [rows, setRows] = useState<Encounter[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState<Set<string>>(new Set());

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
        .select('id,upload_id,boss,duty,start_ts,end_ts,details_parsed,adds,party_members')
        .order('start_ts', { ascending: false })
        .limit(50);

      if (error) setErr(error.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  const handleParseDetails = async (encounterId: string) => {
    setParsing(prev => new Set(prev).add(encounterId));
    
    try {
      const response = await fetch('/api/parse-encounter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounter_id: encounterId })
      });
      
      const result = await response.json();
      
      if (result.ok) {
        // Refresh the encounter list to show updated status
        setRows(prev => prev.map(row => 
          row.id === encounterId 
            ? { ...row, details_parsed: true }
            : row
        ));
      } else {
        setErr(result.error || 'Parse failed');
      }
    } catch (e) {
      setErr('Failed to parse encounter details');
    } finally {
      setParsing(prev => {
        const next = new Set(prev);
        next.delete(encounterId);
        return next;
      });
    }
  };

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
              <div
                key={e.id}
                className="rounded-xl border p-3 hover:bg-zinc-50"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">
                      {bossName}{' '}
                      <span className="text-zinc-500">({e.duty || 'Unknown Duty'})</span>
                      {partySize > 0 && (
                        <span className="text-xs text-blue-600 ml-2">
                          {partySize} players
                        </span>
                      )}
                      {!e.details_parsed && (
                        <span className="text-xs text-orange-600 ml-2">
                          • Headers only
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {start ? start.toLocaleString() : '—'}
                      {dur ? ` • ${dur}s` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!e.details_parsed && (
                      <button
                        onClick={(ev) => {
                          ev.preventDefault();
                          handleParseDetails(e.id);
                        }}
                        disabled={parsing.has(e.id)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {parsing.has(e.id) ? 'Parsing...' : 'Parse Details'}
                      </button>
                    )}
                    <a
                      href={`/encounter/${e.id}`}
                      className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                    >
                      View
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
