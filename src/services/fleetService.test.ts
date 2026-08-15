import { beforeEach, describe, expect, it, vi } from 'vitest'
import fleetServiceSource from './fleetService.ts?raw'
import loginSource from '../Login.tsx?raw'
import dashboardSource from '../DashboardLayout.tsx?raw'

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: fromMock,
  },
}))

import {
  ASSIGNED_DRIVER_NAME_COLUMNS,
  DRIVER_PII_SELECT_COLUMNS,
  DRIVER_SELECT_COLUMNS,
  fetchDrivers,
  fetchVehicles,
  formatRegistryRecordCount,
  mayDisplayDriverPii,
  mayRequestDriverPii,
  REGISTRY_LOAD_ERROR,
  stripDriverPii,
  VEHICLE_SELECT_COLUMNS,
} from './fleetService'
import { UNASSIGNED_DRIVER_LABEL } from '../data/mappers'

const ADMIN_ACCESS = {
  membershipRole: 'admin' as const,
  userId: 'ca5316b3-8872-45f4-9617-06d758f19f49',
}

const FM_ACCESS = {
  membershipRole: 'fleet-manager' as const,
  userId: 'fm-user-id',
}

const DRIVER_ACCESS = {
  membershipRole: 'driver' as const,
  userId: 'assigned-driver-auth-id',
}

const REMOTE_DRIVER = {
  id: 'cf96b4cf-910b-4452-93ce-22085077977c',
  name: 'Mari Ots',
  expiry_date: '01/01/2030',
  status: 'VERIFIED & REGISTERED',
  user_id: null,
}

const REMOTE_DRIVER_ASSIGNED = {
  ...REMOTE_DRIVER,
  user_id: DRIVER_ACCESS.userId,
}

const REMOTE_PII = {
  driver_id: REMOTE_DRIVER.id,
  personal_code: '49001010000',
  license_number: 'EE-B0000001',
}

const REMOTE_VEHICLE = {
  id: '5878cb48-9164-4c13-9b42-c161179065e0',
  asset_id: 'EE-FLEET-991',
  assigned_driver_id: null,
  // Denormalized text must never become an assignment label.
  driver_name: 'Jürgen Tamm',
  speed: '84 km/h',
  battery: '72% Electric EV',
  compliance_tier: 'OPTIMAL CLEARANCE',
}

const REMOTE_VEHICLES_UNASSIGNED = [
  {
    id: '5878cb48-9164-4c13-9b42-c161179065e0',
    asset_id: 'EE-FLEET-991',
    assigned_driver_id: null,
    driver_name: 'Jürgen Tamm',
    speed: '84 km/h',
    battery: '72% Electric EV',
    compliance_tier: 'OPTIMAL CLEARANCE',
  },
  {
    id: 'b6160f57-aaaa-4c13-9b42-c161179065e1',
    asset_id: 'EE-FLEET-402',
    assigned_driver_id: null,
    driver_name: 'Mari Ots',
    speed: '0 km/h (Stationary)',
    battery: '91% Electric EV',
    compliance_tier: 'DOCK CHARGING',
  },
  {
    id: 'b2e3d711-bbbb-4c13-9b42-c161179065e2',
    asset_id: 'EE-FLEET-118',
    assigned_driver_id: null,
    driver_name: 'Kristjan Kivi',
    speed: '112 km/h (High)',
    battery: '44% Diesel Engine',
    compliance_tier: 'CRITICAL WARNING',
  },
]

const REMOTE_DRIVER_B = {
  id: 'ba05b0eb-1111-4452-93ce-22085077977d',
  name: 'Kristjan Kivi',
  expiry_date: '01/01/2031',
  status: 'VERIFIED & REGISTERED',
  user_id: null,
}

const REMOTE_PII_B = {
  driver_id: REMOTE_DRIVER_B.id,
  personal_code: '39001010006',
  license_number: 'EE-B0984122',
}

const ASSIGNED_DRIVER_ID = 'cf96b4cf-910b-4452-93ce-22085077977c'

function mockAdminDriversWithPii(options?: {
  drivers?: { data: unknown; error: { message: string } | null }
  pii?: { data: unknown; error: { message: string } | null }
}) {
  const driversResult = options?.drivers ?? {
    data: [REMOTE_DRIVER, REMOTE_DRIVER_B],
    error: null,
  }
  const piiResult = options?.pii ?? {
    data: [REMOTE_PII, REMOTE_PII_B],
    error: null,
  }

  const driversSelect = vi.fn().mockResolvedValue(driversResult)
  const piiIn = vi.fn().mockResolvedValue(piiResult)
  const piiSelect = vi.fn().mockReturnValue({ in: piiIn })

  fromMock.mockImplementation((table: string) => {
    if (table === 'drivers') return { select: driversSelect }
    if (table === 'driver_pii') return { select: piiSelect }
    throw new Error(`Unexpected table ${table}`)
  })

  return { driversSelect, piiSelect, piiIn }
}

