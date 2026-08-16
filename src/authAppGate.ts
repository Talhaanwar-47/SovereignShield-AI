import type { Session } from '@supabase/supabase-js'
import type { AuthChangeEvent } from '@supabase/supabase-js'
import { hasAuthenticatedSession, isAuthBootstrapEvent, resolveAuthBootstrapSession } from './services/authSession'
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

export type AuthListenerState = {
  authReady: boolean
  session: Session | null
  bootstrapStarted: boolean
}

export const INITIAL_AUTH_LISTENER_STATE: AuthListenerState = {
  authReady: false,
  session: null,
  bootstrapStarted: false,
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

/**
 * First INITIAL_SESSION / SIGNED_IN starts async recovery only.
 * Does not mark authReady — that happens in finishAuthBootstrap after await.
 */
export function applyAuthListenerEvent(
  state: AuthListenerState,
  event: AuthChangeEvent,
  nextSession: Session | null,
): { state: AuthListenerState; shouldResolveBootstrap: boolean } {
  if (!state.bootstrapStarted && isAuthBootstrapEvent(event)) {
    return {
      state: {
        ...state,
        bootstrapStarted: true,
        session: nextSession ?? state.session,
      },
      shouldResolveBootstrap: true,
    }
  }

  if (!state.authReady) {
    if (event === 'SIGNED_OUT') {
      return {
        state: { ...state, session: null },
        shouldResolveBootstrap: false,
      }
    }
    if (nextSession) {
      return {
        state: { ...state, session: nextSession },
        shouldResolveBootstrap: false,
      }
    }
    return { state, shouldResolveBootstrap: false }
  }

  return {
    state: {
      ...state,
      session: mergeAuthSessionState(state.session, event, nextSession),
    },
    shouldResolveBootstrap: false,
  }
}

/**
 * Completes bootstrap only after resolveAuthBootstrapSession() has settled.
 * A SIGNED_IN session that arrived while recovery was in flight is preserved
 * if recovery itself returned null.
 */
export function finishAuthBootstrap(
  state: AuthListenerState,
  resolved: Session | null,
): AuthListenerState {
  return {
    bootstrapStarted: true,
    authReady: true,
    session: resolved ?? state.session,
  }
}

/**
 * First bootstrap step: wait for session recovery, then mark auth ready.
 * Callers must not set React authReady until this promise resolves.
 */
export async function runFirstAuthBootstrap(
  event: AuthChangeEvent,
  eventSession: Session | null,
  state: AuthListenerState,
): Promise<AuthListenerState> {
  const resolved = await resolveAuthBootstrapSession(event, eventSession)
  return finishAuthBootstrap(state, resolved)
}
