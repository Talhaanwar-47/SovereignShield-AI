import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import {
  mergeAuthSessionState,
  resolveAppShellView,
  shouldMarkAuthReady,
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

  it('treats INITIAL_SESSION null as signed out', () => {
    expect(mergeAuthSessionState(session(), 'INITIAL_SESSION', null)).toBeNull()
  })
})

describe('shouldMarkAuthReady', () => {
  it('waits for INITIAL_SESSION before marking auth ready', () => {
    expect(shouldMarkAuthReady('TOKEN_REFRESHED', false)).toBe(false)
  })

  it('marks auth ready on INITIAL_SESSION', () => {
    expect(shouldMarkAuthReady('INITIAL_SESSION', false)).toBe(true)
  })

  it('marks auth ready when OAuth callback SIGNED_IN arrives after mount', () => {
    expect(shouldMarkAuthReady('SIGNED_IN', false)).toBe(true)
  })

  it('stays ready once bootstrap completed', () => {
    expect(shouldMarkAuthReady('TOKEN_REFRESHED', true)).toBe(true)
  })
})
