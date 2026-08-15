import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from './authProfile'
import { provisionDemoMembership } from './demoProvisioning'

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: rpcMock,
  },
}))

describe('provisionDemoMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls provision_demo_membership RPC with allowed role', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, role: 'admin' },
      error: null,
    })

    const result = await provisionDemoMembership('admin')

    expect(rpcMock).toHaveBeenCalledWith('provision_demo_membership', { p_role: 'admin' })
    expect(result).toEqual({ ok: true, role: 'admin' })
  })

  it('rejects invalid roles without calling RPC', async () => {
    const result = await provisionDemoMembership('superuser' as MembershipRole)

    expect(rpcMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, message: 'The selected demo role is not allowed.' })
  })

  it('maps production member RPC rejection to friendly message', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Production organization members cannot use demo provisioning' },
    })

    const result = await provisionDemoMembership('driver')

    expect(result).toEqual({
      ok: false,
      message: 'Your account already has production organization access.',
    })
  })

  it('supports all three demo roles', async () => {
    for (const role of ['admin', 'fleet-manager', 'driver'] as const) {
      rpcMock.mockResolvedValueOnce({ data: { ok: true, role }, error: null })
      const result = await provisionDemoMembership(role)
      expect(result).toEqual({ ok: true, role })
    }
  })
})
