import type { Session } from '@supabase/supabase-js'
import type { AuthChangeEvent } from '@supabase/supabase-js'
import { hasAuthenticatedSession } from './services/authSession'
import type { AuthProfile } from './services/authProfile'
import { hasOrganizationMembership, isDemoEligible } from './services/authProfile'

export type AppShellView =
  | 'loading-auth'
  | 'login'
  | 'loading-profile'
  | 'dashboard'
  | 'demo-onboarding'
  | 'no-access'

export type AppAuthGateInput = {
  authReady: boolean
  session: Session | null
  profileUserId: string | null
  profile: AuthProfile
}

/**
 * Pure view resolver for App auth gating — keeps OAuth callback / membership routing testable.
 */
export function resolveAppShellView(input: AppAuthGateInput): AppShellView {
  const { authReady, session, profileUserId, profile } = input
  const activeUser = session?.user
  const isAuthenticated = hasAuthenticatedSession(session)
  const profileResolved = Boolean(activeUser && profileUserId === activeUser.id)
  const resolvedProfile = profileResolved ? profile : null
  const membershipGranted =
    profileResolved && resolvedProfile !== null && hasOrganizationMembership(resolvedProfile)
  const demoEligible =
    profileResolved && resolvedProfile !== null && isDemoEligible(resolvedProfile)

  if (!authReady) return 'loading-auth'
  if (!isAuthenticated || !activeUser) return 'login'
  if (!profileResolved) return 'loading-profile'
  if (membershipGranted) return 'dashboard'
  if (demoEligible) return 'demo-onboarding'
  return 'no-access'
}

/**
 * Applies Supabase auth events without clobbering a restored session with a stale null.
 */
export function mergeAuthSessionState(
  previous: Session | null,
  event: AuthChangeEvent,
  next: Session | null,
): Session | null {
  if (event === 'SIGNED_OUT') return null
  if (next) return next
  if (event === 'INITIAL_SESSION') return null
  return previous
}

/** @deprecated App completes bootstrap asynchronously; kept for unit tests. */
export function shouldMarkAuthReady(event: AuthChangeEvent, authReady: boolean): boolean {
  if (authReady) return true
  return event === 'INITIAL_SESSION' || event === 'SIGNED_IN'
}
