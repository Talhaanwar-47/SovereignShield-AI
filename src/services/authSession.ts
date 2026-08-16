import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'

export type AuthSessionState = {
  session: Session | null
}

export type AuthBootstrapDiagnostic = {
  event: AuthChangeEvent
  eventSessionPresent: boolean
  resolvedSessionPresent: boolean
  oauthHashPresent: boolean
}

/** DEV-only bootstrap tracing — never logs tokens, codes, or URL fragments. */
export function logAuthBootstrapDiagnostic(detail: AuthBootstrapDiagnostic): void {
  if (!import.meta.env.DEV) return
  console.info('[auth-bootstrap]', {
    event: detail.event,
    eventSessionPresent: detail.eventSessionPresent,
    resolvedSessionPresent: detail.resolvedSessionPresent,
    oauthHashPresent: detail.oauthHashPresent,
  })
}

/**
 * Reads the current Supabase Auth session after client initialization.
 * Does not invent sessions or JWTs and never parses OAuth tokens manually.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    return null
  }
  return data.session
}

export function isAuthBootstrapEvent(event: AuthChangeEvent): boolean {
  return event === 'INITIAL_SESSION' || event === 'SIGNED_IN'
}

/**
 * Resolves the session for the first auth bootstrap event.
 * When Supabase emits INITIAL_SESSION null (common after implicit OAuth hash
 * consumption), fall back to getSession() so persisted sessions are not missed.
 */
export async function resolveAuthBootstrapSession(
  event: AuthChangeEvent,
  eventSession: Session | null,
): Promise<Session | null> {
  if (eventSession) return eventSession
  if (isAuthBootstrapEvent(event)) {
    return getCurrentSession()
  }
  return null
}

/**
 * True when the browser URL looks like a Supabase implicit OAuth callback.
 * Checks parameter names only — never reads or exposes credential values.
 */
export function isImplicitOAuthCallbackUrl(href?: string): boolean {
  if (typeof window === 'undefined' && href === undefined) return false

  try {
    const url = new URL(href ?? window.location.href)
    if (!url.hash || url.hash.length <= 1) return false

    const hashParams = new URLSearchParams(
      url.hash.startsWith('#') ? url.hash.slice(1) : url.hash,
    )

    return (
      hashParams.has('access_token') ||
      hashParams.has('error') ||
      hashParams.has('error_description')
    )
  } catch {
    return false
  }
}

/**
 * After an implicit OAuth redirect, read the session supabase-js restored via
 * detectSessionInUrl (never parses access_token/refresh_token manually).
 * @deprecated Prefer resolveAuthBootstrapSession during App bootstrap.
 */
export async function restoreSessionAfterImplicitOAuthCallback(): Promise<Session | null> {
  return getCurrentSession()
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