function mockFleetManagerDrivers(result: {
  data: unknown
  error: { message: string } | null
}) {
  const selectMock = vi.fn().mockResolvedValue(result)
  fromMock.mockImplementation((table: string) => {
    if (table === 'drivers') return { select: selectMock }
    throw new Error(`Fleet Manager must not query ${table}`)
  })
  return { selectMock }
}

function mockDriverOwnRow(options?: {
  drivers?: { data: unknown; error: { message: string } | null }
  pii?: { data: unknown; error: { message: string } | null }
}) {
  const driversResult = options?.drivers ?? {
    data: [REMOTE_DRIVER_ASSIGNED],
    error: null,
  }
  const piiResult = options?.pii ?? { data: [REMOTE_PII], error: null }

  const driversEq = vi.fn().mockResolvedValue(driversResult)
  const driversSelect = vi.fn().mockReturnValue({ eq: driversEq })

  const piiIn = vi.fn().mockResolvedValue(piiResult)
  const piiSelect = vi.fn().mockReturnValue({ in: piiIn })

  fromMock.mockImplementation((table: string) => {
    if (table === 'drivers') return { select: driversSelect }
    if (table === 'driver_pii') return { select: piiSelect }
    throw new Error(`Unexpected table ${table}`)
  })

  return { driversSelect, driversEq, piiSelect, piiIn }
}

function mockVehiclesQuery(result: { data: unknown; error: { message: string } | null }) {
  const selectMock = vi.fn().mockResolvedValue(result)
  fromMock.mockImplementation((table: string) => {
    if (table === 'vehicles') return { select: selectMock }
    throw new Error(`Unexpected table ${table}`)
  })
  return { selectMock }
}

function mockVehiclesWithAssignedDrivers(options: {
  vehicles: { data: unknown; error: { message: string } | null }
  drivers?: { data: unknown; error: { message: string } | null }
}) {
  const vehiclesSelect = vi.fn().mockResolvedValue(options.vehicles)
  const driversIn = vi.fn().mockResolvedValue(
    options.drivers ?? { data: [], error: null },
  )
  const driversSelect = vi.fn().mockReturnValue({ in: driversIn })

  fromMock.mockImplementation((table: string) => {
    if (table === 'vehicles') return { select: vehiclesSelect }
    if (table === 'drivers') return { select: driversSelect }
    throw new Error(`Unexpected table ${table}`)
  })

  return { vehiclesSelect, driversSelect, driversIn }
}

