import { applyDriverFallback, applyFleetFallback } from '../data/fallbacks'
import { mapDriverRowToData, mapVehicleToFleetAsset } from '../data/mappers'
import { supabase } from '../supabaseClient'
import type { MembershipRole } from './authProfile'
import type { DriverData, DriverPiiRow, DriverRow } from '../types/driver'
import type { FleetAsset, VehicleRow } from '../types/fleet'

export type FleetDataSource = 'supabase' | 'fallback'

export type FleetServiceResult<T> = {
  data: T
  source: FleetDataSource
  error?: string
}

export type FleetAccessContext = {
  /** Real organization_members.role — never demo role selector. */
  membershipRole: MembershipRole | null
  /** Verified Supabase Auth user.id */
  userId: string
}

/** Non-PII columns from `public.drivers` (STEP 18E-6). Never select PII here. */
export const DRIVER_SELECT_COLUMNS = 'id,name,expiry_date,status,user_id' as const

/** PII columns from `public.driver_pii` only. */
export const DRIVER_PII_SELECT_COLUMNS =
  'driver_id,personal_code,license_number' as const

/** Vehicle ops columns — assignment via assigned_driver_id (not denormalized driver_name). */
export const VEHICLE_SELECT_COLUMNS =
  'id,asset_id,assigned_driver_id,speed,battery,compliance_tier' as const

/** Name lookup for assigned drivers only (non-PII). */
export const ASSIGNED_DRIVER_NAME_COLUMNS = 'id,name' as const

/** Safe client-facing message — never forward raw Supabase/Postgres errors. */
export const REGISTRY_LOAD_ERROR = 'Unable to load registry data.'

const EMPTY_DRIVERS_MESSAGE = 'No driver records returned from Supabase.'
const EMPTY_VEHICLES_MESSAGE = 'No vehicle records returned from Supabase.'
const PII_UNAVAILABLE = '—'

/** Shown when OCR/registry PII must not be rendered for the current role. */
export const PII_PROTECTED_DISPLAY = 'Protected — hidden for this role'

/** Admin and assigned drivers may request driver_pii; fleet-manager must not. */
export function mayRequestDriverPii(role: MembershipRole | null): boolean {
  return role === 'admin' || role === 'driver'
}

/** UI gate aligned with driver_pii RLS matrix. */
export function mayDisplayDriverPii(role: MembershipRole | null): boolean {
  return role === 'admin' || role === 'driver'
}

/** Removes personalCode / licenseNumber from a registry record. */
export function stripDriverPii(data: DriverData): DriverData {
  return {
    ...data,
    personalCode: PII_UNAVAILABLE,
    licenseNumber: PII_UNAVAILABLE,
  }
}

function recordsVisibleForRole(
  role: MembershipRole | null,
  records: DriverData[],
): DriverData[] {
  if (mayDisplayDriverPii(role)) return records
  return records.map(stripDriverPii)
}

async function fetchDriverPiiByIds(
  driverIds: string[],
): Promise<Map<string, DriverPiiRow>> {
  const uniqueIds = [...new Set(driverIds.filter((id) => id.trim().length > 0))]
  const byId = new Map<string, DriverPiiRow>()
  if (uniqueIds.length === 0) return byId

  const { data, error } = await supabase
    .from('driver_pii')
    .select(DRIVER_PII_SELECT_COLUMNS)
    .in('driver_id', uniqueIds)

  if (error || !data) return byId

  for (const row of data as DriverPiiRow[]) {
    if (row.driver_id) byId.set(row.driver_id, row)
  }

  return byId
}

/** UI label for Identity registry list header. */
export function formatRegistryRecordCount(count: number): string {
  return count === 1 ? '1 record' : `${count} records`
}

/**
 * Loads Identity registry drivers (non-PII from drivers; PII from driver_pii).
 * - Admin: all org rows RLS permits (no .limit(1)); may merge driver_pii
 * - Fleet Manager: org drivers, never driver_pii
 * - Driver: own user_id row only; own PII when present
 * - Empty driver assignment → [] (no invented registry / fake PII)
 */
