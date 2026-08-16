export type FleetClearanceStatus = 'optimal' | 'critical' | 'docking'

export interface FleetAsset {
  assetId: string
  /** Resolved from assigned_driver_id → drivers.name, or "Unassigned". */
  driverName: string
  speed: string
  energy: string
  batteryPercent: number
  status: FleetClearanceStatus
  statusLabel: string
}

/**
 * Remote `public.vehicles` row shape.
 * Assignment authority is `assigned_driver_id` only.
 * `driver_name` is denormalized display text and must not drive UI assignment.
 */
export interface VehicleRow {
  id?: string
  asset_id?: string
  /** Authoritative assignment FK (nullable). */
  assigned_driver_id?: string | null
  /**
   * Denormalized text only — not an assignment source for Fleet UI.
   * @deprecated Do not use for assigned-driver display.
   */
  driver_name?: string
  speed?: string
  /** Remote battery / energy text, e.g. "72% Electric EV" */
  battery?: string
  /** Remote compliance label mapped into UI statusLabel */
  compliance_tier?: string
  /** @deprecated Legacy / fallback aliases */
  assetId?: string
  driverName?: string
  energy?: string
  battery_percent?: number
  batteryPercent?: number
  status?: string
  status_label?: string
  statusLabel?: string
}
