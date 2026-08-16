import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import {
  applyAuthListenerEvent,
  finishAuthBootstrap,
  INITIAL_AUTH_LISTENER_STATE,
  mergeAuthSessionState,
  resolveAppShellView,
} from './authAppGate'
import type { AuthProfile } from './services/authProfile'

const LOADING_PROFILE: AuthProfile = {
  displayName: 'Authenticated User',
  roleLabel: 'Authenticated',
  membershipRole: null,
  organizationName: null,
  isDemoOrganization: false,
}

function session(userId = 'user-1'): Session {
  return { user: { id: userId } } as Session
}

describe('resolveAppShellView', () => {
  it('shows loading-auth until auth bootstrap completes', () => {
    expect(
      resolveAppShellView({
        authReady: false,
        session: null,
        profileUserId: null,
        profile: LOADING_PROFILE,
      }),
    ).toBe('loading-auth')
  })

  it('shows login for unauthenticated users after auth bootstrap', () => {
    expect(
      resolveAppShellView({
        authReady: true,
        session: null,
        profileUserId: null,
        profile: LOADING_PROFILE,
      }),
    ).toBe('login')
  })

  it('routes authenticated users without membership to demo onboarding', () => {
    expect(
      resolveAppShellView({
        authReady: true,
        session: session(),
        profileUserId: 'user-1',
        profile: LOADING_PROFILE,
      }),
    ).toBe('demo-onboarding')
  })

  it('routes authenticated members to the dashboard shell', () => {
    expect(
      resolveAppShellView({
        authReady: true,
        session: session(),
        profileUserId: 'user-1',
        profile: {
          ...LOADING_PROFILE,
          membershipRole: 'admin',
          roleLabel: 'Admin',
        },
      }),
    ).toBe('dashboard')
  })

  it('shows profile loading while membership is unresolved', () => {
    expect(
      resolveAppShellView({
        authReady: true,
        session: session(),
        profileUserId: null,
        profile: LOADING_PROFILE,
      }),
    ).toBe('loading-profile')
  })
})

describe('auth bootstrap ordering', () => {
  it('does not mark auth ready synchronously on INITIAL_SESSION(null)', () => {
    const applied = applyAuthListenerEvent(
      INITIAL_AUTH_LISTENER_STATE,
      'INITIAL_SESSION',
      null,
    )

    expect(applied.shouldResolveBootstrap).toBe(true)
    expect(applied.state.authReady).toBe(false)
    expect(applied.state.session).toBeNull()
    expect(
      resolveAppShellView({
        authReady: applied.state.authReady,
        session: applied.state.session,
        profileUserId: null,
        profile: LOADING_PROFILE,
      }),
    ).toBe('loading-auth')
  })

  it('waits for resolveAuthBootstrapSession before marking ready', () => {
    const started = applyAuthListenerEvent(
      INITIAL_AUTH_LISTENER_STATE,
      'INITIAL_SESSION',
      null,
    )

    expect(started.state.authReady).toBe(false)
    expect(started.shouldResolveBootstrap).toBe(true)

    const restored = session('oauth-user')
    const finished = finishAuthBootstrap(started.state, restored)

    expect(finished.authReady).toBe(true)
    expect(finished.session).toBe(restored)
  })

  it('uses the resolved session as the app session after bootstrap', () => {
    const started = applyAuthListenerEvent(
      INITIAL_AUTH_LISTENER_STATE,
      'INITIAL_SESSION',
      null,
    )
    const restored = session('oauth-user')
    const finished = finishAuthBootstrap(started.state, restored)

    expect(finished.session?.user.id).toBe('oauth-user')
    expect(
      resolveAppShellView({
        authReady: finished.authReady,
        session: finished.session,
        profileUserId: 'oauth-user',
        profile: LOADING_PROFILE,
      }),
    ).toBe('demo-onboarding')
  })

  it('routes authenticated users with no membership to DemoOnboarding', () => {
    const finished = finishAuthBootstrap(INITIAL_AUTH_LISTENER_STATE, session())

    expect(
      resolveAppShellView({
        authReady: finished.authReady,
        session: finished.session,
        profileUserId: 'user-1',
        profile: LOADING_PROFILE,
      }),
    ).toBe('demo-onboarding')
  })

  it('routes a truly unauthenticated bootstrap to Login', () => {
    const started = applyAuthListenerEvent(
      INITIAL_AUTH_LISTENER_STATE,
      'INITIAL_SESSION',
      null,
    )
    const finished = finishAuthBootstrap(started.state, null)

    expect(finished.authReady).toBe(true)
    expect(finished.session).toBeNull()
    expect(
      resolveAppShellView({
        authReady: finished.authReady,
        session: finished.session,
        profileUserId: null,
        profile: LOADING_PROFILE,
      }),
    ).toBe('login')
  })

  it('keeps a SIGNED_IN session that arrives while bootstrap recovery is in flight', () => {
    const started = applyAuthListenerEvent(
      INITIAL_AUTH_LISTENER_STATE,
      'INITIAL_SESSION',
      null,
    )
    const signedIn = applyAuthListenerEvent(started.state, 'SIGNED_IN', session('oauth-user'))

    expect(signedIn.state.authReady).toBe(false)
    expect(signedIn.shouldResolveBootstrap).toBe(false)
    expect(signedIn.state.session?.user.id).toBe('oauth-user')

    const finished = finishAuthBootstrap(signedIn.state, null)
    expect(finished.authReady).toBe(true)
    expect(finished.session?.user.id).toBe('oauth-user')
  })

  it('applies later SIGNED_IN and SIGNED_OUT events after bootstrap', () => {
    const ready = finishAuthBootstrap(INITIAL_AUTH_LISTENER_STATE, session('first'))

    const signedIn = applyAuthListenerEvent(ready, 'SIGNED_IN', session('second'))
    expect(signedIn.state.authReady).toBe(true)
    expect(signedIn.state.session?.user.id).toBe('second')

    const signedOut = applyAuthListenerEvent(signedIn.state, 'SIGNED_OUT', null)
    expect(signedOut.state.session).toBeNull()
    expect(
      resolveAppShellView({
        authReady: signedOut.state.authReady,
        session: signedOut.state.session,
        profileUserId: null,
        profile: LOADING_PROFILE,
      }),
    ).toBe('login')
  })
})

describe('mergeAuthSessionState', () => {
  it('preserves an OAuth-restored session when a stale null update arrives', () => {
    const restored = session()

    expect(mergeAuthSessionState(restored, 'TOKEN_REFRESHED', null)).toBe(restored)
  })

  it('accepts OAuth callback SIGNED_IN sessions', () => {
    const restored = session('oauth-user')

    expect(mergeAuthSessionState(null, 'SIGNED_IN', restored)).toBe(restored)
  })

  it('clears the session on SIGNED_OUT', () => {
    expect(mergeAuthSessionState(session(), 'SIGNED_OUT', null)).toBeNull()
  })

  it('treats INITIAL_SESSION null as signed out after bootstrap', () => {
    expect(mergeAuthSessionState(session(), 'INITIAL_SESSION', null)).toBeNull()
  })
})
