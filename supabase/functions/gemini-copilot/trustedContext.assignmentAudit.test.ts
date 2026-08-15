import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { buildSystemInstruction, parseCopilotRequest } from './helpers'
import { buildFleetCopilotContext } from '../../../src/services/geminiCopilotHelpers'
import {
  buildTrustedCopilotContext,
  fetchAuthorizedFleetData,
  type AuthorizedFleetData,
} from './trustedContext'

const functionDir = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(functionDir, '../../migrations')
const migration1Sql = readFileSync(
  join(migrationsDir, '20260816000000_create_driver_pii_and_assignment_columns.sql'),
  'utf8',
)
const geminiCopilotSource = readFileSync(
  join(functionDir, '../../../src/services/geminiCopilot.ts'),
  'utf8',
)

/** Discovered driver UUIDs from STEP 18 ownership migration. */
const JURGEN_DRIVER_ID = 'cf96b4cf-910b-4452-93ce-22085077977c'
const MARI_DRIVER_ID = 'ba05b0eb-6542-45a0-b350-9bf5ae2d35c7'

const canonicalVehiclesUnassigned = [
  {
    id: 'b6160f57-792b-4e27-8c5b-4693d141511a',
    asset_id: 'EE-FLEET-991',
    assigned_driver_id: null,
    compliance_tier: 'OPTIMAL CLEARANCE',
  },
  {
    id: '5878cb48-9164-4c13-9b42-c161179065e0',
    asset_id: 'EE-FLEET-402',
    assigned_driver_id: null,
    compliance_tier: 'DOCK CHARGING',
  },
  {
    id: 'b2e3d711-7183-42b4-b673-43bd857e9512',
    asset_id: 'EE-FLEET-118',
    assigned_driver_id: null,
    compliance_tier: 'CRITICAL WARNING',
  },
]

const canonicalDrivers = [
  {
    id: JURGEN_DRIVER_ID,
    name: 'Jürgen Tamm',
    expiry_date: '12 / 11 / 2026',
    user_id: null,
  },
  {
    id: MARI_DRIVER_ID,
    name: 'Mari Ots',
    expiry_date: '01 / 01 / 2020',
    user_id: null,
  },
]

function mockAdminFleetClient(options: {
  vehicles: typeof canonicalVehiclesUnassigned
  drivers: typeof canonicalDrivers
  vehicleError?: { message: string } | null
  driverError?: { message: string } | null
  assignedNameRows?: Array<{ id: string; name: string }>
}) {
  const driverListResult = {
    data: options.driverError ? null : options.drivers,
    error: options.driverError ?? null,
  }
  const vehicleListResult = {
    data: options.vehicleError ? null : options.vehicles,
    error: options.vehicleError ?? null,
  }

  const assignedIds = options.vehicles
    .map((row) => row.assigned_driver_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const assignedNameRows =
    options.assignedNameRows ??
    options.drivers.filter((row) => assignedIds.includes(row.id)).map((row) => ({
      id: row.id,
      name: row.name,
    }))

  const driversSelect = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue(driverListResult),
    in: vi.fn().mockResolvedValue({
      data: assignedNameRows,
      error: null,
    }),
    then(onFulfilled: (value: typeof driverListResult) => unknown) {
      return Promise.resolve(driverListResult).then(onFulfilled)
    },
  }))

  const vehiclesSelect = vi.fn(() => Promise.resolve(vehicleListResult))

  const fromMock = vi.fn((table: string) => {
    if (table === 'drivers') return { select: driversSelect }
    if (table === 'vehicles') return { select: vehiclesSelect }
    return { select: vi.fn() }
  })

  return { fromMock, driversSelect, vehiclesSelect }
}

