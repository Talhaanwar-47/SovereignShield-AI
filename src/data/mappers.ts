import type { DriverData, DriverPiiRow, DriverRow } from '../types/driver'
import type { FleetAsset, FleetClearanceStatus, VehicleRow } from '../types/fleet'

const PII_UNAVAILABLE = '—'

/** Shown when vehicles.assigned_driver_id is null or name cannot be resolved. */
export const UNASSIGNED_DRIVER_LABEL = 'Unassigned'

function parseBatteryPercent(energy: string, explicit?: number): number {
  if (explicit !== undefined && !Number.isNaN(explicit)) return explicit
  const match = energy.match(/(\d+)%/)
  return match ? Number(match[1]) : 0
}

function resolveFleetStatus(statusLabel: string, rawStatus?: string): FleetClearanceStatus {
  const label = statusLabel.toUpperCase()
  const raw = rawStatus?.toLowerCase() ?? ''
  if (label.includes('CRITICAL') || raw === 'critical') return 'critical'
  if (label.includes('DOCK') || label.includes('CHARGING') || raw === 'docking') return 'docking'
  return 'optimal'
}

function resolvePiiField(value: string | null | undefined): string {
  if (value === null || value === undefined) return PII_UNAVAILABLE
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : PII_UNAVAILABLE
}

/**
 * Assignment display uses assigned_driver_id only.
 * Denormalized vehicles.driver_name is never authoritative.
 */
export function resolveAssignedDriverDisplayName(
  assignedDriverId: string | null | undefined,
  assignedDriverName?: string | null,
): string {
  if (assignedDriverId === null || assignedDriverId === undefined || assignedDriverId === '') {
    return UNASSIGNED_DRIVER_LABEL
  }
  const trimmed = typeof assignedDriverName === 'string' ? assignedDriverName.trim() : ''
  return trimmed.length > 0 ? trimmed : UNASSIGNED_DRIVER_LABEL
}

/**
 * Maps a remote drivers row into UI DriverData.
 * Optional `pii` merges personal_code / license_number from `driver_pii`.
 * Missing PII → "—" (OCR comparison already maps that to UNAVAILABLE).
 * DriverData.status is always REGISTRY RECORD for Supabase-sourced rows
 * (STEP 15B) — never pass through remote labels like "VERIFIED & REGISTERED".
 */
export function mapDriverRowToData(
  row: DriverRow,
  pii?: Pick<DriverPiiRow, 'personal_code' | 'license_number'> | null,
): DriverData {
  return {
    id: row.id,
    fullName: row.name ?? row.full_name ?? row.fullName ?? 'Unknown Driver',
    documentType: row.document_type ?? row.documentType ?? 'Estonian Class-B National License',
    personalCode: resolvePiiField(pii?.personal_code),
    licenseNumber: resolvePiiField(pii?.license_number),
    expiryDate: row.expiry_date ?? row.expiryDate ?? PII_UNAVAILABLE,
    status: 'REGISTRY RECORD',
  }
}

/**
 * Maps a remote vehicles row into UI FleetAsset.
 * Driver label comes from assigned_driver_id (+ resolved drivers.name), never driver_name.
 */
export function mapVehicleToFleetAsset(
  row: VehicleRow,
  assignedDriverName?: string | null,
): FleetAsset {
  const energy =
    row.battery ??
    row.energy ??
    `${row.battery_percent ?? row.batteryPercent ?? 0}% Electric EV`
  const batteryPercent = parseBatteryPercent(
    energy,
    row.battery_percent ?? row.batteryPercent,
  )
  const statusLabel =
    row.compliance_tier ??
    row.status_label ??
    row.statusLabel ??
    (row.status?.toLowerCase() === 'critical' ? 'CRITICAL WARNING' : 'OPTIMAL CLEARANCE')
  const status = resolveFleetStatus(statusLabel, row.status ?? row.compliance_tier)

  return {
    assetId: row.asset_id ?? row.assetId ?? `EE-FLEET-${row.id ?? '000'}`,
    driverName: resolveAssignedDriverDisplayName(row.assigned_driver_id, assignedDriverName),
    speed: String(row.speed ?? '0 km/h'),
    energy,
    batteryPercent,
    status,
    statusLabel,
  }
}
