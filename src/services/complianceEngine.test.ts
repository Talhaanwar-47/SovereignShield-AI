import { describe, expect, it } from 'vitest'
import { classifyLicenseStatus, computeComplianceSnapshot } from './complianceEngine'
import { buildComplianceExplainContext } from './complianceCopilotHelpers'
import { buildSystemInstruction } from './geminiCopilotHelpers'

describe('complianceEngine', () => {
  const now = new Date(Date.UTC(2026, 7, 14))

  it('classifies expired license as EXPIRED', () => {
    expect(classifyLicenseStatus('01/01/2020', now)).toBe('EXPIRED')
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' }],
      [],
      now,
    )
    expect(snapshot.expiredCount).toBe(1)
    expect(snapshot.driverCompliance[0]?.licenseStatus).toBe('EXPIRED')
    expect(snapshot.driverCompliance[0]?.recommendedAction).toBe(
      'Resolve license compliance issue',
    )
  })

  it('classifies license expiring within 30 days as EXPIRING_SOON', () => {
    expect(classifyLicenseStatus('20 / 08 / 2026', now)).toBe('EXPIRING_SOON')
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'Mari Ots', expiryDate: '20 / 08 / 2026' }],
      [],
      now,
    )
    expect(snapshot.expiringSoonCount).toBe(1)
    expect(snapshot.driverCompliance[0]?.compliancePriority).toBe('HIGH')
  })

  it('classifies valid future license as VALID', () => {
    expect(classifyLicenseStatus('12 / 11 / 2026', now)).toBe('VALID')
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
      [],
      now,
    )
    expect(snapshot.validCount).toBe(1)
    expect(snapshot.driverCompliance[0]?.recommendedAction).toBe('No immediate action')
  })

  it('treats missing expiry as UNKNOWN', () => {
    expect(classifyLicenseStatus('—', now)).toBe('UNKNOWN')
    expect(classifyLicenseStatus('', now)).toBe('UNKNOWN')
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'Unknown Driver', expiryDate: '—' }],
      [],
      now,
    )
    expect(snapshot.unknownCount).toBe(1)
    expect(snapshot.driverCompliance[0]?.expiryDate).toBeNull()
  })

  it('treats unparseable expiry as UNKNOWN', () => {
    expect(classifyLicenseStatus('not-a-date', now)).toBe('UNKNOWN')
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'Bad Date Driver', expiryDate: 'not-a-date' }],
      [],
      now,
    )
    expect(snapshot.unknownCount).toBe(1)
  })

  it('returns safe compliance percentage state when zero parseable drivers', () => {
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'No Date', expiryDate: '—' }],
      [],
      now,
    )
    expect(snapshot.compliancePercentage).toBeNull()
    expect(snapshot.compliancePercentageLabel).toBe(
      'Unavailable — no parseable expiry data',
    )
  })

  it('calculates compliance percentage from known statuses only', () => {
    const snapshot = computeComplianceSnapshot(
      [
        { fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' },
        { fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' },
        { fullName: 'No Date', expiryDate: '—' },
      ],
      [],
      now,
    )
    expect(snapshot.compliancePercentage).toBe(50)
    expect(snapshot.compliancePercentageLabel).toBe('50%')
    expect(snapshot.unknownCount).toBe(1)
  })

  it('orders critical items deterministically by priority', () => {
    const snapshot = computeComplianceSnapshot(
      [
        { fullName: 'Mari Ots', expiryDate: '20 / 08 / 2026' },
        { fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' },
      ],
      [
        {
          assetId: 'EE-FLEET-118',
          driverName: 'Unassigned',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
        },
      ],
      now,
    )

    expect(snapshot.criticalItems[0]?.priority).toBe('CRITICAL')
    expect(snapshot.criticalItems.map((i) => i.subject)).toContain('Kristjan Kivi')
    expect(snapshot.criticalItems.map((i) => i.subject)).toContain('EE-FLEET-118')
  })

  it('isolates driver scope — no cross-driver records in snapshot', () => {
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
      [],
      now,
    )
    expect(JSON.stringify(snapshot)).not.toContain('Kristjan Kivi')
    expect(JSON.stringify(snapshot)).not.toContain('Mari Ots')
  })

  it('labels vehicle compliance as simulated telemetry', () => {
    const snapshot = computeComplianceSnapshot(
      [],
      [
        {
          assetId: 'EE-FLEET-118',
          driverName: 'Unassigned',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
        },
      ],
      now,
    )
    expect(snapshot.vehicleCompliance[0]?.simulated).toBe(true)
    expect(snapshot.vehicleCompliance[0]?.source).toBe('simulated-telemetry')
    expect(snapshot.criticalItems.some((i) => i.simulated === true)).toBe(true)
  })

  it('does not generate driver risk scores', () => {
    const snapshot = computeComplianceSnapshot(
      [{ fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' }],
      [
        {
          assetId: 'EE-FLEET-118',
          driverName: 'Unassigned',
          status: 'critical',
          statusLabel: 'CRITICAL WARNING',
        },
      ],
      now,
    )
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(/riskScore|risk_score|"high risk"/i)
    expect(snapshot.driverCompliance[0]?.compliancePriority).toBe('CRITICAL')
    expect(snapshot.driverCompliance[0]?.licenseStatus).toBe('EXPIRED')
  })

  it('returns empty snapshot for zero drivers', () => {
    const snapshot = computeComplianceSnapshot([], [], now)
    expect(snapshot.totalDrivers).toBe(0)
    expect(snapshot.driverCompliance).toEqual([])
    expect(snapshot.compliancePercentage).toBeNull()
  })
})

describe('complianceCopilotHelpers', () => {
  it('builds compliance explain context without PII or risk scores', () => {
    const snapshot = computeComplianceSnapshot(
      [
        { fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' },
        { fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' },
      ],
      [],
      new Date(Date.UTC(2026, 7, 14)),
    )
    const context = buildComplianceExplainContext(snapshot)

    expect(context.fleetHealthSummary).toContain('expiredCount: 1')
    expect(context.operationalPriorities?.some((r) => r.includes('Kristjan Kivi'))).toBe(true)
    expect(JSON.stringify(context)).not.toContain('personalCode')
    expect(JSON.stringify(context)).not.toContain('licenseNumber')
    expect(JSON.stringify(context)).not.toMatch(/riskScore|risk_score/i)
    expect(context).not.toHaveProperty('role')

    const instruction = buildSystemInstruction(context)
    expect(instruction).not.toContain('39001010006')
    expect(instruction).toContain('simulated')
  })
})
