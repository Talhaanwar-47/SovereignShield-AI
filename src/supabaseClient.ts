import { createClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client (anon key).
 * Auth sessions are restored from URL hash/query after OAuth redirect
 * and persisted by supabase-js (detectSessionInUrl defaults to true).
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
