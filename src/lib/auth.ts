import { supabase } from '@/lib/supabase';

export async function ensureUser() {
  // Make sure we have a Supabase Auth user
  let { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    await supabase.auth.signInAnonymously();
    ({ data: { user } } = await supabase.auth.getUser());
    if (!user) return null;
  }

  // Now check if this user exists in our users table
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') { // Not a "No rows" error
    throw error;
  }

  // If not found, insert
  if (!data) {
    await supabase.from('users').insert({ id: user.id }).single();
  }

  return user;
}