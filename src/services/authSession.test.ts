import { beforeEach, describe, expect, it, vi } from 'vitest'
import authSessionSource from './authSession.ts?raw'
import loginSource from '../Login.tsx?raw'
import supabaseClientSource from '../supabaseClient.ts?raw'
import appSource from '../App.tsx?raw'

const OLD_PREVIEW_DEPLOYMENT_URL =
  'sovereign-shield-ai-a6l5kv9ss-talha-portfolio2.vercel.app'
const PRODUCTION_SITE_URL = 'https://sovereign-shield-ai.vercel.app'

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
  deferAfterAuthStateChange,
  getCurrentSession,
  hasAuthenticatedSession,
  isAuthBootstrapEvent,
  isImplicitOAuthCallbackUrl,
  resolveAuthBootstrapSession,
  resolveOAuthRedirectUrl,
  restoreSessionAfterImplicitOAuthCallback,
  signInWithGoogle,
  signOut,
  subscribeToAuthState,
} from './authSession'

describe('authSession helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getCurrentSession uses supabase.auth.getSession only', async () => {
    const session = { user: { id: 'user-1' } }
    getSessionMock.mockResolvedValue({ data: { session }, error: null })

    await expect(getCurrentSession()).resolves.toBe(session)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(authSessionSource).not.toMatch(/await supabase\.auth\.initialize\s*\(/)
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

  it('configures implicit OAuth session detection in the Supabase browser client', () => {
    expect(supabaseClientSource).toContain("flowType: 'implicit'")
    expect(supabaseClientSource).toContain('detectSessionInUrl: true')
    expect(supabaseClientSource).toContain('persistSession: true')
    expect(supabaseClientSource).toContain('autoRefreshToken: true')
    expect(supabaseClientSource).toContain('onAuthStateChange')
  })

  it('App defers React auth state until runFirstAuthBootstrap resolves', () => {
    expect(appSource).toContain('applyAuthListenerEvent')
    expect(appSource).toContain('runFirstAuthBootstrap')
    expect(appSource).toContain('deferAfterAuthStateChange')
    expect(appSource).toContain('logAuthBootstrapDiagnostic')
    expect(appSource).toContain('subscribeToAuthState')
    expect(appSource).not.toContain('shouldMarkAuthReady')
    expect(appSource).not.toContain('mergeAuthSessionState')
    expect(appSource).not.toContain('resolveAuthBootstrapSession')
    expect(appSource).not.toContain('finishAuthBootstrap')
    expect(appSource).not.toMatch(/void\s*\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*runFirstAuthBootstrap/)
    expect(authSessionSource).toContain('resolveAuthBootstrapSession')
    expect(authSessionSource).not.toMatch(/await supabase\.auth\.initialize\s*\(/)
    expect(authSessionSource).not.toMatch(/access_token\s*[:=]\s*['"]/)

    const bootstrapBlock = appSource.slice(appSource.indexOf('shouldResolveBootstrap'))
    const deferIndex = bootstrapBlock.indexOf('deferAfterAuthStateChange')
    const bootstrapAwaitIndex = bootstrapBlock.indexOf('await runFirstAuthBootstrap')
    const setSessionIndex = bootstrapBlock.indexOf('setSession(')
    const setAuthReadyIndex = bootstrapBlock.indexOf('setAuthReady(')

    expect(deferIndex).toBeGreaterThan(-1)
    expect(bootstrapAwaitIndex).toBeGreaterThan(deferIndex)
    expect(setSessionIndex).toBeGreaterThan(bootstrapAwaitIndex)
    expect(setAuthReadyIndex).toBeGreaterThan(setSessionIndex)
  })

  it('deferAfterAuthStateChange prevents getSession before onAuthStateChange returns', async () => {
    vi.useFakeTimers()

    let callbackReturned = false
    let getSessionCalledBeforeCallbackReturned = false

    getSessionMock.mockImplementation(async () => {
      if (!callbackReturned) {
        getSessionCalledBeforeCallbackReturned = true
      }
      return { data: { session: { user: { id: 'oauth-user' } } }, error: null }
    })

    const simulateUnsafeAsyncIifeBootstrap = () => {
      void (async () => {
        await resolveAuthBootstrapSession('INITIAL_SESSION', null)
      })()
    }

    simulateUnsafeAsyncIifeBootstrap()
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(getSessionCalledBeforeCallbackReturned).toBe(true)

    vi.clearAllMocks()
    callbackReturned = false
    getSessionCalledBeforeCallbackReturned = false

    const simulateSafeDeferredBootstrap = () => {
      deferAfterAuthStateChange(async () => {
        await resolveAuthBootstrapSession('INITIAL_SESSION', null)
      })
    }

    simulateSafeDeferredBootstrap()
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(getSessionCalledBeforeCallbackReturned).toBe(false)

    callbackReturned = true
    await vi.runAllTimersAsync()

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(getSessionCalledBeforeCallbackReturned).toBe(false)

    vi.useRealTimers()
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

  it('isImplicitOAuthCallbackUrl detects implicit OAuth hash callbacks by parameter name', () => {
    expect(
      isImplicitOAuthCallbackUrl(
        'https://sovereign-shield-ai.vercel.app/#access_token=redacted&refresh_token=redacted',
      ),
    ).toBe(true)
    expect(
      isImplicitOAuthCallbackUrl('https://sovereign-shield-ai.vercel.app/#error=access_denied'),
    ).toBe(true)
    expect(isImplicitOAuthCallbackUrl('https://sovereign-shield-ai.vercel.app/')).toBe(false)
    expect(isImplicitOAuthCallbackUrl('https://sovereign-shield-ai.vercel.app/?code=abc')).toBe(
      false,
    )
  })

  it('restoreSessionAfterImplicitOAuthCallback reads the session via getSession', async () => {
    const session = { user: { id: 'oauth-user' } }
    getSessionMock.mockResolvedValue({ data: { session }, error: null })

    await expect(restoreSessionAfterImplicitOAuthCallback()).resolves.toBe(session)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })

  it('isAuthBootstrapEvent identifies INITIAL_SESSION and SIGNED_IN', () => {
    expect(isAuthBootstrapEvent('INITIAL_SESSION')).toBe(true)
    expect(isAuthBootstrapEvent('SIGNED_IN')).toBe(true)
    expect(isAuthBootstrapEvent('TOKEN_REFRESHED')).toBe(false)
  })

  it('resolveAuthBootstrapSession uses the event session when present', async () => {
    const session = { user: { id: 'oauth-user' } } as never

    await expect(resolveAuthBootstrapSession('INITIAL_SESSION', session)).resolves.toBe(session)
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('resolveAuthBootstrapSession falls back to getSession when INITIAL_SESSION is null', async () => {
    const session = { user: { id: 'oauth-user' } }
    getSessionMock.mockResolvedValue({ data: { session }, error: null })

    await expect(resolveAuthBootstrapSession('INITIAL_SESSION', null)).resolves.toBe(session)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })

  it('resolveAuthBootstrapSession falls back to getSession after implicit OAuth hash consumption', async () => {
    const session = { user: { id: 'oauth-user' } }
    getSessionMock.mockResolvedValue({ data: { session }, error: null })

    await expect(resolveAuthBootstrapSession('INITIAL_SESSION', null)).resolves.toBe(session)
  })
})
