import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import appSource from '../App.tsx?raw'
import loginSource from '../Login.tsx?raw'
import dashboardSource from '../DashboardLayout.tsx?raw'
import demoBannerSource from '../components/DemoModeBanner.tsx?raw'
import noAccessSource from '../components/NoOrganizationAccess.tsx?raw'
import demoOnboardingSource from '../components/DemoOnboarding.tsx?raw'
import demoRoleSwitchSource from '../components/DemoRoleSwitch.tsx?raw'
import demoProvisioningSource from './demoProvisioning.ts?raw'
import fleetServiceSource from './fleetService.ts?raw'

const { fromMock, selectMock, eqMock, orderMock, signOutMock } = vi.hoisted(() => {
  const orderMock = vi.fn()
  const eqMock = vi.fn(() => ({ order: orderMock }))
  const selectMock = vi.fn(() => ({ eq: eqMock }))
  const fromMock = vi.fn(() => ({ select: selectMock }))
  const signOutMock = vi.fn()
  return { fromMock, selectMock, eqMock, orderMock, signOutMock }
})

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: fromMock,
    auth: {
      signOut: signOutMock,
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithOAuth: vi.fn(),
    },
  },
}))

import {
  avatarInitialFromDisplayName,
  displayNameFromUser,
  fetchAuthProfile,
  formatMembershipRoleLabel,
  hasOrganizationMembership,
  parseMembershipRole,
  resolveMembershipProfile,
  isDemoEligible,
} from './authProfile'
import { signOut } from './authSession'

function user(partial: Partial<User> & Pick<User, 'id'>): User {
  return {
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '',
    ...partial,
  } as User
}

describe('displayNameFromUser', () => {
  it('uses user_metadata.full_name when present', () => {
    expect(
      displayNameFromUser(
        user({
          id: 'u1',
          email: 'fallback@example.com',
          user_metadata: { full_name: '  Ada Lovelace  ', name: 'Ignored' },
        }),
      ),
    ).toBe('Ada Lovelace')
  })

  it('falls back to user_metadata.name', () => {
    expect(
      displayNameFromUser(
        user({
          id: 'u1',
          email: 'fallback@example.com',
          user_metadata: { name: 'Grace Hopper' },
        }),
      ),
    ).toBe('Grace Hopper')
  })

  it('falls back to email', () => {
    expect(
      displayNameFromUser(
        user({
          id: 'u1',
          email: 'founder@example.com',
          user_metadata: {},
        }),
      ),
    ).toBe('founder@example.com')
  })

  it('uses Authenticated User as final fallback', () => {
    expect(displayNameFromUser(user({ id: 'u1', user_metadata: {} }))).toBe(
      'Authenticated User',
    )
    expect(displayNameFromUser(null)).toBe('Authenticated User')
  })
})

describe('membership role mapping', () => {
  it('maps known membership roles', () => {
    expect(formatMembershipRoleLabel('admin')).toBe('Admin')
    expect(formatMembershipRoleLabel('fleet-manager')).toBe('Fleet Manager')
    expect(formatMembershipRoleLabel('driver')).toBe('Driver')
  })

  it('uses neutral Authenticated when membership is missing or unknown', () => {
    expect(formatMembershipRoleLabel(undefined)).toBe('Authenticated')
    expect(formatMembershipRoleLabel('superuser')).toBe('Authenticated')
    expect(parseMembershipRole('superuser')).toBeNull()
    expect(resolveMembershipProfile([])).toEqual({
      roleLabel: 'Authenticated',
      membershipRole: null,
      organizationName: null,
      isDemoOrganization: false,
    })
  })

  it('uses a single membership role and org name deterministically', () => {
    expect(
      resolveMembershipProfile([
        {
          role: 'admin',
          organization_id: 'org-1',
          organizations: { name: 'SovereignShield Fleet' },
        },
      ]),
    ).toEqual({
      roleLabel: 'Admin',
      membershipRole: 'admin',
      organizationName: 'SovereignShield Fleet',
      isDemoOrganization: false,
    })

    expect(
      resolveMembershipProfile([
        {
          role: 'fleet-manager',
          organization_id: 'org-1',
          organizations: { name: 'SovereignShield Fleet' },
        },
      ]),
    ).toEqual({
      roleLabel: 'Fleet Manager',
      membershipRole: 'fleet-manager',
      organizationName: 'SovereignShield Fleet',
      isDemoOrganization: false,
    })

    expect(
      resolveMembershipProfile([
        {
          role: 'driver',
          organization_id: 'org-1',
          organizations: { name: 'SovereignShield Fleet' },
        },
      ]),
    ).toEqual({
      roleLabel: 'Driver',
      membershipRole: 'driver',
      organizationName: 'SovereignShield Fleet',
      isDemoOrganization: false,
    })
  })

  it('marks demo organization membership and prefers production when both exist', () => {
    expect(
      resolveMembershipProfile([
        {
          role: 'admin',
          organization_id: 'demo-org',
          organizations: { name: 'SovereignShield Demo' },
        },
      ]),
    ).toEqual({
      roleLabel: 'Admin',
      membershipRole: 'admin',
      organizationName: 'SovereignShield Demo',
      isDemoOrganization: true,
    })

    expect(
      resolveMembershipProfile([
        {
          role: 'admin',
          organization_id: 'prod-org',
          organizations: { name: 'SovereignShield Fleet' },
        },
        {
          role: 'driver',
          organization_id: 'demo-org',
          organizations: { name: 'SovereignShield Demo' },
        },
      ]),
    ).toEqual({
      roleLabel: 'Admin',
      membershipRole: 'admin',
      organizationName: 'SovereignShield Fleet',
      isDemoOrganization: false,
    })
  })

  it('does not invent an organization when multiple memberships exist', () => {
    expect(
      resolveMembershipProfile([
        {
          role: 'admin',
          organization_id: 'org-1',
          organizations: { name: 'Org A' },
        },
        {
          role: 'admin',
          organization_id: 'org-2',
          organizations: { name: 'Org B' },
        },
      ]),
    ).toEqual({
      roleLabel: 'Admin',
      membershipRole: 'admin',
      organizationName: null,
      isDemoOrganization: false,
    })

    expect(
      resolveMembershipProfile([
        {
          role: 'admin',
          organization_id: 'org-1',
          organizations: { name: 'Org A' },
        },
        {
          role: 'driver',
          organization_id: 'org-2',
          organizations: { name: 'Org B' },
        },
      ]),
    ).toEqual({
      roleLabel: 'Authenticated',
      membershipRole: null,
      organizationName: null,
      isDemoOrganization: false,
    })
  })
})

