import type { DriverData, DriverRow } from '../types/driver'
import type { FleetAsset, FleetClearanceStatus, VehicleRow } from '../types/fleet'

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

export function mapDriverRowToData(row: DriverRow): DriverData {
  return {
    fullName: row.full_name ?? row.fullName ?? row.name ?? 'Unknown Driver',
    documentType: row.document_type ?? row.documentType ?? 'Estonian Class-B National License',
    personalCode: String(row.personal_code ?? row.personalCode ?? row.isikukood ?? '—'),
    licenseNumber: row.license_number ?? row.licenseNumber ?? '—',
    expiryDate: row.expiry_date ?? row.expiryDate ?? '—',
    status: 'VERIFIED & REGISTERED',
  }
}

export function mapVehicleToFleetAsset(row: VehicleRow): FleetAsset {
  const energy = row.energy ?? `${row.battery_percent ?? row.batteryPercent ?? 0}% Electric EV`
  const batteryPercent = parseBatteryPercent(
    energy,
    row.battery_percent ?? row.batteryPercent,
  )
  const statusLabel =
    row.status_label ??
    row.statusLabel ??
    (row.status?.toLowerCase() === 'critical' ? 'CRITICAL WARNING' : 'OPTIMAL CLEARANCE')
  const status = resolveFleetStatus(statusLabel, row.status)

  return {
    assetId: row.asset_id ?? row.assetId ?? `EE-FLEET-${row.id ?? '000'}`,
    driverName: row.driver_name ?? row.driverName ?? 'Unassigned',
    speed:
      typeof row.speed === 'number'
        ? `${row.speed} km/h`
        : String(row.speed ?? '0 km/h'),
    energy,
    batteryPercent,
    status,
    statusLabel,
  }
}
