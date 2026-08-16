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

/**
 * Register before React mounts so OAuth PKCE callbacks that emit SIGNED_IN via
 * setTimeout(0) during client initialization are not dropped.
 */
supabase.auth.onAuthStateChange(() => {
  // Intentionally empty — primes the auth listener before App subscribes.
})