describe('fetchAuthProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    orderMock.mockResolvedValue({
      data: [
        {
          role: 'admin',
          organization_id: 'org-1',
          organizations: { name: 'SovereignShield Fleet' },
        },
      ],
      error: null,
    })
  })

  it('queries organization_members by authenticated user.id only', async () => {
    const profile = await fetchAuthProfile(
      user({
        id: 'ca5316b3-8872-45f4-9617-06d758f19f49',
        user_metadata: { full_name: 'Founding Admin' },
      }),
    )

    expect(fromMock).toHaveBeenCalledWith('organization_members')
    expect(selectMock).toHaveBeenCalledWith('role, organization_id, organizations(name)')
    expect(eqMock).toHaveBeenCalledWith('user_id', 'ca5316b3-8872-45f4-9617-06d758f19f49')
    expect(profile).toEqual({
      displayName: 'Founding Admin',
      roleLabel: 'Admin',
      membershipRole: 'admin',
      organizationName: 'SovereignShield Fleet',
      isDemoOrganization: false,
    })
  })

  it('keeps a neutral role when membership cannot be loaded', async () => {
    orderMock.mockResolvedValue({ data: null, error: { message: 'denied' } })

    const profile = await fetchAuthProfile(
      user({
        id: 'user-without-membership',
        email: 'memberless@example.com',
      }),
    )

    expect(profile).toEqual({
      displayName: 'memberless@example.com',
      roleLabel: 'Authenticated',
      membershipRole: null,
      organizationName: null,
      isDemoOrganization: false,
    })
  })
})

describe('hasOrganizationMembership', () => {
  it('returns true for Admin, Fleet Manager, and Driver profiles', () => {
    expect(hasOrganizationMembership({ membershipRole: 'admin' })).toBe(true)
    expect(hasOrganizationMembership({ membershipRole: 'fleet-manager' })).toBe(true)
    expect(hasOrganizationMembership({ membershipRole: 'driver' })).toBe(true)
  })

  it('returns false when membership is missing or ambiguous', () => {
    expect(hasOrganizationMembership({ membershipRole: null })).toBe(false)
  })
})

describe('isDemoEligible', () => {
  it('returns true when membership is missing', () => {
    expect(isDemoEligible({ membershipRole: null })).toBe(true)
  })

  it('returns false when membership is granted', () => {
    expect(isDemoEligible({ membershipRole: 'admin' })).toBe(false)
  })
})

