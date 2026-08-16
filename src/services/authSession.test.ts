import { beforeEach, describe, expect, it, vi } from 'vitest'
import authSessionSource from './authSession.ts?raw'
import loginSource from '../Login.tsx?raw'

const OLD_PREVIEW_DEPLOYMENT_URL =
  'sovereign-shield-ai-a6l5kv9ss-talha-portfolio2.vercel.app'
const PRODUCTION_SITE_URL = 'https://sovereign-shield-ai.vercel.app'

const { getSessionMock, initializeMock, onAuthStateChangeMock, signInWithOAuthMock, signOutMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    initializeMock: vi.fn(),
    onAuthStateChangeMock: vi.fn(),
    signInWithOAuthMock: vi.fn(),
    signOutMock: vi.fn(),
  }))

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      initialize: initializeMock,
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
  resolveOAuthRedirectUrl,
  signInWithGoogle,
  signOut,
  subscribeToAuthState,
} from './authSession'

describe('authSession helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initializeMock.mockResolvedValue({ error: null })
  })

  it('getCurrentSession waits for auth initialization before reading the session', async () => {
    const session = { user: { id: 'user-1' } }
    getSessionMock.mockResolvedValue({ data: { session }, error: null })

    await expect(getCurrentSession()).resolves.toBe(session)
    expect(initializeMock).toHaveBeenCalledTimes(1)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
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
    vi.stubEnv('VITE_SITE_URL', '')
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

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('resolveOAuthRedirectUrl uses VITE_SITE_URL when the browser is already on that origin', () => {
    vi.stubEnv('VITE_SITE_URL', PRODUCTION_SITE_URL)
    vi.stubGlobal('window', {
      location: { origin: PRODUCTION_SITE_URL },
    })

    expect(resolveOAuthRedirectUrl()).toBe(`${PRODUCTION_SITE_URL}/`)

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('resolveOAuthRedirectUrl keeps PKCE on the initiating origin when preview differs from VITE_SITE_URL', () => {
    vi.stubEnv('VITE_SITE_URL', PRODUCTION_SITE_URL)
    vi.stubGlobal('window', {
      location: { origin: `https://${OLD_PREVIEW_DEPLOYMENT_URL}` },
    })

    expect(resolveOAuthRedirectUrl()).toBe(`https://${OLD_PREVIEW_DEPLOYMENT_URL}/`)

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('signInWithGoogle prefers configured production site URL over preview browser origin when origins match', async () => {
    signInWithOAuthMock.mockResolvedValue({ data: {}, error: null })
    vi.stubEnv('VITE_SITE_URL', PRODUCTION_SITE_URL)
    vi.stubGlobal('window', {
      location: { origin: PRODUCTION_SITE_URL },
    })

    await expect(signInWithGoogle()).resolves.toEqual({})

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${PRODUCTION_SITE_URL}/`,
        skipBrowserRedirect: false,
        queryParams: { prompt: 'select_account' },
      },
    })

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('signInWithGoogle uses the live browser origin for PKCE when preview host differs from VITE_SITE_URL', async () => {
    signInWithOAuthMock.mockResolvedValue({ data: {}, error: null })
    vi.stubEnv('VITE_SITE_URL', PRODUCTION_SITE_URL)
    vi.stubGlobal('window', {
      location: { origin: `https://${OLD_PREVIEW_DEPLOYMENT_URL}` },
    })

    await expect(signInWithGoogle()).resolves.toEqual({})

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `https://${OLD_PREVIEW_DEPLOYMENT_URL}/`,
        skipBrowserRedirect: false,
        queryParams: { prompt: 'select_account' },
      },
    })

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('does not hardcode old preview deployment URLs in auth sources', () => {
    expect(authSessionSource).not.toContain(OLD_PREVIEW_DEPLOYMENT_URL)
    expect(loginSource).not.toContain(OLD_PREVIEW_DEPLOYMENT_URL)
    expect(authSessionSource).toContain('signInWithOAuth')
    expect(authSessionSource).toContain('VITE_SITE_URL')
    expect(loginSource).toContain('signInWithGoogle')
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