describe('fleetService column scoping', () => {
  it('selects only non-PII driver columns from drivers', () => {
    expect(DRIVER_SELECT_COLUMNS).toBe('id,name,expiry_date,status,user_id')
    expect(DRIVER_SELECT_COLUMNS).not.toContain('*')
    expect(DRIVER_SELECT_COLUMNS).not.toContain('personal_code')
    expect(DRIVER_SELECT_COLUMNS).not.toContain('license_number')
    expect(DRIVER_SELECT_COLUMNS).not.toContain('full_name')
    expect(DRIVER_SELECT_COLUMNS).not.toContain('document_type')
  })

  it('loads PII only from driver_pii columns', () => {
    expect(DRIVER_PII_SELECT_COLUMNS).toBe('driver_id,personal_code,license_number')
    expect(fleetServiceSource).toContain(".from('driver_pii')")
    expect(fleetServiceSource).not.toMatch(
      /\.from\(\s*['"]drivers['"]\s*\)[\s\S]{0,200}personal_code/,
    )
  })

  it('selects only actual remote vehicle columns', () => {
    expect(VEHICLE_SELECT_COLUMNS).toBe(
      'id,asset_id,assigned_driver_id,speed,battery,compliance_tier',
    )
    expect(VEHICLE_SELECT_COLUMNS).not.toContain('*')
    expect(VEHICLE_SELECT_COLUMNS).not.toContain('driver_name')
    expect(VEHICLE_SELECT_COLUMNS).toContain('assigned_driver_id')
  })
})

describe('PII access helpers', () => {
  it('allows Admin and Driver to request/display PII; blocks Fleet Manager', () => {
    expect(mayRequestDriverPii('admin')).toBe(true)
    expect(mayRequestDriverPii('driver')).toBe(true)
    expect(mayRequestDriverPii('fleet-manager')).toBe(false)
    expect(mayRequestDriverPii(null)).toBe(false)

    expect(mayDisplayDriverPii('admin')).toBe(true)
    expect(mayDisplayDriverPii('driver')).toBe(true)
    expect(mayDisplayDriverPii('fleet-manager')).toBe(false)
    expect(mayDisplayDriverPii(null)).toBe(false)
  })

  it('stripDriverPii removes personalCode and licenseNumber only', () => {
    const stripped = stripDriverPii({
      id: REMOTE_DRIVER.id,
      fullName: 'Mari Ots',
      documentType: 'Estonian Class-B National License',
      personalCode: '49001010000',
      licenseNumber: 'EE-B0000001',
      expiryDate: '01/01/2030',
      status: 'REGISTRY RECORD',
    })

    expect(stripped.fullName).toBe('Mari Ots')
    expect(stripped.personalCode).toBe('—')
    expect(stripped.licenseNumber).toBe('—')
    expect(stripped.expiryDate).toBe('01/01/2030')
  })
})

describe('fetchDrivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Admin receives both driver records with matching PII and no limit(1)', async () => {
    const { driversSelect, piiSelect, piiIn } = mockAdminDriversWithPii()

    const result = await fetchDrivers(ADMIN_ACCESS)

    expect(fromMock).toHaveBeenCalledWith('drivers')
    expect(fromMock).toHaveBeenCalledWith('driver_pii')
    expect(driversSelect).toHaveBeenCalledWith(DRIVER_SELECT_COLUMNS)
    expect(piiSelect).toHaveBeenCalledWith(DRIVER_PII_SELECT_COLUMNS)
    expect(piiIn).toHaveBeenCalledWith('driver_id', [
      REMOTE_DRIVER.id,
      REMOTE_DRIVER_B.id,
    ])
    expect(result.source).toBe('supabase')
    expect(result.data).toHaveLength(2)
    expect(result.data.map((d) => d.fullName)).toEqual(['Mari Ots', 'Kristjan Kivi'])
    expect(result.data[0]?.personalCode).toBe('49001010000')
    expect(result.data[0]?.licenseNumber).toBe('EE-B0000001')
    expect(result.data[1]?.personalCode).toBe('39001010006')
    expect(result.data[1]?.licenseNumber).toBe('EE-B0984122')
    expect(fleetServiceSource).not.toMatch(/driversQuery\.limit\(1\)/)
    expect(fleetServiceSource).toContain('Admin must not use .limit(1)')
  })

  it('Fleet Manager receives drivers without querying driver_pii', async () => {
    const { selectMock } = mockFleetManagerDrivers({
      data: [REMOTE_DRIVER, REMOTE_DRIVER_B],
      error: null,
    })

    const result = await fetchDrivers(FM_ACCESS)

    expect(fromMock).toHaveBeenCalledWith('drivers')
    expect(fromMock).not.toHaveBeenCalledWith('driver_pii')
    expect(selectMock).toHaveBeenCalledWith(DRIVER_SELECT_COLUMNS)
    expect(result.source).toBe('supabase')
    expect(result.data).toHaveLength(2)
    expect(result.data.every((d) => d.personalCode === '—')).toBe(true)
    expect(result.data.every((d) => d.licenseNumber === '—')).toBe(true)
  })

  it('does not query driver_pii when membershipRole is null and strips PII', async () => {
    mockFleetManagerDrivers({
      data: [REMOTE_DRIVER, REMOTE_DRIVER_B],
      error: null,
    })

    const result = await fetchDrivers({ membershipRole: null, userId: 'any-user' })

    expect(fromMock).toHaveBeenCalledWith('drivers')
    expect(fromMock).not.toHaveBeenCalledWith('driver_pii')
    expect(result.data).toHaveLength(2)
    expect(result.data.every((d) => d.personalCode === '—')).toBe(true)
    expect(result.data.every((d) => d.licenseNumber === '—')).toBe(true)
  })

  it('Driver scopes own row by user_id and may load own PII', async () => {
    const { driversEq, piiIn } = mockDriverOwnRow()

    const result = await fetchDrivers(DRIVER_ACCESS)

    expect(driversEq).toHaveBeenCalledWith('user_id', DRIVER_ACCESS.userId)
    expect(fromMock).toHaveBeenCalledWith('driver_pii')
    expect(piiIn).toHaveBeenCalledWith('driver_id', [REMOTE_DRIVER.id])
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.personalCode).toBe('49001010000')
    expect(result.data[0]?.licenseNumber).toBe('EE-B0000001')
  })

  it('Driver with no assignment does not invent registry or fake PII', async () => {
    mockDriverOwnRow({
      drivers: { data: [], error: null },
    })

    const result = await fetchDrivers(DRIVER_ACCESS)

    expect(fromMock).not.toHaveBeenCalledWith('driver_pii')
    expect(result.data).toEqual([])
    expect(result.source).toBe('fallback')
    expect(result.error).toBe('No driver records returned from Supabase.')
  })

  it('maps missing driver_pii to safe unavailable markers for Admin', async () => {
    mockAdminDriversWithPii({
      drivers: { data: [REMOTE_DRIVER], error: null },
      pii: { data: [], error: null },
    })

    const result = await fetchDrivers(ADMIN_ACCESS)

    expect(result.source).toBe('supabase')
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.fullName).toBe('Mari Ots')
    expect(result.data[0]?.personalCode).toBe('—')
    expect(result.data[0]?.licenseNumber).toBe('—')
  })

  it('keeps Admin demo fallback functional when registry is empty', async () => {
    mockAdminDriversWithPii({
      drivers: { data: [], error: null },
    })

    const result = await fetchDrivers(ADMIN_ACCESS)

    expect(result.source).toBe('fallback')
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.status).toBe('DEMO RECORD')
    expect(result.data[0]?.fullName).toBe('Jürgen Tamm')
    expect(result.data[0]?.personalCode).toBe('39001010006')
    expect(result.data[0]?.licenseNumber).toBe('EE-B0984122')
  })

  it('maps Supabase driver errors to a safe generic message', async () => {
    mockAdminDriversWithPii({
      drivers: {
        data: null,
        error: { message: 'permission denied for table drivers' },
      },
    })

    const result = await fetchDrivers(ADMIN_ACCESS)

    expect(result.source).toBe('fallback')
    expect(result.data[0]?.status).toBe('DEMO RECORD')
    expect(result.error).toBe(REGISTRY_LOAD_ERROR)
    expect(result.error).not.toContain('permission denied')
  })

  it('maps thrown driver fetch failures to a safe generic message', async () => {
    fromMock.mockImplementation(() => {
      throw new Error('network boom with secret detail')
    })

    const result = await fetchDrivers(ADMIN_ACCESS)

    expect(result.source).toBe('fallback')
    expect(result.data[0]?.status).toBe('DEMO RECORD')
    expect(result.error).toBe(REGISTRY_LOAD_ERROR)
    expect(result.error).not.toContain('secret')
  })

  it('formats registry record counts for Identity UI', () => {
    expect(formatRegistryRecordCount(1)).toBe('1 record')
    expect(formatRegistryRecordCount(2)).toBe('2 records')
  })
})

