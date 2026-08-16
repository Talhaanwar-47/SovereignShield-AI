import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'

export type AuthSessionState = {
  session: Session | null
}

/**
 * Waits for Supabase Auth initialization (including OAuth callback URL processing).
 * Does not invent sessions or JWTs.
 */
export async function getCurrentSession(): Promise<Session | null> {
  await supabase.auth.initialize()
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
 * OAuth return URL for Supabase Google sign-in.
 * Production builds should set VITE_SITE_URL to the stable site origin so OAuth
 * does not follow transient preview deployment hostnames.
 *
 * PKCE stores the code verifier on the browser origin that starts OAuth, so the
 * redirect target must match that origin or the callback session cannot be restored.
 */
export function resolveOAuthRedirectUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined

  const currentOrigin = window.location.origin
  const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.trim()

  if (configuredSiteUrl) {
    try {
      const configuredOrigin = new URL(configuredSiteUrl).origin
      if (configuredOrigin === currentOrigin) {
        return `${configuredSiteUrl.replace(/\/+$/, '')}/`
      }
    } catch {
      // Invalid VITE_SITE_URL — fall back to the live browser origin.
    }
  }

  return `${currentOrigin}/`
}

/**
 * Starts real Google OAuth via Supabase Auth.
 * Caller must have Google provider enabled in the Supabase project.
 */
export async function signInWithGoogle(): Promise<{ errorMessage?: string }> {
  const redirectTo = resolveOAuthRedirectUrl()

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
