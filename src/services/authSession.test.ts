import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, onAuthStateChangeMock, signInWithOAuthMock, signOutMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    onAuthStateChangeMock: vi.fn(),
    signInWithOAuthMock: vi.fn(),
    signOutMock: vi.fn(),
  }))

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithOAuth: signInWithOAuthMock,
      signOut: signOutMock,
    },
  },
}))

import {
  displayLabelForSession,
  getCurrentSession,
  hasAuthenticatedSession,
  signInWithGoogle,
  signOut,
  subscribeToAuthState,
} from './authSession'

describe('authSession helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getCurrentSession returns the Supabase session when present', async () => {
    const session = { user: { id: 'user-1' } }
    getSessionMock.mockResolvedValue({ data: { session }, error: null })

    await expect(getCurrentSession()).resolves.toBe(session)
  })

  it('getCurrentSession returns null when Supabase reports an error', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: 'session missing' },
    })

    await expect(getCurrentSession()).resolves.toBeNull()
  })

  it('subscribeToAuthState forwards events and unsubscribes', () => {
    const unsubscribe = vi.fn()
    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe } },
    })

    const handler = vi.fn()
    const stop = subscribeToAuthState(handler)

    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1)
    const registered = onAuthStateChangeMock.mock.calls[0]?.[0] as (
      event: string,
      session: unknown,
    ) => void
    registered('SIGNED_IN', { user: { id: 'u1' } })
    expect(handler).toHaveBeenCalledWith('SIGNED_IN', { user: { id: 'u1' } })

    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('signInWithGoogle uses the Google OAuth provider', async () => {
    signInWithOAuthMock.mockResolvedValue({ data: {}, error: null })
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })

    await expect(signInWithGoogle()).resolves.toEqual({})

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:5173/',
        skipBrowserRedirect: false,
        queryParams: { prompt: 'select_account' },
      },
    })

    vi.unstubAllGlobals()
  })

  it('signInWithGoogle maps provider errors to a safe message', async () => {
    signInWithOAuthMock.mockResolvedValue({
      data: {},
      error: { message: 'provider not enabled' },
    })

    await expect(signInWithGoogle()).resolves.toEqual({
      errorMessage: 'Unable to start Google sign-in.',
    })
  })

  it('signOut calls supabase.auth.signOut', async () => {
    signOutMock.mockResolvedValue({ error: null })
    await signOut()
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('hasAuthenticatedSession and displayLabelForSession are display-only', () => {
    expect(hasAuthenticatedSession(null)).toBe(false)
    expect(displayLabelForSession(null)).toBe('Guest')

    const session = { user: { id: 'user-1' } } as never
    expect(hasAuthenticatedSession(session)).toBe(true)
    expect(displayLabelForSession(session)).toBe('Authenticated')
  })
})
