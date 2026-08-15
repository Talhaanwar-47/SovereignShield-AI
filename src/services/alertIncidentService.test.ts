import { describe, expect, it } from 'vitest'
import {
  alertsFromOperationsSnapshot,
  buildDeterministicAlertId,
  computeAlertSummary,
  filterAlerts,
  isValidAlertTransition,
  nextAlertState,
  priorityItemToAlert,
} from './alertIncidentService'
import { computeOperationsSnapshot } from './operationsPriorityEngine'
import {
  buildAlertExplainContext,
  buildAlertExplainInstruction,
  buildAlertExplainPrompt,
  buildScopedAlertExplainContext,
  buildSelectedAlertRef,
} from './alertCopilotHelpers'
import { buildSystemInstruction, scopeTrustedContextToSelectedAlert } from './geminiCopilotHelpers'
import type { CopilotContext } from './geminiCopilotHelpers'
import alertCopilotSource from './alertCopilotHelpers.ts?raw'
import geminiCopilotSource from './geminiCopilot.ts?raw'
import edgeIndexSource from '../../supabase/functions/gemini-copilot/index.ts?raw'
import authProfileSource from './authProfile.ts?raw'
import demoProvisioningSource from './demoProvisioning.ts?raw'
import rlsMigrationSource from '../../supabase/migrations/20260817000000_role_aware_rls_policies.sql?raw'

