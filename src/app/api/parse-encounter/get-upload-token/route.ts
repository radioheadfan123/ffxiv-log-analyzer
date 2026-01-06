import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const path = body?.path;

    // Accept a few possible names and coerce to a positive integer seconds value
    const raw = body?.lifetimeSeconds ?? body?.expiresIn ?? body?.lifetime ?? body?.ttl;
    const lifetimeSeconds = Number(raw ?? 60);

    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'missing or invalid "path" in request body' }, { status: 400 });
    }

    if (Number.isNaN(lifetimeSeconds) || lifetimeSeconds <= 0) {
      return NextResponse.json({ error: 'invalid lifetimeSeconds/expiresIn value; must be a positive number' }, { status: 400 });
    }

    // createSignedUploadUrl expects a numeric seconds value (supabase-js v2)
    const { data, error } = await (supabaseAdmin.storage.from('logs') as any).createSignedUploadUrl(path, lifetimeSeconds);

    if (error) {
      console.error('createSignedUploadUrl error', error);
      return NextResponse.json({ error: error.message ?? String(error) }, { status: 500 });
    }

    return NextResponse.json(data ?? {});
  } catch (err) {
    console.error('get-upload-token exception', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}