describe('STEP 26B assignment audit — server-trusted Copilot path', () => {
  it('documents canonical migrations leaving vehicles.assigned_driver_id NULL', () => {
    expect(migration1Sql).toContain('expected 0 vehicles.assigned_driver_id assignments')
    expect(migration1Sql).toContain('Does NOT assign drivers.user_id or vehicles.assigned_driver_id')
  })

  it('1–4: Admin path resolves vehicles, null assignment, and driver names separately', async () => {
    const { fromMock } = mockAdminFleetClient({
      vehicles: canonicalVehiclesUnassigned,
      drivers: canonicalDrivers,
    })

    const fleetData = await fetchAuthorizedFleetData(
      { from: fromMock } as unknown as Parameters<typeof fetchAuthorizedFleetData>[0],
      'ca5316b3-8872-45f4-9617-06d758f19f49',
      'admin',
    )

    expect(fleetData.assets.map((asset) => asset.assetId)).toContain('EE-FLEET-991')
    expect(fleetData.assets.every((asset) => asset.driverName === 'Unassigned')).toBe(true)
    expect(fleetData.drivers.some((driver) => driver.fullName === 'Jürgen Tamm')).toBe(true)
  })

  it('5: canonical DB produces Unassigned rows — not Jürgen — in assignments[]', async () => {
    const { fromMock } = mockAdminFleetClient({
      vehicles: canonicalVehiclesUnassigned,
      drivers: canonicalDrivers,
    })

    const fleetData = await fetchAuthorizedFleetData(
      { from: fromMock } as unknown as Parameters<typeof fetchAuthorizedFleetData>[0],
      'admin-user',
      'admin',
    )
    const context = buildTrustedCopilotContext({ fleetData })

    expect(context.assignments).toEqual([
      'EE-FLEET-991 -> Unassigned',
      'EE-FLEET-402 -> Unassigned',
      'EE-FLEET-118 -> Unassigned',
    ])
    expect(context.assignments).not.toContain('EE-FLEET-991 -> Jürgen Tamm')
    expect(context.licenseExpiry).toContain('Jürgen Tamm -> 12 / 11 / 2026')
  })

  it('6: when assigned_driver_id is set, server join produces EE-FLEET-991 -> Jürgen Tamm', async () => {
    const vehiclesAssigned = [
      {
        ...canonicalVehiclesUnassigned[0]!,
        assigned_driver_id: JURGEN_DRIVER_ID,
      },
      canonicalVehiclesUnassigned[1]!,
      canonicalVehiclesUnassigned[2]!,
    ]

    const { fromMock } = mockAdminFleetClient({
      vehicles: vehiclesAssigned,
      drivers: canonicalDrivers,
    })

    const fleetData = await fetchAuthorizedFleetData(
      { from: fromMock } as unknown as Parameters<typeof fetchAuthorizedFleetData>[0],
      'admin-user',
      'admin',
    )
    const context = buildTrustedCopilotContext({ fleetData })

    expect(context.assignments).toContain('EE-FLEET-991 -> Jürgen Tamm')
  })

  it('7: failed/empty vehicles query drops assignments from Gemini system instruction', async () => {
    const { fromMock } = mockAdminFleetClient({
      vehicles: [],
      drivers: canonicalDrivers,
      vehicleError: { message: 'RLS denied' },
    })

    const fleetData = await fetchAuthorizedFleetData(
      { from: fromMock } as unknown as Parameters<typeof fetchAuthorizedFleetData>[0],
      'admin-user',
      'admin',
    )
    const context = buildTrustedCopilotContext({ fleetData })
    const instruction = buildSystemInstruction(context)

    expect(context.assignments).toEqual([])
    expect(instruction).not.toContain('Vehicle assignments in session context')
    expect(instruction).toContain('Jürgen Tamm -> 12 / 11 / 2026')
  })

  it('8: unmatched assigned_driver_id resolves to Unassigned (name lookup miss)', async () => {
    const vehiclesAssigned = [
      {
        ...canonicalVehiclesUnassigned[0]!,
        assigned_driver_id: '00000000-0000-0000-0000-000000000099',
      },
    ]

    const { fromMock } = mockAdminFleetClient({
      vehicles: vehiclesAssigned,
      drivers: canonicalDrivers,
      assignedNameRows: [],
    })

    const fleetData = await fetchAuthorizedFleetData(
      { from: fromMock } as unknown as Parameters<typeof fetchAuthorizedFleetData>[0],
      'admin-user',
      'admin',
    )
    const context = buildTrustedCopilotContext({ fleetData })

    expect(context.assignments).toEqual(['EE-FLEET-991 -> Unassigned'])
  })

  it('9: STEP 26B ignores client assignments in invoke body (pre-26B channel removed)', () => {
    const parsed = parseCopilotRequest({
      prompt: 'Which vehicle is assigned to Jürgen?',
      context: {
        assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
        licenseExpiry: ['Jürgen Tamm -> 12 / 11 / 2026'],
      },
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual({
      prompt: 'Which vehicle is assigned to Jürgen?',
    })
    expect(geminiCopilotSource).toContain('clientDemoTelemetry')
    expect(geminiCopilotSource).not.toMatch(/body:\s*\{[\s\S]*assignments:/)
  })

  it('10: pre-26B client snapshot vs post-26B server snapshot diverge when UI memory ≠ DB assignment', () => {
    const clientContext = buildFleetCopilotContext(
      [{ assetId: 'EE-FLEET-991', driverName: 'Jürgen Tamm', statusLabel: 'OPTIMAL CLEARANCE' }],
      [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
    )

    const serverFleet: AuthorizedFleetData = {
      membershipRole: 'admin',
      assets: [
        {
          assetId: 'EE-FLEET-991',
          driverName: 'Unassigned',
          status: 'optimal',
          statusLabel: 'OPTIMAL CLEARANCE',
        },
      ],
      drivers: [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
    }
    const serverContext = buildTrustedCopilotContext({ fleetData: serverFleet })

    expect(clientContext.assignments).toEqual(['EE-FLEET-991 -> Jürgen Tamm'])
    expect(serverContext.assignments).toEqual(['EE-FLEET-991 -> Unassigned'])

    const clientInstruction = buildSystemInstruction(clientContext)
    const serverInstruction = buildSystemInstruction(serverContext)

    expect(clientInstruction).toContain('EE-FLEET-991 -> Jürgen Tamm')
    expect(serverInstruction).toContain('EE-FLEET-991 -> Unassigned')
    expect(serverInstruction).not.toContain('EE-FLEET-991 -> Jürgen Tamm')
  })
})
