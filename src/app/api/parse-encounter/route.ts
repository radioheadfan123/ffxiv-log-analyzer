import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    const userId = form.get('user_id') as string | null;

    if (!file || !userId) {
      return NextResponse.json({ error: 'missing file or user_id' }, { status: 400 });
    }

    // 1) Ensure public.users row exists (server uses service role - bypasses RLS)
    const { data: existingUser, error: checkErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (checkErr) {
      console.error('Error checking users table:', checkErr);
      return NextResponse.json({ error: 'DB check error' }, { status: 500 });
    }

    if (!existingUser) {
      const { error: insErr } = await supabaseAdmin.from('users').insert({ id: userId });
      if (insErr) {
        console.error('Error inserting users row:', insErr);
        return NextResponse.json({ error: 'DB insert error' }, { status: 500 });
      }
    }

    // 2) Upload file to storage
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = (file as any).name ?? 'upload';
    const path = `${userId}/${Date.now()}-${fileName}`;

    const { error: uploadErr } = await supabaseAdmin
      .storage
      .from('logs')
      .upload(path, buffer, { contentType: (file as any).type || 'application/octet-stream' });

    if (uploadErr) {
      console.error('Storage upload error:', uploadErr);
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    // 3) Insert uploads row
    const { data: insertedUpload, error: dbErr } = await supabaseAdmin
      .from('uploads')
      .insert({ user_id: userId, path, status: 'uploaded' })
      .select()
      .single();

    if (dbErr) {
      console.error('Uploads insert error:', dbErr);
      // If DB insert fails, consider removing the uploaded file (cleanup), omitted for brevity
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    // 4) Optionally invoke parse-log function (using service role)
    try {
      const fn = await supabaseAdmin.functions.invoke('parse-log', {
        body: { upload_id: insertedUpload.id, path },
      });
      // fn may contain data/error. We'll include it in the response for debugging.
      return NextResponse.json({ upload: insertedUpload, parseResult: fn?.data ?? null, parseError: fn?.error ?? null });
    } catch (fnErr) {
      console.warn('parse-log invocation failed:', fnErr);
      return NextResponse.json({ upload: insertedUpload, parseError: String(fnErr) });
    }
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}