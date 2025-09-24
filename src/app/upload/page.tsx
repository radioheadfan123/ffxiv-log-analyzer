'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState('');

const ensureUser = async () => {
  const g1 = await supabase.auth.getUser();
  if (g1.data.user) return g1.data.user;

  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;

  const g2 = await supabase.auth.getUser();
  if (!g2.data.user) throw new Error('Anon sign-in failed. Check Supabase → Auth → Anonymous is enabled.');
  return g2.data.user;
};

  const onUpload = async () => {
    try {
      if (!file) return setMsg('choose a file first');
      const user = await ensureUser();

      await supabase.from('users').upsert({ id: user.id, email: user.email ?? null });

      const path = `${user.id}/${Date.now()}_${file.name}`;
      const up = await supabase.storage.from('logs').upload(path, file, { upsert: false });
      if (up.error) return setMsg(`upload error: ${up.error.message}`);

const ins = await supabase.from('uploads')
  .insert({ user_id: user.id, path, status: 'queued' })
  .select('id').single();
if (ins.error) return setMsg(`db error: ${ins.error.message}`);

// call the edge function
const fn = await supabase.functions.invoke('parse-log', {
  body: { upload_id: ins.data.id, path }
});
if ((fn as any).error) return setMsg(`parse start error: ${(fn as any).error.message}`);

setMsg(`uploaded ✓ parsing…`);
    } catch (e:any) {
      setMsg(String(e?.message || e));
    }
  };

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl mb-3">Upload ACT Log</h1>
      <input type="file" accept=".log,.txt,.csv" onChange={(e)=>setFile(e.target.files?.[0] ?? null)} />
      <button className="mt-3 px-3 py-2 rounded bg-black text-white" onClick={onUpload}>
        Upload
      </button>
      <div className="mt-3 text-sm">{msg}</div>
    </div>
  );
}
