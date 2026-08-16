import { describe, expect, it } from 'vitest'
import {
  buildOpsCopilotContext,
  OPS_PRIORITY_AUTHORITY_RULES,
} from './operationsCopilotHelpers'
import {
  computeOperationsSnapshot,
  isLicenseApproachingExpiry,
  isLicenseExpired,
} from './operationsPriorityEngine'
import { buildSystemInstruction } from './geminiCopilotHelpers'

describe('operationsPriorityEngine', () => {
  const now = new Date(Date.UTC(2026, 7, 14))

  it('flags critical vehicle simulated status as CRITICAL priority', () => {
    const snapshot = computeOperationsSnapshot(
      [
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
        },
      ],
      [],
      now,
    )

    expect(snapshot.priorityActions).toHaveLength(1)
    expect(snapshot.priorityActions[0]).toMatchObject({
      level: 'CRITICAL',
      category: 'vehicle',
      subject: 'EE-FLEET-118',
      headline: 'Critical Warning',
      simulated: true,
    })
    expect(snapshot.priorityActions[0]?.detail).toContain('simulated demo telemetry')
  })

  it('flags expired license as CRITICAL compliance priority', () => {
    const snapshot = computeOperationsSnapshot(
      [],
      [{ fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' }],
      now,
    )

    expect(snapshot.priorityActions).toHaveLength(1)
    expect(snapshot.priorityActions[0]).toMatchObject({
      level: 'CRITICAL',
      category: 'compliance',
      subject: 'Kristjan Kivi',
      headline: 'Expired License',
      simulated: false,
    })
  })

  it('treats optimal vehicle as NORMAL and omits from priority actions', () => {
    const snapshot = computeOperationsSnapshot(
      [
        {
          assetId: 'EE-FLEET-991',
          status: 'optimal',
          statusLabel: 'OPTIMAL CLEARANCE',
        },
      ],
      [],
      now,
    )

    expect(snapshot.health.optimal).toBe(1)
    expect(snapshot.priorityActions).toHaveLength(0)
    expect(snapshot.operationalPriorities[0]).toContain('No critical or high-priority items')
  })

  it('treats valid future license as NORMAL compliance', () => {
    const snapshot = computeOperationsSnapshot(
      [],
      [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
      now,
    )

    expect(snapshot.priorityActions).toHaveLength(0)
    expect(isLicenseExpired('12 / 11 / 2026', now)).toBe(false)
  })

  it('flags approaching expiry as HIGH when date is parseable', () => {
    expect(isLicenseApproachingExpiry('20 / 08 / 2026', now)).toBe(true)

    const snapshot = computeOperationsSnapshot(
      [],
      [{ fullName: 'Mari Ots', expiryDate: '20 / 08 / 2026' }],
      now,
    )

    expect(snapshot.priorityActions).toHaveLength(1)
    expect(snapshot.priorityActions[0]).toMatchObject({
      level: 'HIGH',
      category: 'compliance',
      subject: 'Mari Ots',
      headline: 'License Approaching Expiry',
    })
  })

  it('orders multiple issues deterministically: CRITICAL before HIGH, vehicle before compliance', () => {
    const snapshot = computeOperationsSnapshot(
      [
        {
          assetId: 'EE-FLEET-402',
          status: 'optimal',
          statusLabel: 'OPTIMAL CLEARANCE',
        },
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
        },
        {
          assetId: 'EE-FLEET-991',
          status: 'docking',
          statusLabel: 'DOCK CHARGING',
        },
      ],
      [
        { fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' },
        { fullName: 'Mari Ots', expiryDate: '20 / 08 / 2026' },
      ],
      now,
    )

    expect(snapshot.priorityActions.map((item) => `${item.level}:${item.subject}`)).toEqual([
      'CRITICAL:EE-FLEET-118',
      'CRITICAL:Kristjan Kivi',
      'HIGH:EE-FLEET-991',
      'HIGH:Mari Ots',
    ])
  })

  it('returns healthy empty state when no fleet data is available', () => {
    const snapshot = computeOperationsSnapshot([], [], now)

    expect(snapshot.health.totalVehicles).toBe(0)
    expect(snapshot.priorityActions).toEqual([])
    expect(snapshot.recommendedActions).toEqual([])
    expect(snapshot.fleetHealthSummary).toContain('totalVehicles: 0')
    expect(snapshot.telemetryMode).toBe('simulated')
  })

  it('labels simulated telemetry in vehicle priority rows', () => {
    const snapshot = computeOperationsSnapshot(
      [
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
        },
      ],
      [],
      now,
    )

    expect(snapshot.operationalPriorities[0]).toContain('(simulated)')
    expect(snapshot.fleetHealthSummary).toContain('telemetryMode: simulated')
  })

  it('builds recommended actions without inventing database tickets', () => {
    const snapshot = computeOperationsSnapshot(
      [
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
        },
      ],
      [{ fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' }],
      now,
    )

    expect(snapshot.recommendedActions).toEqual([
      'Review EE-FLEET-118',
      "Resolve Kristjan Kivi's expired license",
      'Recheck fleet status after corrective action',
    ])
  })

  it('Driver scope only includes supplied driver rows (no cross-driver leakage in engine)', () => {
    const driverScoped = computeOperationsSnapshot(
      [{ assetId: 'EE-FLEET-991', status: 'optimal', statusLabel: 'OPTIMAL CLEARANCE' }],
      [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
      now,
    )

    expect(JSON.stringify(driverScoped)).not.toContain('Kristjan Kivi')
    expect(JSON.stringify(driverScoped)).not.toContain('Mari Ots')
    expect(driverScoped.priorityActions).toHaveLength(0)
  })
})

describe('operationsCopilotHelpers', () => {
  it('merges fleet and operational priority context without PII', () => {
    const context = buildOpsCopilotContext(
      [
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
          driverName: 'Unassigned',
        },
      ],
      [{ fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' }],
    )

    expect(context.telemetryMode).toBe('simulated')
    expect(context.operationalPriorities?.[0]).toContain('CRITICAL | EE-FLEET-118')
    expect(context.fleetHealthSummary).toContain('critical: 1')
    expect(context.recommendedActions).toContain('Review EE-FLEET-118')
    expect(JSON.stringify(context)).not.toContain('personalCode')
    expect(JSON.stringify(context)).not.toContain('licenseNumber')
    expect(context).not.toHaveProperty('role')
  })

  it('injects authoritative ops priority rules into Gemini system instruction', () => {
    const context = buildOpsCopilotContext(
      [
        {
          assetId: 'EE-FLEET-118',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
          driverName: 'Unassigned',
        },
      ],
      [],
    )
    const instruction = buildSystemInstruction(context)

    expect(instruction).toContain(OPS_PRIORITY_AUTHORITY_RULES)
    expect(instruction).toContain('Operational priority snapshot (authoritative, deterministic)')
    expect(instruction).toContain('Fleet health summary (deterministic, simulated telemetry where applicable)')
    expect(instruction).toContain('simulated demo telemetry')
  })
})