export async function fetchDrivers(
  access: FleetAccessContext,
): Promise<FleetServiceResult<DriverData[]>> {
  const { membershipRole, userId } = access

  try {
    let driversQuery = supabase.from('drivers').select(DRIVER_SELECT_COLUMNS)

    if (membershipRole === 'driver') {
      driversQuery = driversQuery.eq('user_id', userId)
    }

    // Admin must not use .limit(1) — load full RLS-visible registry set.
    const { data, error } = await driversQuery
    const rows = (data as DriverRow[] | null) ?? []

    if (!error && rows.length > 0) {
      const piiById = mayRequestDriverPii(membershipRole)
        ? await fetchDriverPiiByIds(
            rows
              .map((row) => row.id)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          )
        : new Map<string, DriverPiiRow>()

      const mapped = rows.map((row) =>
        mapDriverRowToData(row, row.id ? piiById.get(row.id) ?? null : null),
      )

      return {
        data: recordsVisibleForRole(membershipRole, mapped),
        source: 'supabase',
      }
    }

    const loadError = error ? REGISTRY_LOAD_ERROR : EMPTY_DRIVERS_MESSAGE

    if (membershipRole === 'driver') {
      return {
        data: [],
        source: 'fallback',
        error: loadError,
      }
    }

    if (membershipRole === 'admin') {
      return {
        data: [applyDriverFallback()],
        source: 'fallback',
        error: loadError,
      }
    }

    return {
      data: [stripDriverPii(applyDriverFallback())],
      source: 'fallback',
      error: loadError,
    }
  } catch {
    if (membershipRole === 'driver') {
      return {
        data: [],
        source: 'fallback',
        error: REGISTRY_LOAD_ERROR,
      }
    }

    if (membershipRole === 'admin') {
      return {
        data: [applyDriverFallback()],
        source: 'fallback',
        error: REGISTRY_LOAD_ERROR,
      }
    }

    return {
      data: [stripDriverPii(applyDriverFallback())],
      source: 'fallback',
      error: REGISTRY_LOAD_ERROR,
    }
  }
}

async function fetchAssignedDriverNames(
  driverIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(driverIds.filter((id) => id.trim().length > 0))]
  const names = new Map<string, string>()
  if (uniqueIds.length === 0) return names

  const { data, error } = await supabase
    .from('drivers')
    .select(ASSIGNED_DRIVER_NAME_COLUMNS)
    .in('id', uniqueIds)

  if (error || !data) return names

  for (const row of data as Array<{ id?: string; name?: string | null }>) {
    if (!row.id) continue
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (name) names.set(row.id, name)
  }

  return names
}

function mapVehiclesWithAssignments(
  rows: VehicleRow[],
  namesById: Map<string, string>,
): FleetAsset[] {
  return rows.map((row) => {
    const assignedId = row.assigned_driver_id
    const resolvedName =
      assignedId && namesById.has(assignedId) ? namesById.get(assignedId) : null
    return mapVehicleToFleetAsset(row, resolvedName)
  })
}

/**
 * Org-scoped vehicles for Admin / Fleet Manager (RLS).
 * Driver scope is assigned_driver_id via RLS — do not invent vehicles when unassigned.
 * Display names resolve from assigned_driver_id → drivers.name only.
 */
export async function fetchVehicles(
  access: Pick<FleetAccessContext, 'membershipRole'>,
): Promise<FleetServiceResult<FleetAsset[]>> {
  const { membershipRole } = access

  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select(VEHICLE_SELECT_COLUMNS)

    const rows = (data as VehicleRow[] | null) ?? []
    if (!error && rows.length > 0) {
      const assignedIds = rows
        .map((row) => row.assigned_driver_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      const namesById = await fetchAssignedDriverNames(assignedIds)

      return {
        data: mapVehiclesWithAssignments(rows, namesById),
        source: 'supabase',
      }
    }

    // Unassigned drivers currently see 0 rows — keep that honest (no demo fleet invent).
    if (membershipRole === 'driver') {
      return {
        data: [],
        source: 'fallback',
        error: error ? REGISTRY_LOAD_ERROR : EMPTY_VEHICLES_MESSAGE,
      }
    }

    return {
      data: applyFleetFallback(mapVehicleToFleetAsset),
      source: 'fallback',
      error: error ? REGISTRY_LOAD_ERROR : EMPTY_VEHICLES_MESSAGE,
    }
  } catch {
    if (membershipRole === 'driver') {
      return {
        data: [],
        source: 'fallback',
        error: REGISTRY_LOAD_ERROR,
      }
    }

    return {
      data: applyFleetFallback(mapVehicleToFleetAsset),
      source: 'fallback',
      error: REGISTRY_LOAD_ERROR,
    }
  }
}
