import { describe, expect, it } from 'vitest'
import {
  buildAssignmentAnalytics,
  computeExecutiveAnalyticsSnapshot,
  countOpenCriticalAlerts,
  deriveAlertSummaryFromOperations,
} from './executiveAnalyticsEngine'
import { computeComplianceSnapshot } from './complianceEngine'
import { alertsFromOperationsSnapshot, computeAlertSummary } from './alertIncidentService'
import { computeOperationsSnapshot } from './operationsPriorityEngine'
import {
  buildExecutiveCopilotContext,
  EXECUTIVE_AUTHORITY_RULES,
} from './executiveAnalyticsCopilotHelpers'
import { buildSystemInstruction } from './geminiCopilotHelpers'

describe('executiveAnalyticsEngine', () => {
  const now = new Date(Date.UTC(2026, 7, 14))

  const mixedAssets = [
    {
      assetId: 'EE-FLEET-118',
      status: 'critical' as const,
      statusLabel: 'CRITICAL WARNING',
      driverName: 'Unassigned',
    },
    {
      assetId: 'EE-FLEET-991',
      status: 'optimal' as const,
      statusLabel: 'OPTIMAL CLEARANCE',
      driverName: 'Jürgen Tamm',
    },
    {
      assetId: 'EE-FLEET-402',
      status: 'docking' as const,
      statusLabel: 'DOCK CHARGING',
      driverName: 'Unassigned',
    },
  ]

  const mixedDrivers = [
    { fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' },
    { fullName: 'Mari Ots', expiryDate: '20 / 08 / 2026' },
    { fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' },
  ]

  it('aggregates KPIs from operations and compliance engines without inventing values', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(mixedAssets, mixedDrivers, now)

    expect(snapshot.kpis.totalVehicles).toBe(3)
    expect(snapshot.kpis.assignedVehicles).toBe(1)
    expect(snapshot.kpis.unassignedVehicles).toBe(2)
    expect(snapshot.kpis.criticalVehicles).toBe(1)
    expect(snapshot.kpis.chargingDockingVehicles).toBe(1)
    expect(snapshot.kpis.optimalVehicles).toBe(1)
    expect(snapshot.kpis.totalDrivers).toBe(3)
    expect(snapshot.kpis.expiredLicenses).toBe(1)
    expect(snapshot.kpis.expiringSoon).toBe(1)
    expect(snapshot.telemetryMode).toBe('simulated')
  })

  it('uses compliance engine percentage label without recalculating', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(mixedAssets, mixedDrivers, now)
    const compliance = computeComplianceSnapshot(mixedDrivers, mixedAssets, now)

    expect(snapshot.compliance.compliancePercentage).toBe(compliance.compliancePercentage)
    expect(snapshot.kpis.compliancePercentageLabel).toBe(compliance.compliancePercentageLabel)
  })

  it('shows unavailability reason when compliance percentage is null', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(
      mixedAssets,
      [{ fullName: 'Unknown Driver', expiryDate: '—' }],
      now,
    )

    expect(snapshot.compliance.compliancePercentage).toBeNull()
    expect(snapshot.kpis.compliancePercentageLabel).toBe(
      'Unavailable — no parseable expiry data',
    )
  })

  it('derives alert summary consistent with operations snapshot', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(mixedAssets, mixedDrivers, now)
    const ops = computeOperationsSnapshot(mixedAssets, mixedDrivers, now)
    const expected = computeAlertSummary(alertsFromOperationsSnapshot(ops))

    expect(snapshot.alertSummary).toEqual(expected)
    expect(deriveAlertSummaryFromOperations(mixedAssets, mixedDrivers, now)).toEqual(expected)
  })

  it('counts open critical alerts from derived alerts', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(mixedAssets, mixedDrivers, now)
    const ops = computeOperationsSnapshot(mixedAssets, mixedDrivers, now)
    const alerts = alertsFromOperationsSnapshot(ops)

    expect(snapshot.kpis.openCriticalAlerts).toBe(countOpenCriticalAlerts(alerts))
    expect(snapshot.kpis.openCriticalAlerts).toBeGreaterThan(0)
  })

  it('reuses priority actions from operations snapshot', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(mixedAssets, mixedDrivers, now)
    const ops = computeOperationsSnapshot(mixedAssets, mixedDrivers, now)

    expect(snapshot.priorityActions).toEqual(ops.priorityActions)
  })

  it('marks assignment coverage unavailable when fleet is empty', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot([], [], now)

    expect(snapshot.assignment.assignmentCoverageLabel).toBe('Unavailable')
    expect(snapshot.assignment.assignmentCoveragePercent).toBeNull()
    expect(snapshot.kpis.totalVehicles).toBe(0)
  })
})

describe('buildAssignmentAnalytics', () => {
  it('calculates assignment coverage percentage', () => {
    expect(buildAssignmentAnalytics(4, 3, 1)).toEqual({
      totalVehicles: 4,
      assignedVehicles: 3,
      unassignedVehicles: 1,
      assignmentCoveragePercent: 75,
      assignmentCoverageLabel: '75%',
    })
  })

  it('returns unavailable label when total vehicles is zero', () => {
    expect(buildAssignmentAnalytics(0, 0, 0)).toEqual({
      totalVehicles: 0,
      assignedVehicles: 0,
      unassignedVehicles: 0,
      assignmentCoveragePercent: null,
      assignmentCoverageLabel: 'Unavailable',
    })
  })
})

describe('executiveAnalyticsCopilotHelpers', () => {
  const now = new Date(Date.UTC(2026, 7, 14))

  it('builds compact executive context without role or PII', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(
      [
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
          driverName: 'Unassigned',
        },
      ],
      [{ fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' }],
      now,
    )

    const context = buildExecutiveCopilotContext(snapshot)

    expect(context.telemetryMode).toBe('simulated')
    expect(context.fleetHealthSummary).toContain('telemetryMode: simulated')
    expect(context.fleetHealthSummary?.some((row) => row.startsWith('openCriticalAlerts:'))).toBe(
      true,
    )
    expect(context.operationalPriorities?.[0]).toContain('CRITICAL')
    expect(JSON.stringify(context)).not.toMatch(/role|personalCode|licenseNumber/i)
  })

  it('includes executive authority rules in system instruction via fleet health context', () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(
      [
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
          driverName: 'Unassigned',
        },
      ],
      [],
      now,
    )
    const instruction = buildSystemInstruction(buildExecutiveCopilotContext(snapshot))

    expect(EXECUTIVE_AUTHORITY_RULES).toContain('supplied executive snapshot is authoritative')
    expect(instruction).toContain('simulated')
    expect(instruction).toContain('Fleet health summary')
  })
})
