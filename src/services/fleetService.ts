import { applyDriverFallback, applyFleetFallback } from '../data/fallbacks'
import { mapDriverRowToData, mapVehicleToFleetAsset } from '../data/mappers'
import { supabase } from '../supabaseClient'
import type { DriverData, DriverRow } from '../types/driver'
import type { FleetAsset, VehicleRow } from '../types/fleet'

export async function fetchDrivers(): Promise<DriverData> {
  try {
    const { data, error } = await supabase.from('drivers').select('*')

    const rows = (data as DriverRow[]) ?? []
    if (!error && rows.length > 0) {
      return mapDriverRowToData(rows[0])
    }

    return applyDriverFallback()
  } catch {
    return applyDriverFallback()
  }
}

export async function fetchVehicles(): Promise<FleetAsset[]> {
  try {
    const { data, error } = await supabase.from('vehicles').select('*')

    const rows = (data as VehicleRow[]) ?? []
    if (!error && rows.length > 0) {
      return rows.map(mapVehicleToFleetAsset)
    }

    return applyFleetFallback(mapVehicleToFleetAsset)
  } catch {
    return applyFleetFallback(mapVehicleToFleetAsset)
  }
}