describe('fetchVehicles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries vehicles with assignment columns (not denormalized driver_name)', async () => {
    const { selectMock } = mockVehiclesQuery({
      data: [REMOTE_VEHICLE],
      error: null,
    })

    await fetchVehicles(ADMIN_ACCESS)

    expect(fromMock).toHaveBeenCalledWith('vehicles')
    expect(selectMock).toHaveBeenCalledWith(VEHICLE_SELECT_COLUMNS)
    expect(fromMock).not.toHaveBeenCalledWith('drivers')
  })

  it('Admin sees all unassigned vehicles as Unassigned (ignores driver_name)', async () => {
    mockVehiclesQuery({
      data: REMOTE_VEHICLES_UNASSIGNED,
      error: null,
    })

    const result = await fetchVehicles(ADMIN_ACCESS)

    expect(result.source).toBe('supabase')
    expect(result.data).toHaveLength(3)
    expect(result.data.map((v) => v.assetId)).toEqual([
      'EE-FLEET-991',
      'EE-FLEET-402',
      'EE-FLEET-118',
    ])
    expect(result.data.every((v) => v.driverName === UNASSIGNED_DRIVER_LABEL)).toBe(true)
    expect(result.data.some((v) => v.driverName === 'Jürgen Tamm')).toBe(false)
    expect(result.data.some((v) => v.driverName === 'Mari Ots')).toBe(false)
    expect(result.data.some((v) => v.driverName === 'Kristjan Kivi')).toBe(false)
    expect(fromMock).not.toHaveBeenCalledWith('drivers')
  })

  it('resolves drivers.name only when assigned_driver_id is set', async () => {
    const assignedVehicle = {
      ...REMOTE_VEHICLE,
      assigned_driver_id: ASSIGNED_DRIVER_ID,
      driver_name: 'Should Not Appear',
    }
    const { driversSelect, driversIn } = mockVehiclesWithAssignedDrivers({
      vehicles: { data: [assignedVehicle], error: null },
      drivers: {
        data: [{ id: ASSIGNED_DRIVER_ID, name: 'Mari Ots' }],
        error: null,
      },
    })

    const result = await fetchVehicles(ADMIN_ACCESS)

    expect(fromMock).toHaveBeenCalledWith('drivers')
    expect(driversSelect).toHaveBeenCalledWith(ASSIGNED_DRIVER_NAME_COLUMNS)
    expect(driversIn).toHaveBeenCalledWith('id', [ASSIGNED_DRIVER_ID])
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.driverName).toBe('Mari Ots')
    expect(result.data[0]?.driverName).not.toBe('Should Not Appear')
  })

  it('does not invent fallback vehicles for an unassigned Driver', async () => {
    mockVehiclesQuery({
      data: [],
      error: null,
    })

    const result = await fetchVehicles(DRIVER_ACCESS)

    expect(result.data).toEqual([])
    expect(result.error).toBe('No vehicle records returned from Supabase.')
  })

  it('keeps Admin/FM vehicle demo fallback when empty, all Unassigned', async () => {
    mockVehiclesQuery({
      data: [],
      error: null,
    })

    const adminResult = await fetchVehicles(ADMIN_ACCESS)
    expect(adminResult.source).toBe('fallback')
    expect(adminResult.data).toHaveLength(3)
    expect(adminResult.data.every((v) => v.driverName === UNASSIGNED_DRIVER_LABEL)).toBe(
      true,
    )

    mockVehiclesQuery({
      data: [],
      error: null,
    })
    const fmResult = await fetchVehicles(FM_ACCESS)
    expect(fmResult.source).toBe('fallback')
    expect(fmResult.data).toHaveLength(3)
    expect(fmResult.data.every((v) => v.driverName === UNASSIGNED_DRIVER_LABEL)).toBe(true)
  })

  it('maps Supabase vehicle errors to a safe generic message', async () => {
    mockVehiclesQuery({
      data: null,
      error: { message: 'JWT expired' },
    })

    const result = await fetchVehicles(ADMIN_ACCESS)

    expect(result.source).toBe('fallback')
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.error).toBe(REGISTRY_LOAD_ERROR)
    expect(result.error).not.toContain('JWT')
  })
})

