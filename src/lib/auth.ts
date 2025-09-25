import { supabase } from '@/lib/supabase';

export async function ensureUser() {
  const g1 = await supabase.auth.getUser();
  if (g1.data.user) return g1.data.user;
  await supabase.auth.signInAnonymously();
  const g2 = await supabase.auth.getUser();
  return g2.data.user ?? null;
}