describe('membership access gate', () => {
  it('resolves membership before rendering the dashboard shell', () => {
    expect(appSource).toContain('fetchAuthProfile(user)')
    expect(appSource).toContain('profileResolved')
    expect(appSource).toContain('membershipGranted')
    expect(appSource).toContain('hasOrganizationMembership')
    expect(appSource).toContain('Checking organization access')
    expect(appSource).toContain('<DemoOnboarding')
    expect(appSource.indexOf('fetchAuthProfile(user)')).toBeLessThan(
      appSource.indexOf('<DashboardLayout'),
    )
    expect(appSource.indexOf('!profileResolved')).toBeLessThan(
      appSource.indexOf('<DashboardLayout'),
    )
    expect(appSource.indexOf('membershipGranted')).toBeLessThan(
      appSource.indexOf('<DashboardLayout'),
    )
  })

  it('offers demo onboarding to authenticated users without membership', () => {
    expect(demoOnboardingSource).toContain('Explore SovereignShield AI')
    expect(demoOnboardingSource).toContain('DEMO_ROLE_OPTIONS')
    expect(demoOnboardingSource).toContain('onSelectRole')
    expect(appSource).toContain('demoEligible')
    expect(appSource).toContain('isDemoEligible')
    expect(appSource.indexOf('demoEligible')).toBeLessThan(
      appSource.indexOf('<DemoOnboarding'),
    )
    expect(appSource).toContain('demoEligible ? (')
    expect(appSource).toContain('<DemoOnboarding')
    expect(noAccessSource).toContain('No organization access')
  })

  it('allows valid members through to DashboardLayout with resolved membershipRole', () => {
    expect(appSource).toMatch(/membershipGranted[\s\S]*<DashboardLayout/)
    expect(appSource).toContain('membershipRole={resolvedProfile.membershipRole}')
    expect(appSource).toContain('isDemoOrganization={resolvedProfile.isDemoOrganization}')
    expect(appSource).toContain('provisionDemoMembership')
    expect(demoProvisioningSource).toContain("supabase.rpc('provision_demo_membership'")
    expect(loginSource).toContain('cosmetic only')
    expect(appSource).not.toMatch(/setRole|UserRole/)
  })

  it('does not mount org-scoped data loaders before membership is granted', () => {
    expect(dashboardSource).toContain('if (membershipRole == null) return')
    expect(fleetServiceSource).toContain("from('drivers')")
    expect(fleetServiceSource).toContain("from('vehicles')")
    expect(appSource).not.toContain("from('drivers')")
    expect(appSource).not.toContain("from('vehicles')")
    expect(appSource).not.toContain('fetchDrivers')
    expect(appSource).not.toContain('fetchVehicles')
    expect(appSource.indexOf('<DashboardLayout')).toBeGreaterThan(
      appSource.indexOf('membershipGranted'),
    )
  })
})

describe('profile wiring and security guards', () => {
  it('keeps logout wired to supabase.auth.signOut', async () => {
    signOutMock.mockResolvedValue({ error: null })
    await signOut()
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(appSource).toContain('await signOut()')
    expect(appSource).toContain('onLogout')
  })

  it('does not use the Login role selector for authorization or profile role', () => {
    expect(loginSource).toContain('Demo role (display only)')
    expect(loginSource).toContain('cosmetic only')
    expect(appSource).not.toContain('role={')
    expect(appSource).not.toMatch(/setRole|UserRole/)
    expect(appSource).toContain('fetchAuthProfile(user)')
    expect(appSource).toContain('session?.user')
    expect(appSource).toContain('membershipRole={resolvedProfile.membershipRole}')
    expect(appSource).toContain('userId={activeUser.id}')
    expect(appSource).toContain('dashboardKey')
    expect(dashboardSource).toContain('DemoRoleSwitch')
    expect(dashboardSource).toContain('onSwitchDemoRole')
    expect(demoRoleSwitchSource).toContain('Switch Demo Role')
    expect(demoRoleSwitchSource).toContain('Switch demo perspective')
    expect(appSource).toContain('setProfile(LOADING_PROFILE)')
    expect(appSource).toContain('setProfileUserId(null)')
    expect(appSource).toContain('if (!activeUser && profileUserId !== null)')
    expect(appSource.indexOf('if (!activeUser && profileUserId !== null)')).toBeLessThan(
      appSource.indexOf('<Login />'),
    )
    expect(dashboardSource).toContain('DemoGuidePanel')
    expect(dashboardSource).toContain('ProductOverviewPanel')
    expect(dashboardSource).toContain('displayName')
    expect(dashboardSource).toContain('roleLabel')
    expect(dashboardSource).toContain('membershipRole')
    expect(dashboardSource).not.toContain("from './Login'")
  })

  it('does not claim authentication is simulated when authenticated', () => {
    expect(demoBannerSource).toContain('isAuthenticated')
    expect(demoBannerSource).toContain('Vehicle telemetry is simulated')
    expect(demoBannerSource).toContain('DEMO_MODE_LABEL')
    expect(avatarInitialFromDisplayName('Ada Lovelace')).toBe('A')
  })
})
