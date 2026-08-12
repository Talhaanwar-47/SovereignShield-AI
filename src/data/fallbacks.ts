import type { DriverData } from '../types/driver'
import type { FleetAsset, VehicleRow } from '../types/fleet'

export function applyDriverFallback(): DriverData {
  return {
    fullName: 'Jürgen Tamm',
    documentType: 'Estonian Class-B National License',
    personalCode: '39001010006',
    licenseNumber: 'EE-B0984122',
    expiryDate: '12 / 11 / 2026',
    status: 'VERIFIED & REGISTERED',
  }
}

const FALLBACK_VEHICLE_ROWS: VehicleRow[] = [
  {
    asset_id: 'EE-FLEET-991',
    driver_name: 'Jürgen Tamm',
    speed: '84 km/h',
    energy: '72% Electric EV',
    status_label: 'OPTIMAL CLEARANCE',
  },
  {
    asset_id: 'EE-FLEET-402',
    driver_name: 'Mari Ots',
    speed: '0 km/h (Stationary)',
    energy: '91% Electric EV',
    status_label: 'DOCK CHARGING',
  },
  {
    asset_id: 'EE-FLEET-118',
    driver_name: 'Kristjan Kivi',
    speed: '112 km/h (High)',
    energy: '44% Diesel Engine',
    status_label: 'CRITICAL WARNING',
  },
]

export function applyFleetFallback(
  mapVehicleToFleetAsset: (row: VehicleRow) => FleetAsset,
): FleetAsset[] {
  return FALLBACK_VEHICLE_ROWS.map(mapVehicleToFleetAsset)
}
