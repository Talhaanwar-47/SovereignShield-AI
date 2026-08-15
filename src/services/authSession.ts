import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'

export type AuthSessionState = {
  session: Session | null
}

/**
 * Restores the current Supabase Auth session (if any).
 * Does not invent sessions or JWTs.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    return null
  }
  return data.session
}

/**
 * Subscribes to Supabase Auth state changes.
 * Returns the unsubscribe function from the client.
 */
export function subscribeToAuthState(
  onChange: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    onChange(event, session)
  })
  return () => {
    subscription.unsubscribe()
  }
}

/**
 * Starts real Google OAuth via Supabase Auth.
 * Caller must have Google provider enabled in the Supabase project.
 */
export async function signInWithGoogle(): Promise<{ errorMessage?: string }> {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/` : undefined

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: false,
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error) {
    return { errorMessage: 'Unable to start Google sign-in.' }
  }
  return {}
}

/**
 * Ends the Supabase Auth session.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/** Display-only label — not an authorization claim. */
export function displayLabelForSession(session: Session | null): string {
  if (!session?.user) return 'Guest'
  return 'Authenticated'
}

export function hasAuthenticatedSession(session: Session | null): boolean {
  return Boolean(session?.user)
}
