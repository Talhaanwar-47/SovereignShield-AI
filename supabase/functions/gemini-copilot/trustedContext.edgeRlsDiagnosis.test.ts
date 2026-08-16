import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { buildTrustedCopilotContext, fetchAuthorizedFleetData } from './trustedContext'

/**
 * STEP 26B-FIX-EDGE-RLS — temporary diagnosis harness.
 *
 * Reproduces the live DB state (EE-FLEET-991 -> cf96b4cf... -> Jürgen Tamm) against
 * the Edge read path to separate four candidate causes: JWT propagation, RLS policy,
 * query shape, and error handling. No production behavior is changed by this file.
 */

const functionDir = dirname(fileURLToPath(import.meta.url))
const trustedContextSource = readFileSync(join(functionDir, 'trustedContext.ts'), 'utf8')
const indexSource = readFileSync(join(functionDir, 'index.ts'), 'utf8')
const fleetServiceSource = readFileSync(
  join(functionDir, '../../../src/services/fleetService.ts'),
  'utf8',
)

/** Confirmed live values supplied by STEP 26B-FIX-LIVE-CHECK. */
const JURGEN_DRIVER_ID = 'cf96b4cf-910b-4452-93ce-22085077977c'
const JURGEN_NAME = 'Jürgen Tamm'

const liveVehicles = [
  {
    id: 'b6160f57-792b-4e27-8c5b-4693d141511a',
    asset_id: 'EE-FLEET-991',
    assigned_driver_id: JURGEN_DRIVER_ID,
    compliance_tier: 'OPTIMAL CLEARANCE',
  },
]

const liveDrivers = [
  { id: JURGEN_DRIVER_ID, name: JURGEN_NAME, expiry_date: '12 / 11 / 2026', user_id: null },
]

/**
 * Mocks the RLS-scoped client with independent control over the two `drivers` reads:
 * the registry list (`select` then await) and the assignment name lookup (`.in()`).
 */
function mockClient(options: {
  vehicles?: typeof liveVehicles
  vehicleError?: { message: string } | null
  registryRows?: typeof liveDrivers
  registryError?: { message: string } | null
  nameLookupRows?: Array<{ id: string; name: string }>
  nameLookupError?: { message: string } | null
}) {
  const registryResult = {
    data: options.registryError ? null : (options.registryRows ?? liveDrivers),
    error: options.registryError ?? null,
  }
  const nameLookupResult = {
    data: options.nameLookupError ? null : (options.nameLookupRows ?? [
      { id: JURGEN_DRIVER_ID, name: JURGEN_NAME },
    ]),
    error: options.nameLookupError ?? null,
  }
  const vehicleResult = {
    data: options.vehicleError ? null : (options.vehicles ?? liveVehicles),
    error: options.vehicleError ?? null,
  }

  const inMock = vi.fn().mockResolvedValue(nameLookupResult)
  const driversSelect = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue(registryResult),
    in: inMock,
    then(onFulfilled: (value: typeof registryResult) => unknown) {
      return Promise.resolve(registryResult).then(onFulfilled)
    },
  }))
  const vehiclesSelect = vi.fn(() => Promise.resolve(vehicleResult))

  const from = vi.fn((table: string) => {
    if (table === 'drivers') return { select: driversSelect }
    if (table === 'vehicles') return { select: vehiclesSelect }
    return { select: vi.fn() }
  })

  return { from, driversSelect, vehiclesSelect, inMock }
}

function runAdmin(client: { from: ReturnType<typeof mockClient>['from'] }) {
  return fetchAuthorizedFleetData(
    client as unknown as Parameters<typeof fetchAuthorizedFleetData>[0],
    'ca5316b3-8872-45f4-9617-06d758f19f49',
    'admin',
  )
}

