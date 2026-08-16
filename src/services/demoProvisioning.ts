import type { MembershipRole } from './authProfile'
import { supabase } from '../supabaseClient'

export type DemoProvisionResult =
  | { ok: true; role: MembershipRole }
  | { ok: false; message: string }

const ALLOWED_DEMO_ROLES: MembershipRole[] = ['admin', 'fleet-manager', 'driver']

function normalizeProvisionError(error: { message?: string } | null): string {
  const message = error?.message?.trim() ?? ''
  if (!message) return 'Unable to provision demo access. Please try again.'
  if (message.includes('Production organization members')) {
    return 'Your account already has production organization access.'
  }
  if (message.includes('Invalid demo role')) {
    return 'The selected demo role is not allowed.'
  }
  if (message.includes('Unauthorized')) {
    return 'Authentication is required to enter demo mode.'
  }
  return 'Unable to provision demo access. Please try again.'
}

/**
 * Provisions or updates demo organization membership via server-trusted RPC.
 * Client role selection alone is never sufficient — the RPC enforces demo org + role allowlist.
 */
export async function provisionDemoMembership(
  role: MembershipRole,
): Promise<DemoProvisionResult> {
  if (!ALLOWED_DEMO_ROLES.includes(role)) {
    return { ok: false, message: 'The selected demo role is not allowed.' }
  }

  const { data, error } = await supabase.rpc('provision_demo_membership', {
    p_role: role,
  })

  if (error) {
    return { ok: false, message: normalizeProvisionError(error) }
  }

  const resolvedRole =
    typeof data === 'object' &&
    data !== null &&
    'role' in data &&
    (data.role === 'admin' || data.role === 'fleet-manager' || data.role === 'driver')
      ? data.role
      : role

  return { ok: true, role: resolvedRole }
}