describe('authorization wiring guards', () => {
  it('does not use Login role selector for fleet authorization', () => {
    expect(loginSource).toContain('Demo role (display only)')
    expect(loginSource).toContain('cosmetic only')
    expect(fleetServiceSource).not.toContain("from '../Login'")
    expect(fleetServiceSource).not.toContain('UserRole')
    expect(fleetServiceSource).toContain('membershipRole')
    expect(fleetServiceSource).toContain('assigned_driver_id')
    expect(fleetServiceSource).not.toMatch(
      /VEHICLE_SELECT_COLUMNS\s*=\s*'[^']*driver_name/,
    )
    expect(dashboardSource).toContain('membershipRole')
    expect(dashboardSource).toContain('mayDisplayDriverPii')
    expect(dashboardSource).toContain('fetchDrivers(access)')
    expect(dashboardSource).toContain('formatRegistryRecordCount(driverRecords.length)')
    expect(dashboardSource).toContain('handleSelectRegistryRecord')
    expect(dashboardSource).toContain('OCR compares against the selected registry record.')
    expect(dashboardSource).toContain('Assigned Driver')
    expect(dashboardSource).toContain('Fleet inventory')
    expect(dashboardSource).toContain('simulated (not live)')
    expect(dashboardSource).toContain('simulateFleetTelemetry')
    expect(dashboardSource).toContain('Live Fleet Telemetry (Simulated)')
    expect(dashboardSource).toContain('if (membershipRole == null) return')
    expect(dashboardSource.indexOf('if (membershipRole == null) return')).toBeLessThan(
      dashboardSource.indexOf('fetchDrivers(access)'),
    )
    expect(dashboardSource).toContain('mayDisplayDriverPii(membershipRole)')
    expect(dashboardSource).toContain('driverResult.data.map(stripDriverPii)')
    expect(dashboardSource).toContain('showDriverPii ? record.personalCode : \'—\'')
    expect(dashboardSource).toContain('stripDriverPii(registry)')
    expect(fleetServiceSource).toContain('recordsVisibleForRole(membershipRole, mapped)')
    expect(fleetServiceSource).toContain('mayRequestDriverPii(membershipRole)')
    expect(fleetServiceSource).not.toContain('CREATE POLICY')
  })
})
