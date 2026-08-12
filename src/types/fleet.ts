export type FleetClearanceStatus = 'optimal' | 'critical' | 'docking'

export interface FleetAsset {
  assetId: string
  driverName: string
  speed: string
  energy: string
  batteryPercent: number
  status: FleetClearanceStatus
  statusLabel: string
}

export interface VehicleRow {
  id?: string | number
  asset_id?: string
  assetId?: string
  driver_name?: string
  driverName?: string
  speed?: number | string
  battery_percent?: number
  batteryPercent?: number
  energy?: string
  status?: string
  status_label?: string
  statusLabel?: string
}
