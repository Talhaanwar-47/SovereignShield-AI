import { createClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client (anon key).
 * Production Google OAuth returns implicit-grant tokens in the URL hash
 * (#access_token=…); detectSessionInUrl must stay enabled with flowType
 * 'implicit' so supabase-js consumes the hash via its normal browser handler.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: 'implicit',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

/**
 * Register immediately after createClient so implicit OAuth callbacks that emit
 * SIGNED_IN during initialization are not dropped before React mounts.
 */
supabase.auth.onAuthStateChange(() => {
  // Intentionally empty — primes the auth listener before App subscribes.
})
