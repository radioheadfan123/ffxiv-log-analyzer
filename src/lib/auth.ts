import { supabase } from '@/lib/supabase';

export async function ensureUser() {
  // Ensure auth user exists (anon or signed in)
  let { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    await supabase.auth.signInAnonymously();
    ({ data: { user } } = await supabase.auth.getUser());
    if (!user) return null;
  }

  // Call server to ensure public.users row exists (server uses service role)
  try {
    const res = await fetch('/api/ensure-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id }),
    });

    if (!res.ok) {
      console.warn('ensure-user endpoint returned', await res.text());
    }
  } catch (err) {
    console.error('Failed to call /api/ensure-user', err);
  }

  return user;
}