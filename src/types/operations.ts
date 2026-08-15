export type OperationalPriorityLevel = 'CRITICAL' | 'HIGH' | 'NORMAL'

export type OperationalPriorityCategory = 'vehicle' | 'compliance'

export type OperationalPriorityItem = {
  level: OperationalPriorityLevel
  category: OperationalPriorityCategory
  /** Vehicle asset ID or driver full name (RLS-scoped, non-PII). */
  subject: string
  headline: string
  detail: string
  action: string
  simulated: boolean
}

export type FleetHealthSnapshot = {
  totalVehicles: number
  activeAvailable: number
  optimal: number
  critical: number
  chargingDocking: number
}

export type OperationsSnapshot = {
  health: FleetHealthSnapshot
  /** Sorted CRITICAL/HIGH items for display; NORMAL omitted. */
  priorityActions: OperationalPriorityItem[]
  recommendedActions: string[]
  /** String rows for Gemini — deterministic priority snapshot. */
  operationalPriorities: string[]
  fleetHealthSummary: string[]
  telemetryMode: 'simulated'
}
