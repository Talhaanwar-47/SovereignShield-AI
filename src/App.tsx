import { useCallback, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import DemoModeBanner from './components/DemoModeBanner'
import DemoOnboarding from './components/DemoOnboarding'
import Login from './Login'
import DashboardLayout from './DashboardLayout'
import {
  fetchAuthProfile,
  displayNameFromUser,
  type AuthProfile,
  type MembershipRole,
} from './services/authProfile'
import { provisionDemoMembership } from './services/demoProvisioning'
import {
  applyAuthListenerEvent,
  INITIAL_AUTH_LISTENER_STATE,
  resolveAppShellView,
  runFirstAuthBootstrap,
} from './authAppGate'
import {
  hasAuthenticatedSession,
  isImplicitOAuthCallbackUrl,
  logAuthBootstrapDiagnostic,
  signOut,
  subscribeToAuthState,
} from './services/authSession'
import { recordAuditEvent, recordMembershipAuditEvent } from './services/auditEventService'

const LOADING_PROFILE: AuthProfile = {
  displayName: 'Authenticated User',
  roleLabel: 'Authenticated',
  membershipRole: null,
  organizationName: null,
  isDemoOrganization: false,
}

async function loadProfileForUser(user: User): Promise<AuthProfile> {
  return fetchAuthProfile(user)
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [profile, setProfile] = useState<AuthProfile>(LOADING_PROFILE)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [profileEpoch, setProfileEpoch] = useState(0)

  useEffect(() => {
    let cancelled = false
    let listenerState = INITIAL_AUTH_LISTENER_STATE

    const unsubscribe = subscribeToAuthState((event, nextSession) => {
      if (cancelled) return

      const applied = applyAuthListenerEvent(listenerState, event, nextSession)
      listenerState = applied.state

      if (applied.shouldResolveBootstrap) {
        void (async () => {
          listenerState = await runFirstAuthBootstrap(event, nextSession, listenerState)

          logAuthBootstrapDiagnostic({
            event,
            eventSessionPresent: Boolean(nextSession),
            resolvedSessionPresent: Boolean(listenerState.session),
            oauthHashPresent: isImplicitOAuthCallbackUrl(),
          })

          if (cancelled) return

          setSession(listenerState.session)
          setAuthReady(listenerState.authReady)

          const user = listenerState.session?.user
          if (user) {
            recordAuditEvent({
              category: 'Authentication',
              action: event === 'SIGNED_IN' ? 'User signed in' : 'Session restored',
              actorDisplayName: displayNameFromUser(user),
              actorUserId: user.id,
              severity: 'INFO',
              result: 'SUCCESS',
              source: 'client-auth-session',
            })
          }
        })()
        return
      }

      if (!listenerState.authReady) {
        return
      }

      setSession(listenerState.session)

      const user = nextSession?.user
      if (event === 'SIGNED_IN' && user) {
        recordAuditEvent({
          category: 'Authentication',
          action: 'User signed in',
          actorDisplayName: displayNameFromUser(user),
          actorUserId: user.id,
          severity: 'INFO',
          result: 'SUCCESS',
          source: 'client-auth-session',
        })
      }

      if (event === 'SIGNED_OUT') {
        recordAuditEvent({
          category: 'Authentication',
          action: 'User signed out',
          actorDisplayName: user ? displayNameFromUser(user) : 'Authenticated user',
          actorUserId: user?.id,
          severity: 'INFO',
          result: 'SUCCESS',
          source: 'client-auth-session',
        })
      }

      if (event === 'TOKEN_REFRESHED' && user) {
        recordAuditEvent({
          category: 'System',
          action: 'Session token refreshed',
          actorDisplayName: displayNameFromUser(user),
          actorUserId: user.id,
          severity: 'INFO',
          result: 'SUCCESS',
          source: 'client-auth-session',
        })
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const user = session?.user
    if (!user) return

    let cancelled = false

    void (async () => {
      const next = await loadProfileForUser(user)
      if (!cancelled) {
        setProfile(next)
        setProfileUserId(user.id)
        recordMembershipAuditEvent({
          actorDisplayName: next.displayName,
          actorUserId: user.id,
          membershipRole: next.membershipRole,
          roleLabel: next.roleLabel,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [session, profileEpoch])

  const handleDemoRoleSelection = useCallback(
    async (role: MembershipRole) => {
      const user = session?.user
      if (!user) throw new Error('Not authenticated')

      const result = await provisionDemoMembership(role)
      if (!result.ok) {
        throw new Error(result.message)
      }

      const next = await loadProfileForUser(user)
      setProfile(next)
      setProfileUserId(user.id)
      setProfileEpoch((value) => value + 1)

      recordAuditEvent({
        category: 'Authentication',
        action: `Demo role provisioned: ${result.role}`,
        actorDisplayName: next.displayName,
        actorUserId: user.id,
        severity: 'INFO',
        result: 'SUCCESS',
        source: 'demo-provisioning',
      })

      recordMembershipAuditEvent({
        actorDisplayName: next.displayName,
        actorUserId: user.id,
        membershipRole: next.membershipRole,
        roleLabel: next.roleLabel,
      })
    },
    [session],
  )

  const handleLogout = async () => {
    await signOut()
  }

  const isAuthenticated = hasAuthenticatedSession(session)
  const activeUser = session?.user
  const profileResolved = Boolean(activeUser && profileUserId === activeUser.id)
  const resolvedProfile = profileResolved ? profile : LOADING_PROFILE

  if (!activeUser && profileUserId !== null) {
    setProfile(LOADING_PROFILE)
    setProfileUserId(null)
  }

  const dashboardKey = activeUser
    ? `${activeUser.id}:${resolvedProfile.membershipRole ?? 'none'}:${profileEpoch}`
    : 'anonymous'

  const shellView = resolveAppShellView({
    authReady,
    session,
    profileUserId,
    profile: resolvedProfile,
  })

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#0b0f1a] text-white">
      <DemoModeBanner isAuthenticated={isAuthenticated} />
      <div className="w-full flex-1">
        {shellView === 'loading-auth' ? (
          <div className="flex min-h-screen items-center justify-center text-sm text-white/50">
            Checking session…
          </div>
        ) : shellView === 'login' ? (
          <Login />
        ) : shellView === 'loading-profile' ? (
          <div
            className="flex min-h-screen items-center justify-center text-sm text-white/50"
            role="status"
            aria-live="polite"
          >
            Checking organization access…
          </div>
        ) : shellView === 'dashboard' ? (
          <DashboardLayout
            key={dashboardKey}
            displayName={resolvedProfile.displayName}
            roleLabel={resolvedProfile.roleLabel}
            membershipRole={resolvedProfile.membershipRole!}
            userId={activeUser!.id}
            organizationName={resolvedProfile.organizationName}
            isDemoOrganization={resolvedProfile.isDemoOrganization}
            onSwitchDemoRole={
              resolvedProfile.isDemoOrganization ? handleDemoRoleSelection : undefined
            }
            onLogout={() => {
              void handleLogout()
            }}
          />
        ) : shellView === 'demo-onboarding' ? (
          <DemoOnboarding
            displayName={resolvedProfile.displayName}
            onSelectRole={handleDemoRoleSelection}
            onLogout={() => {
              void handleLogout()
            }}
          />
        ) : (
          <div
            className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-white/50"
            role="alert"
          >
            Organization access could not be resolved. Please sign out and try again, or contact
            your administrator.
          </div>
        )}
      </div>
    </div>
  )
}
