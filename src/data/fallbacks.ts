import type { DriverData } from '../types/driver'
import type { FleetAsset, VehicleRow } from '../types/fleet'

export function applyDriverFallback(): DriverData {
  return {
    fullName: 'Jürgen Tamm',
    documentType: 'Estonian Class-B National License',
    personalCode: '39001010006',
    licenseNumber: 'EE-B0984122',
    expiryDate: '12 / 11 / 2026',
    status: 'DEMO RECORD',
  }
}

/**
 * Demo fleet fixtures — intentionally unassigned.
 * Denormalized driver_name text (if present remotely) is not used by the mapper.
 */
const FALLBACK_VEHICLE_ROWS: VehicleRow[] = [
  {
    asset_id: 'EE-FLEET-991',
    assigned_driver_id: null,
    speed: '84 km/h',
    battery: '72% Electric EV',
    compliance_tier: 'OPTIMAL CLEARANCE',
  },
  {
    asset_id: 'EE-FLEET-402',
    assigned_driver_id: null,
    speed: '0 km/h (Stationary)',
    battery: '91% Electric EV',
    compliance_tier: 'DOCK CHARGING',
  },
  {
    asset_id: 'EE-FLEET-118',
    assigned_driver_id: null,
    speed: '112 km/h (High)',
    battery: '44% Diesel Engine',
    compliance_tier: 'CRITICAL WARNING',
  },
]

export function applyFleetFallback(
  mapVehicleToFleetAsset: (row: VehicleRow) => FleetAsset,
): FleetAsset[] {
  return FALLBACK_VEHICLE_ROWS.map(mapVehicleToFleetAsset)
}
