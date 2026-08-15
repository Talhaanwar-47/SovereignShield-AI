import { UNASSIGNED_DRIVER_LABEL } from '../data/mappers'
import type { AlertSummary } from '../types/alerts'
import type {
  AssignmentAnalytics,
  ExecutiveAnalyticsSnapshot,
  ExecutiveKpis,
} from '../types/executiveAnalytics'
import type { OperationalAlert } from '../types/alerts'
import { alertsFromOperationsSnapshot, computeAlertSummary } from './alertIncidentService'
import {
  computeComplianceSnapshot,
  type ComplianceDriverRecord,
  type ComplianceFleetAsset,
} from './complianceEngine'
import {
  computeOperationsSnapshot,
  type OperationsDriverRecord,
  type OperationsFleetAsset,
} from './operationsPriorityEngine'

export type ExecutiveFleetAsset = OperationsFleetAsset & ComplianceFleetAsset

export type ExecutiveDriverRecord = OperationsDriverRecord & ComplianceDriverRecord

function countAssignments(assets: Pick<ComplianceFleetAsset, 'driverName'>[]): {
  assigned: number
  unassigned: number
} {
  let assigned = 0
  let unassigned = 0

  for (const asset of assets) {
    const name = asset.driverName.trim()
    if (!name || name === UNASSIGNED_DRIVER_LABEL) {
      unassigned += 1
    } else {
      assigned += 1
    }
  }

  return { assigned, unassigned }
}

export function buildAssignmentAnalytics(
  totalVehicles: number,
  assignedVehicles: number,
  unassignedVehicles: number,
): AssignmentAnalytics {
  if (totalVehicles === 0) {
    return {
      totalVehicles: 0,
      assignedVehicles: 0,
      unassignedVehicles: 0,
      assignmentCoveragePercent: null,
      assignmentCoverageLabel: 'Unavailable',
    }
  }

  const assignmentCoveragePercent = Math.round((assignedVehicles / totalVehicles) * 100)

  return {
    totalVehicles,
    assignedVehicles,
    unassignedVehicles,
    assignmentCoveragePercent,
    assignmentCoverageLabel: `${assignmentCoveragePercent}%`,
  }
}

export function countOpenCriticalAlerts(alerts: OperationalAlert[]): number {
  return alerts.filter((alert) => alert.severity === 'critical' && alert.state === 'open').length
}

/**
 * Deterministic executive analytics aggregation from RLS-scoped fleet + driver rows.
 * Reuses operations, compliance, and alert engines — does not recalculate independently.
 */
export function computeExecutiveAnalyticsSnapshot(
  assets: ExecutiveFleetAsset[],
  drivers: ExecutiveDriverRecord[] = [],
  now: Date = new Date(),
): ExecutiveAnalyticsSnapshot {
  const operationsSnapshot = computeOperationsSnapshot(assets, drivers, now)
  const complianceSnapshot = computeComplianceSnapshot(drivers, assets, now)
  const alerts = alertsFromOperationsSnapshot(operationsSnapshot)
  const alertSummary = computeAlertSummary(alerts)

  const { assigned, unassigned } = countAssignments(assets)
  const assignment = buildAssignmentAnalytics(
    operationsSnapshot.health.totalVehicles,
    assigned,
    unassigned,
  )

  const kpis: ExecutiveKpis = {
    totalVehicles: operationsSnapshot.health.totalVehicles,
    assignedVehicles: assignment.assignedVehicles,
    unassignedVehicles: assignment.unassignedVehicles,
    criticalVehicles: operationsSnapshot.health.critical,
    chargingDockingVehicles: operationsSnapshot.health.chargingDocking,
    optimalVehicles: operationsSnapshot.health.optimal,
    totalDrivers: complianceSnapshot.totalDrivers,
    compliancePercentageLabel: complianceSnapshot.compliancePercentageLabel,
    expiredLicenses: complianceSnapshot.expiredCount,
    expiringSoon: complianceSnapshot.expiringSoonCount,
    openCriticalAlerts: countOpenCriticalAlerts(alerts),
  }

  return {
    kpis,
    fleetHealth: operationsSnapshot.health,
    compliance: complianceSnapshot,
    alertSummary,
    assignment,
    priorityActions: operationsSnapshot.priorityActions,
    telemetryMode: 'simulated',
  }
}

/** Re-export for tests asserting alert summary consistency. */
export function deriveAlertSummaryFromOperations(
  assets: ExecutiveFleetAsset[],
  drivers: ExecutiveDriverRecord[] = [],
  now: Date = new Date(),
): AlertSummary {
  const operationsSnapshot = computeOperationsSnapshot(assets, drivers, now)
  return computeAlertSummary(alertsFromOperationsSnapshot(operationsSnapshot))
}
