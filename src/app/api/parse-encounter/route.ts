import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { encounter_id } = await request.json();
    
    if (!encounter_id) {
      return NextResponse.json({ error: 'Missing encounter_id' }, { status: 400 });
    }

    // Call the parse-encounter Supabase edge function
    const { data, error } = await supabase.functions.invoke('parse-encounter', {
      body: { encounter_id }
    });

    if (error) {
      console.error('Parse-encounter function error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}