describe('STEP 26B-FIX-EDGE-RLS — Edge assignment read path', () => {
  it('control: live DB state resolves EE-FLEET-991 -> Jürgen Tamm when both reads succeed', async () => {
    const client = mockClient({})
    const context = buildTrustedCopilotContext({ fleetData: await runAdmin(client) })

    expect(context.assignments).toEqual([`EE-FLEET-991 -> ${JURGEN_NAME}`])
  })

  it('cause A: an RLS-denied drivers name lookup is silently downgraded to Unassigned', async () => {
    const client = mockClient({ nameLookupError: { message: 'permission denied for table drivers' } })
    const fleetData = await runAdmin(client)
    const context = buildTrustedCopilotContext({ fleetData })

    // assigned_driver_id was present and readable, yet the assignment disappears.
    expect(client.inMock).toHaveBeenCalledWith('id', [JURGEN_DRIVER_ID])
    expect(context.assignments).toEqual(['EE-FLEET-991 -> Unassigned'])
    // The registry read still surfaces the same driver, so the two disagree in one context.
    expect(context.licenseExpiry).toContain(`${JURGEN_NAME} -> 12 / 11 / 2026`)
  })

  it('cause A: an empty (RLS-filtered) name lookup is indistinguishable from a real error', async () => {
    const errored = mockClient({ nameLookupError: { message: 'permission denied' } })
    const filtered = mockClient({ nameLookupRows: [] })

    const erroredContext = buildTrustedCopilotContext({ fleetData: await runAdmin(errored) })
    const filteredContext = buildTrustedCopilotContext({ fleetData: await runAdmin(filtered) })

    expect(erroredContext.assignments).toEqual(filteredContext.assignments)
  })

  it('cause A: fetchAssignedDriverNames discards the Postgres error without signalling', () => {
    expect(trustedContextSource).toContain('if (error || !data) return names')
    // No diagnostic surface: the failure never reaches the caller or the logs.
    const fn = trustedContextSource.slice(
      trustedContextSource.indexOf('async function fetchAssignedDriverNames'),
      trustedContextSource.indexOf('function mapVehiclesWithAssignments') > -1
        ? trustedContextSource.indexOf('function mapVehiclesWithAssignments')
        : trustedContextSource.indexOf('export async function fetchAuthorizedFleetData'),
    )
    expect(fn).not.toContain('console.')
    expect(fn).not.toContain('throw')
  })

  it('not the cause: Edge and client use an identical name-lookup query shape', () => {
    // Edge: userClient.from('drivers').select('id,name').in('id', uniqueIds)
    expect(trustedContextSource).toContain(".from('drivers')")
    expect(trustedContextSource).toContain(".select('id,name')")
    expect(trustedContextSource).toContain(".in('id', uniqueIds)")

    // Client: identical columns and filter via ASSIGNED_DRIVER_NAME_COLUMNS.
    expect(fleetServiceSource).toContain("ASSIGNED_DRIVER_NAME_COLUMNS = 'id,name'")
    expect(fleetServiceSource).toContain('.in(\'id\', uniqueIds)')
  })

  it('not the cause: vehicles select carries assigned_driver_id on both paths', () => {
    expect(trustedContextSource).toContain("'id,asset_id,assigned_driver_id,compliance_tier'")
    expect(fleetServiceSource).toContain('assigned_driver_id')
  })

  it('not the cause: Edge forwards the caller JWT as the PostgREST Authorization header', () => {
    expect(indexSource).toContain('Authorization: `Bearer ${bearer}`')
    expect(indexSource).toContain("Deno.env.get('SUPABASE_ANON_KEY')")
    expect(indexSource).not.toContain('SERVICE_ROLE')
  })

  it('membership asymmetry: Edge refuses multi-role membership that the client tolerates', async () => {
    // resolveMembershipRoleForUser returns null when roles.size !== 1 -> 403, not Unassigned.
    expect(trustedContextSource).toContain('if (roles.size !== 1) return null')
  })

  it('vehicles RLS denial removes assignments entirely rather than reporting Unassigned', async () => {
    const client = mockClient({ vehicleError: { message: 'permission denied for table vehicles' } })
    const context = buildTrustedCopilotContext({ fleetData: await runAdmin(client) })

    expect(context.assignments).toEqual([])
  })
})
