import type { AlertSummary } from './alerts'
import type { ComplianceSnapshot } from './compliance'
import type { FleetHealthSnapshot, OperationalPriorityItem } from './operations'

export type ExecutiveKpis = {
  totalVehicles: number
  assignedVehicles: number
  unassignedVehicles: number
  criticalVehicles: number
  chargingDockingVehicles: number
  optimalVehicles: number
  totalDrivers: number
  /** Label from compliance engine — may be a percentage or unavailability reason. */
  compliancePercentageLabel: string
  expiredLicenses: number
  expiringSoon: number
  openCriticalAlerts: number
}

export type AssignmentAnalytics = {
  totalVehicles: number
  assignedVehicles: number
  unassignedVehicles: number
  /** Null when totalVehicles is zero. */
  assignmentCoveragePercent: number | null
  assignmentCoverageLabel: string
}

export type ExecutiveAnalyticsSnapshot = {
  kpis: ExecutiveKpis
  fleetHealth: FleetHealthSnapshot
  compliance: ComplianceSnapshot
  alertSummary: AlertSummary
  assignment: AssignmentAnalytics
  /** Top operational priorities from computeOperationsSnapshot().priorityActions */
  priorityActions: OperationalPriorityItem[]
  telemetryMode: 'simulated'
}