describe('alertIncidentService', () => {
  const now = new Date(Date.UTC(2026, 7, 14))

  const mixedSnapshot = computeOperationsSnapshot(
    [
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
      {
        assetId: 'EE-FLEET-402',
        status: 'optimal',
        statusLabel: 'OPTIMAL CLEARANCE',
      },
    ],
    [
      { fullName: 'Kristjan Kivi', expiryDate: '01/01/2020' },
      { fullName: 'Mari Ots', expiryDate: '20 / 08 / 2026' },
    ],
    now,
  )

  it('derives alerts from operations snapshot without recalculating priorities', () => {
    const alerts = alertsFromOperationsSnapshot(mixedSnapshot)

    expect(alerts).toHaveLength(mixedSnapshot.priorityActions.length)
    expect(alerts.map((a) => a.subjectName)).toEqual(
      mixedSnapshot.priorityActions.map((p) => p.subject),
    )
  })

  it('maps critical vehicle to CRITICAL simulated alert', () => {
    const item = mixedSnapshot.priorityActions.find((p) => p.subject === 'EE-FLEET-118')!
    const alert = priorityItemToAlert(item)

    expect(alert).toMatchObject({
      severity: 'critical',
      category: 'vehicle',
      subjectName: 'EE-FLEET-118',
      title: 'Critical Warning',
      simulated: true,
      source: 'simulated-vehicle-telemetry',
      state: 'open',
    })
    expect(alert.description).toContain('simulated demo telemetry')
  })

  it('maps expired license to CRITICAL compliance alert', () => {
    const item = mixedSnapshot.priorityActions.find((p) => p.subject === 'Kristjan Kivi')!
    const alert = priorityItemToAlert(item)

    expect(alert).toMatchObject({
      severity: 'critical',
      category: 'compliance',
      subjectName: 'Kristjan Kivi',
      title: 'Expired License',
      simulated: false,
      source: 'license-expiry-registry',
    })
  })

  it('maps docking vehicle to HIGH simulated alert', () => {
    const item = mixedSnapshot.priorityActions.find((p) => p.subject === 'EE-FLEET-991')!
    const alert = priorityItemToAlert(item)

    expect(alert).toMatchObject({
      severity: 'high',
      category: 'vehicle',
      title: 'DOCK CHARGING',
      simulated: true,
    })
  })

  it('produces stable deterministic alert ids', () => {
    const item = mixedSnapshot.priorityActions[0]!
    expect(buildDeterministicAlertId(item)).toBe(buildDeterministicAlertId(item))
    expect(buildDeterministicAlertId(item)).toMatch(/^vehicle:EE-FLEET-/)
  })

  it('computes summary counts including lifecycle overrides', () => {
    const alerts = alertsFromOperationsSnapshot(mixedSnapshot, {
      [buildDeterministicAlertId(mixedSnapshot.priorityActions[0]!)]: 'acknowledged',
      [buildDeterministicAlertId(mixedSnapshot.priorityActions[1]!)]: 'resolved',
    })

    const summary = computeAlertSummary(alerts)
    expect(summary.total).toBe(4)
    expect(summary.critical).toBe(2)
    expect(summary.high).toBe(2)
    expect(summary.acknowledged).toBe(1)
    expect(summary.resolved).toBe(1)
    expect(summary.open).toBe(2)
  })

  it('filters alerts client-side by severity, category, and state', () => {
    const alerts = alertsFromOperationsSnapshot(mixedSnapshot, {
      [buildDeterministicAlertId(mixedSnapshot.priorityActions[0]!)]: 'acknowledged',
    })

    expect(filterAlerts(alerts, 'critical')).toHaveLength(2)
    expect(filterAlerts(alerts, 'vehicle')).toHaveLength(2)
    expect(filterAlerts(alerts, 'compliance')).toHaveLength(2)
    expect(filterAlerts(alerts, 'acknowledged')).toHaveLength(1)
  })

  it('supports alert lifecycle transitions in demo session state', () => {
    expect(isValidAlertTransition('open', 'acknowledge')).toBe(true)
    expect(nextAlertState('acknowledge')).toBe('acknowledged')
    expect(nextAlertState('resolve')).toBe('resolved')
    expect(nextAlertState('reopen')).toBe('open')
    expect(isValidAlertTransition('resolved', 'acknowledge')).toBe(false)
  })

  it('returns empty alert set for healthy fleet with no elevated priorities', () => {
    const healthy = computeOperationsSnapshot(
      [{ assetId: 'EE-FLEET-402', status: 'optimal', statusLabel: 'OPTIMAL CLEARANCE' }],
      [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
      now,
    )
    const alerts = alertsFromOperationsSnapshot(healthy)

    expect(alerts).toEqual([])
    expect(computeAlertSummary(alerts).total).toBe(0)
  })

  it('Driver scope cannot include another driver in alert derivation', () => {
    const driverScoped = computeOperationsSnapshot(
      [{ assetId: 'EE-FLEET-991', status: 'optimal', statusLabel: 'OPTIMAL CLEARANCE' }],
      [{ fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' }],
      now,
    )
    const alerts = alertsFromOperationsSnapshot(driverScoped)

    expect(JSON.stringify(alerts)).not.toContain('Kristjan Kivi')
    expect(JSON.stringify(alerts)).not.toContain('Mari Ots')
  })

  it('labels simulated telemetry on vehicle alerts', () => {
    const alerts = alertsFromOperationsSnapshot(mixedSnapshot)
    const vehicleAlert = alerts.find((a) => a.category === 'vehicle')!
    expect(vehicleAlert.simulated).toBe(true)
    expect(vehicleAlert.source).toBe('simulated-vehicle-telemetry')
  })
})

function mixedTrustedContext(): CopilotContext {
  return {
    assignments: [
      'EE-FLEET-118 -> Unassigned',
      'EE-DEMO-118 -> Unassigned',
      'EE-DEMO-991 -> Demo Driver Alex',
    ],
    licenseExpiry: [
      'Kristjan Kivi -> expired',
      'Demo Driver Blake -> expired',
      'Jürgen Tamm -> 12 / 11 / 2026',
    ],
    simulatedClearance: [
      'EE-FLEET-118 -> CRITICAL WARNING',
      'EE-DEMO-118 -> CRITICAL WARNING',
      'EE-DEMO-991 -> OPTIMAL CLEARANCE',
    ],
    operationalPriorities: [
      'CRITICAL | EE-FLEET-118 | Critical Warning (simulated) | Action: Review vehicle condition',
      'CRITICAL | EE-DEMO-118 | Critical Warning (simulated) | Action: Review vehicle condition',
      'CRITICAL | Kristjan Kivi | Expired License | Action: Resolve compliance issue',
      'CRITICAL | Demo Driver Blake | Expired License | Action: Resolve compliance issue',
    ],
    recommendedActions: [
      'Review EE-FLEET-118',
      'Review EE-DEMO-118',
      "Resolve Kristjan Kivi's expired license",
      "Resolve Demo Driver Blake's expired license",
    ],
    fleetHealthSummary: ['critical: 2', 'telemetryMode: simulated'],
    telemetryMode: 'simulated',
    snapshotVersion: 9,
    snapshotCapturedAt: '2026-08-15T06:00:00.000Z',
  }
}

describe('alertCopilotHelpers', () => {
  it('builds minimal Gemini context for a single alert without PII or role', () => {
    const alert = priorityItemToAlert({
      level: 'CRITICAL',
      category: 'vehicle',
      subject: 'EE-FLEET-118',
      headline: 'Critical Warning',
      detail: 'CRITICAL WARNING (simulated demo telemetry)',
      action: 'Review vehicle condition',
      simulated: true,
    })

    const context = buildAlertExplainContext(alert)
    expect(context.operationalPriorities?.[0]).toContain('EE-FLEET-118')
    expect(context.operationalPriorities?.[0]).toContain('simulated')
    expect(context.telemetryMode).toBe('simulated')
    expect(JSON.stringify(context)).not.toContain('personalCode')
    expect(JSON.stringify(context)).not.toContain('licenseNumber')
    expect(context).not.toHaveProperty('role')

    const instruction = buildSystemInstruction(context)
    expect(instruction).toContain('Operational priority snapshot (authoritative, deterministic)')
    expect(instruction).toContain('simulated')
    expect(instruction).toContain('Selected-alert explain rules')
  })

  it('A — Demo Driver Blake expired-license explain excludes EE-DEMO-118', () => {
    const alert = priorityItemToAlert({
      level: 'CRITICAL',
      category: 'compliance',
      subject: 'Demo Driver Blake',
      headline: 'Expired License',
      detail: 'License expired',
      action: 'Resolve compliance issue',
      simulated: false,
    })

    const scoped = buildScopedAlertExplainContext(mixedTrustedContext(), alert)
    const serialized = JSON.stringify(scoped)
    const instruction = buildSystemInstruction(scoped)

    expect(scoped.selectedAlertSubject).toContain('Demo Driver Blake')
    expect(scoped.selectedAlertSubject).toContain('Expired License')
    expect(scoped.operationalPriorities).toEqual([
      'CRITICAL | Demo Driver Blake | Expired License | Action: Resolve compliance issue',
    ])
    expect(scoped.licenseExpiry).toEqual(['Demo Driver Blake -> expired'])
    expect(scoped.recommendedActions).toEqual(['Resolve compliance issue'])
    expect(serialized).toContain('Demo Driver Blake')
    expect(serialized).toContain('Expired License')
    expect(serialized).toContain('expired')
    expect(serialized).toContain('Resolve compliance issue')
    expect(serialized).not.toContain('EE-DEMO-118')
    expect(serialized).not.toContain('CRITICAL WARNING')
    expect(instruction).not.toContain('EE-DEMO-118')
    expect(instruction).toContain('Demo Driver Blake')
    expect(buildAlertExplainPrompt(alert)).toContain('Demo Driver Blake')
    expect(buildAlertExplainPrompt(alert)).not.toContain('EE-DEMO-118')
  })

  it('B — EE-DEMO-118 critical-warning explain excludes Blake license', () => {
    const alert = priorityItemToAlert({
      level: 'CRITICAL',
      category: 'vehicle',
      subject: 'EE-DEMO-118',
      headline: 'Critical Warning',
      detail: 'CRITICAL WARNING (simulated demo telemetry)',
      action: 'Review vehicle condition',
      simulated: true,
    })

    const scoped = buildScopedAlertExplainContext(mixedTrustedContext(), alert)
    const serialized = JSON.stringify(scoped)
    const instruction = buildSystemInstruction(scoped)

    expect(scoped.selectedAlertSubject).toContain('EE-DEMO-118')
    expect(scoped.selectedAlertSubject).toContain('Critical Warning')
    expect(scoped.operationalPriorities?.[0]).toContain('EE-DEMO-118')
    expect(scoped.simulatedClearance).toEqual(['EE-DEMO-118 -> CRITICAL WARNING'])
    expect(scoped.telemetryMode).toBe('simulated')
    expect(serialized).toContain('EE-DEMO-118')
    expect(serialized).toContain('Critical Warning')
    expect(serialized).toContain('simulated')
    expect(serialized).not.toContain('Demo Driver Blake')
    expect(serialized).not.toContain('Expired License')
    expect(instruction).toContain('EE-DEMO-118')
    expect(instruction).toContain('simulated')
    expect(instruction).not.toContain('Demo Driver Blake')
  })

  it('C — production compliance alert explain stays on that driver', () => {
    const alert = priorityItemToAlert({
      level: 'CRITICAL',
      category: 'compliance',
      subject: 'Kristjan Kivi',
      headline: 'Expired License',
      detail: 'License expired',
      action: 'Resolve compliance issue',
      simulated: false,
    })

    const scoped = buildScopedAlertExplainContext(mixedTrustedContext(), alert)
    const serialized = JSON.stringify(scoped)

    expect(serialized).toContain('Kristjan Kivi')
    expect(serialized).toContain('Expired License')
    expect(serialized).not.toContain('EE-FLEET-118')
    expect(serialized).not.toContain('Demo Driver Blake')
    expect(buildAlertExplainInstruction(alert)).toContain('Kristjan Kivi')
  })

  it('D — production vehicle alert explain stays on that vehicle', () => {
    const alert = priorityItemToAlert({
      level: 'CRITICAL',
      category: 'vehicle',
      subject: 'EE-FLEET-118',
      headline: 'Critical Warning',
      detail: 'CRITICAL WARNING (simulated demo telemetry)',
      action: 'Review vehicle condition',
      simulated: true,
    })

    const scoped = buildScopedAlertExplainContext(mixedTrustedContext(), alert)
    const serialized = JSON.stringify(scoped)

    expect(serialized).toContain('EE-FLEET-118')
    expect(serialized).toContain('Critical Warning')
    expect(serialized).not.toContain('Kristjan Kivi')
    expect(serialized).not.toContain('Demo Driver Blake')
  })

  it('E — selected alert id/category/subject determines scoped context', () => {
    const trusted = mixedTrustedContext()
    const blake = scopeTrustedContextToSelectedAlert(trusted, {
      id: 'compliance:demo-driver-blake:expired-license',
      category: 'compliance',
      subjectName: 'Demo Driver Blake',
      title: 'Expired License',
    })
    const vehicle = scopeTrustedContextToSelectedAlert(trusted, {
      id: 'vehicle:EE-DEMO-118:critical-warning',
      category: 'vehicle',
      subjectName: 'EE-DEMO-118',
      title: 'Critical Warning',
    })

    expect(blake.selectedAlertSubject).toContain('id=compliance:demo-driver-blake:expired-license')
    expect(blake.selectedAlertSubject).toContain('compliance')
    expect(vehicle.selectedAlertSubject).toContain('id=vehicle:EE-DEMO-118:critical-warning')
    expect(vehicle.selectedAlertSubject).toContain('vehicle')
    expect(blake.operationalPriorities?.[0]).not.toEqual(vehicle.operationalPriorities?.[0])
  })

  it('F — no cross-alert contamination when scoping a mixed snapshot', () => {
    const trusted = mixedTrustedContext()
    const blakeAlert = priorityItemToAlert({
      level: 'CRITICAL',
      category: 'compliance',
      subject: 'Demo Driver Blake',
      headline: 'Expired License',
      detail: 'License expired',
      action: 'Resolve compliance issue',
      simulated: false,
    })
    const scoped = buildScopedAlertExplainContext(trusted, blakeAlert)

    expect(scoped.operationalPriorities).toHaveLength(1)
    expect(scoped.assignments).toBeUndefined()
    expect(scoped.simulatedClearance).toBeUndefined()
    expect(scoped.fleetHealthSummary).toBeUndefined()
    expect(JSON.stringify(scoped)).not.toContain('EE-FLEET-118')
    expect(JSON.stringify(scoped)).not.toContain('Kristjan Kivi')
    expect(buildSelectedAlertRef(blakeAlert)).toEqual({
      id: blakeAlert.id,
      category: 'compliance',
      subjectName: 'Demo Driver Blake',
      title: 'Expired License',
    })
  })

  it('G — demo role permissions and production auth paths stay unchanged', () => {
    expect(rlsMigrationSource).toContain('drivers_select_admin_fm')
    expect(rlsMigrationSource).toContain('drivers_select_assigned')
    expect(authProfileSource).toContain("role === 'admin' || role === 'fleet-manager' || role === 'driver'")
    expect(demoProvisioningSource).toContain("['admin', 'fleet-manager', 'driver']")
    expect(alertCopilotSource).toContain('selectedAlert: buildSelectedAlertRef(alert)')
    expect(geminiCopilotSource).toContain('options.selectedAlert')
    expect(edgeIndexSource).toContain('scopeTrustedContextToSelectedAlert')
    expect(edgeIndexSource).toContain('buildTrustedCopilotContextForUser')
  })
})
