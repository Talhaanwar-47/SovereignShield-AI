import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { parseCopilotRequest, scopeTrustedContextToSelectedAlert } from './helpers'
import {
  buildTrustedCopilotContext,
  fetchAuthorizedFleetData,
  mergeValidatedClientDemoClearance,
  resetServerSnapshotVersionCounter,
  type AuthorizedFleetData,
} from './trustedContext'

const functionDir = dirname(fileURLToPath(import.meta.url))
const indexSource = readFileSync(join(functionDir, 'index.ts'), 'utf8')
const helpersSource = readFileSync(join(functionDir, 'helpers.ts'), 'utf8')
const trustedSource = readFileSync(join(functionDir, 'trustedContext.ts'), 'utf8')

const adminFleet: AuthorizedFleetData = {
  membershipRole: 'admin',
  assets: [
    {
      assetId: 'EE-FLEET-991',
      driverName: 'Jürgen Tamm',
      status: 'optimal',
      statusLabel: 'OPTIMAL CLEARANCE',
    },
    {
      assetId: 'EE-FLEET-118',
      driverName: 'Unassigned',
      status: 'critical',
      statusLabel: 'CRITICAL WARNING',
    },
  ],
  drivers: [
    { fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' },
    { fullName: 'Mari Ots', expiryDate: '01 / 01 / 2020' },
  ],
}

describe('server-trusted Copilot context', () => {
  beforeEach(() => {
    resetServerSnapshotVersionCounter()
  })

  it('ignores client-supplied assignment strings and uses server fleet rows', () => {
    const context = buildTrustedCopilotContext({
      fleetData: adminFleet,
      clientDemoTelemetry: {
        simulatedClearance: ['EE-FLEET-999 -> CRITICAL WARNING'],
      },
    })

    expect(context.assignments).toEqual([
      'EE-FLEET-991 -> Jürgen Tamm',
      'EE-FLEET-118 -> Unassigned',
    ])
    expect(context.assignments).not.toContain('EE-FLEET-999 -> Attacker Driver')
    expect(context.simulatedClearance).not.toContain('EE-FLEET-999 -> CRITICAL WARNING')
  })

  it('ignores client-supplied licenseExpiry injection and uses server driver rows', () => {
    const parsed = parseCopilotRequest({
      prompt: 'Show drivers with expired licenses',
      context: {
        licenseExpiry: ['Attacker -> expired', 'Fake Driver -> 01 / 01 / 2099'],
        assignments: ['EE-FLEET-999 -> Attacker Driver'],
      },
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const context = buildTrustedCopilotContext({
      fleetData: adminFleet,
      clientDemoTelemetry: parsed.value.clientDemoTelemetry,
    })

    expect(context.licenseExpiry).toContain('Mari Ots -> expired')
    expect(context.licenseExpiry).toContain('Jürgen Tamm -> 12 / 11 / 2026')
    expect(JSON.stringify(context)).not.toContain('Attacker')
    expect(JSON.stringify(context)).not.toContain('Fake Driver')
  })

  it('rejects unknown vehicle IDs in client demo telemetry', () => {
    const merged = mergeValidatedClientDemoClearance(
      new Set(['EE-FLEET-118', 'EE-FLEET-991']),
      ['EE-FLEET-118 -> CRITICAL WARNING', 'EE-FLEET-999 -> OPTIMAL CLEARANCE'],
    )

    expect(merged.size).toBe(1)
    expect(merged.get('EE-FLEET-118')).toBe('CRITICAL WARNING')
    expect(merged.has('EE-FLEET-999')).toBe(false)
  })

  it('never trusts organization_id, driver_id, or vehicle_id in the request body', () => {
    const parsed = parseCopilotRequest({
      prompt: 'Fleet status?',
      organization_id: '00000000-0000-0000-0000-000000000099',
      driver_id: '00000000-0000-0000-0000-000000000088',
      vehicle_id: 'EE-FLEET-999',
      role: 'admin',
      user_id: '00000000-0000-0000-0000-000000000077',
    })

    expect(parsed.ok).toBe(true)
    expect(indexSource).toContain('buildTrustedCopilotContextForUser')
    expect(indexSource).not.toContain('body.organization_id')
    expect(indexSource).not.toContain('record.organization_id')
    expect(indexSource).not.toContain('body.driver_id')
    expect(indexSource).not.toContain('body.vehicle_id')
    expect(helpersSource).not.toContain('body.organization_id')
    expect(helpersSource).not.toContain('record.organization_id')
  })

  it('builds ops fields server-side from authorized fleet rows', () => {
    const context = buildTrustedCopilotContext({
      fleetData: adminFleet,
      clientDemoTelemetry: {
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
      },
    })

    expect(context.operationalPriorities?.some((row) => row.includes('EE-FLEET-118'))).toBe(true)
    expect(context.fleetHealthSummary).toContain('telemetryMode: simulated')
    expect(context.recommendedActions?.length).toBeGreaterThan(0)
  })

  it('preserves natural-language prompt parsing and excludes PII from trusted context', () => {
    const parsed = parseCopilotRequest({
      prompt: '  Which vehicles require maintenance?  ',
      context: {
        personalCode: '39001010006',
        licenseNumber: 'EE-B0984122',
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
      },
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.prompt).toBe('Which vehicles require maintenance?')

    const context = buildTrustedCopilotContext({
      fleetData: adminFleet,
      clientDemoTelemetry: parsed.value.clientDemoTelemetry,
    })

    expect(JSON.stringify(context)).not.toContain('personalCode')
    expect(JSON.stringify(context)).not.toContain('licenseNumber')
    expect(JSON.stringify(context)).not.toContain('39001010006')
    expect(JSON.stringify(context)).not.toContain('EE-B0984122')
  })

  it('scopes driver fleet fetch by user_id for Driver membership role', async () => {
    const driverRows = [
      { id: 'd1', name: 'Driver One', expiry_date: '01 / 01 / 2030', user_id: 'user-1' },
    ]
    const driverResult = { data: driverRows, error: null }
    const eqMock = vi.fn().mockResolvedValue(driverResult)
    const inMock = vi.fn().mockResolvedValue({
      data: [{ id: 'd1', name: 'Driver One' }],
      error: null,
    })
    const driversSelect = vi.fn(() => ({
      eq: eqMock,
      in: inMock,
      then(onFulfilled: (value: typeof driverResult) => unknown) {
        return Promise.resolve(driverResult).then(onFulfilled)
      },
    }))
    const vehiclesSelect = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: 'v1',
            asset_id: 'EE-FLEET-991',
            assigned_driver_id: 'd1',
            compliance_tier: 'OPTIMAL CLEARANCE',
          },
        ],
        error: null,
      }),
    )

    const fromMock = vi.fn((table: string) => {
      if (table === 'drivers') {
        return { select: driversSelect }
      }
      if (table === 'vehicles') {
        return { select: vehiclesSelect }
      }
      return { select: vi.fn() }
    })

    const userClient = { from: fromMock } as unknown as Parameters<typeof fetchAuthorizedFleetData>[0]

    await fetchAuthorizedFleetData(userClient, 'user-1', 'driver')
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-1')

    eqMock.mockClear()
    await fetchAuthorizedFleetData(userClient, 'user-1', 'admin')
    expect(eqMock).not.toHaveBeenCalled()
  })

  it('marks client demo telemetry explicitly when merged', () => {
    const context = buildTrustedCopilotContext({
      fleetData: adminFleet,
      clientDemoTelemetry: {
        simulatedClearance: ['EE-FLEET-118 -> DOCK CHARGING'],
        snapshotVersion: 42,
        snapshotCapturedAt: '2026-08-15T09:00:00.000Z',
      },
    })

    expect(context.clientDemoTelemetryApplied).toBe(true)
    expect(context.clientSnapshotVersion).toBe(42)
    expect(context.clientSnapshotCapturedAt).toBe('2026-08-15T09:00:00.000Z')
    expect(context.snapshotVersion).toBe(1)
    expect(context.telemetryMode).toBe('simulated')
  })

  it('wires trusted context construction in the Edge handler', () => {
    expect(indexSource).toContain('buildTrustedCopilotContextForUser')
    const trustedCallPos = indexSource.indexOf('await buildTrustedCopilotContextForUser(')
    const upstreamCallPos = indexSource.indexOf('await fetchGeminiUpstreamWithRetry(')
    expect(trustedCallPos).toBeGreaterThan(-1)
    expect(upstreamCallPos).toBeGreaterThan(trustedCallPos)
    expect(trustedSource).toContain('fetchAuthorizedFleetData')
    expect(trustedSource).not.toContain('SERVICE_ROLE')
    expect(trustedSource).not.toMatch(/from\(['"]driver_pii['"]\)/)
    expect(trustedSource).not.toMatch(/select\([^)]*personal_code/)
    expect(trustedSource).not.toMatch(/select\([^)]*license_number/)
  })

  it('keeps existing retry wiring unchanged after trusted context integration', () => {
    expect(indexSource).toContain('fetchGeminiUpstreamWithRetry')
    expect(helpersSource).toContain('GEMINI_MAX_ATTEMPTS = 3')
    expect(helpersSource).toContain('GEMINI_UPSTREAM_TIMEOUT_MS = 40000')
  })

  it('scopes trusted context to the selected alert before Gemini', () => {
    resetServerSnapshotVersionCounter()
    const trusted = buildTrustedCopilotContext({
      fleetData: {
        membershipRole: 'admin',
        assets: [
          {
            assetId: 'EE-DEMO-118',
            driverName: 'Unassigned',
            status: 'critical',
            statusLabel: 'CRITICAL WARNING',
          },
        ],
        drivers: [{ fullName: 'Demo Driver Blake', expiryDate: '03 / 05 / 2025' }],
      },
      capturedAt: new Date('2026-08-15T06:00:00.000Z'),
    })

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

    expect(JSON.stringify(blake)).toContain('Demo Driver Blake')
    expect(JSON.stringify(blake)).not.toContain('EE-DEMO-118')
    expect(JSON.stringify(vehicle)).toContain('EE-DEMO-118')
    expect(JSON.stringify(vehicle)).not.toContain('Demo Driver Blake')
    expect(indexSource).toContain('scopeTrustedContextToSelectedAlert(trustedContext')
  })
})
