import type { User } from '@supabase/supabase-js'
import {
  DEMO_ORGANIZATION_NAME,
  PRODUCTION_ORGANIZATION_NAME,
} from '../constants/demoOrganization'
import { supabase } from '../supabaseClient'

export type MembershipRole = 'admin' | 'fleet-manager' | 'driver'

export type AuthProfile = {
  displayName: string
  roleLabel: string
  /** Real `organization_members.role` only — never Login selector. */
  membershipRole: MembershipRole | null
  organizationName: string | null
  /** True when the active membership is the isolated demo tenant. */
  isDemoOrganization: boolean
}

const NEUTRAL_ROLE_LABEL = 'Authenticated'
const FALLBACK_DISPLAY_NAME = 'Authenticated User'

type MembershipRow = {
  role: string
  organization_id: string
  organizations: { name: string } | { name: string }[] | null
}

/**
 * Display-only name from the verified Supabase Auth user.
 * Never uses Login role selector or client-invented identity.
 */
export function displayNameFromUser(user: User | null | undefined): string {
  if (!user) return FALLBACK_DISPLAY_NAME

  const metadata = user.user_metadata ?? {}
  const fullName =
    typeof metadata.full_name === 'string' ? metadata.full_name.trim() : ''
  if (fullName) return fullName

  const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  if (name) return name

  const email = typeof user.email === 'string' ? user.email.trim() : ''
  if (email) return email

  return FALLBACK_DISPLAY_NAME
}

/** Narrows DB role strings to known membership roles. */
export function parseMembershipRole(role: string | null | undefined): MembershipRole | null {
  if (role === 'admin' || role === 'fleet-manager' || role === 'driver') return role
  return null
}

/** Maps DB membership role → UI label. Unknown values stay neutral. */
export function formatMembershipRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'fleet-manager':
      return 'Fleet Manager'
    case 'driver':
      return 'Driver'
    default:
      return NEUTRAL_ROLE_LABEL
  }
}

export function organizationNameFromRow(row: MembershipRow): string | null {
  const org = row.organizations
  if (!org) return null
  if (Array.isArray(org)) {
    const name = org[0]?.name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  }
  return typeof org.name === 'string' && org.name.trim() ? org.name.trim() : null
}

function resolveRowsForActiveOrganization(rows: MembershipRow[]): MembershipRow[] {
  const productionRows = rows.filter(
    (row) => organizationNameFromRow(row) === PRODUCTION_ORGANIZATION_NAME,
  )
  if (productionRows.length > 0) return productionRows

  const demoRows = rows.filter(
    (row) => organizationNameFromRow(row) === DEMO_ORGANIZATION_NAME,
  )
  if (demoRows.length > 0) return demoRows

  return rows
}

function isDemoOrganizationName(name: string | null): boolean {
  return name === DEMO_ORGANIZATION_NAME
}

/**
 * Deterministic membership profile for display + app gating.
 * Production org membership takes precedence over demo org membership.
 * - 0 rows → neutral role, no org name
 * - 1 row → that membership role + org name (if RLS returns it)
 * - >1 rows in same scope → role only if every row shares the same role
 */
export function resolveMembershipProfile(rows: MembershipRow[]): Pick<
  AuthProfile,
  'roleLabel' | 'membershipRole' | 'organizationName' | 'isDemoOrganization'
> {
  if (rows.length === 0) {
    return {
      roleLabel: NEUTRAL_ROLE_LABEL,
      membershipRole: null,
      organizationName: null,
      isDemoOrganization: false,
    }
  }

  const scopedRows = resolveRowsForActiveOrganization(rows)

  if (scopedRows.length === 1) {
    const orgName = organizationNameFromRow(scopedRows[0])
    const membershipRole = parseMembershipRole(scopedRows[0].role)
    return {
      roleLabel: formatMembershipRoleLabel(scopedRows[0].role),
      membershipRole,
      organizationName: orgName,
      isDemoOrganization: isDemoOrganizationName(orgName),
    }
  }

  const roles = new Set(scopedRows.map((row) => row.role))
  if (roles.size === 1) {
    const membershipRole = parseMembershipRole(scopedRows[0].role)
    return {
      roleLabel: formatMembershipRoleLabel(scopedRows[0].role),
      membershipRole,
      organizationName: null,
      isDemoOrganization: scopedRows.every((row) =>
        isDemoOrganizationName(organizationNameFromRow(row)),
      ),
    }
  }

  return {
    roleLabel: NEUTRAL_ROLE_LABEL,
    membershipRole: null,
    organizationName: null,
    isDemoOrganization: false,
  }
}

/**
 * Loads membership display fields via the authenticated client + RLS.
 * Uses session user.id only — never Login UI role / organization_id.
 */
export async function fetchAuthProfile(user: User): Promise<AuthProfile> {
  const displayName = displayNameFromUser(user)

  const { data, error } = await supabase
    .from('organization_members')
    .select('role, organization_id, organizations(name)')
    .eq('user_id', user.id)
    .order('organization_id', { ascending: true })

  if (error || !data) {
    return {
      displayName,
      roleLabel: NEUTRAL_ROLE_LABEL,
      membershipRole: null,
      organizationName: null,
      isDemoOrganization: false,
    }
  }

  const membership = resolveMembershipProfile(data as MembershipRow[])
  return {
    displayName,
    roleLabel: membership.roleLabel,
    membershipRole: membership.membershipRole,
    organizationName: membership.organizationName,
    isDemoOrganization: membership.isDemoOrganization,
  }
}

export function avatarInitialFromDisplayName(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed || trimmed === FALLBACK_DISPLAY_NAME) return 'A'
  return trimmed.charAt(0).toUpperCase()
}

/** True when RLS-backed membership resolved to a known org role. */
export function hasOrganizationMembership(
  profile: Pick<AuthProfile, 'membershipRole'>,
): profile is AuthProfile & { membershipRole: MembershipRole } {
  return profile.membershipRole !== null
}

/** True when the user has no membership and may enter public demo onboarding. */
export function isDemoEligible(
  profile: Pick<AuthProfile, 'membershipRole'>,
): boolean {
  return profile.membershipRole === null
}
