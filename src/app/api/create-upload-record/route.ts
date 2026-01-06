import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const user_id = body?.user_id;
    const path = body?.path;
    const invokeParser = !!body?.invokeParser;

    if (!user_id || !path) return NextResponse.json({ error: 'missing user_id or path' }, { status: 400 });

    // Ensure user row exists
    const { data: existingUser, error: checkErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', user_id)
      .maybeSingle();

    if (checkErr) {
      console.error('users check error', checkErr);
      return NextResponse.json({ error: 'DB check error' }, { status: 500 });
    }

    if (!existingUser) {
      const { error: insErr } = await supabaseAdmin.from('users').insert({ id: user_id });
      if (insErr) {
        console.error('users insert error', insErr);
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    // Insert upload record
    const { data: uploadRow, error: insertErr } = await supabaseAdmin
      .from('uploads')
      .insert({ user_id, path, status: 'uploaded' })
      .select()
      .single();

    if (insertErr) {
      console.error('uploads insert error', insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Optionally invoke parse-log function (service role)
    let parseResult = null;
    let parseError = null;
    if (invokeParser) {
      try {
        const fn = await supabaseAdmin.functions.invoke('parse-log', {
          body: { upload_id: uploadRow.id, path },
        });
        parseResult = fn?.data ?? null;
        parseError = fn?.error ?? null;
      } catch (err) {
        parseError = String(err);
      }
    }

    return NextResponse.json({ upload: uploadRow, parseResult, parseError });
  } catch (err) {
    console.error('create-upload-record exception', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}