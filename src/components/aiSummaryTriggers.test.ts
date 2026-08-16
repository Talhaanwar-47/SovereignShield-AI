import { beforeEach, describe, expect, it, vi } from 'vitest'
import operationsSource from './OperationsCommandCenter.tsx?raw'
import executiveSource from './ExecutiveAnalytics.tsx?raw'
import dashboardSource from '../DashboardLayout.tsx?raw'
import edgeHelpersSource from '../../supabase/functions/gemini-copilot/helpers.ts?raw'
import type { DriverData } from '../types/driver'
import type { FleetAsset } from '../types/fleet'
import { computeOperationsSnapshot } from '../services/operationsPriorityEngine'
import {
  buildOpsCopilotContextAtRequestTime,
  fetchOperationsSummary,
} from '../services/operationsCopilotHelpers'
import {
  buildExecutiveCopilotContext,
  fetchExecutiveSummary,
} from '../services/executiveAnalyticsCopilotHelpers'
import { computeExecutiveAnalyticsSnapshot } from '../services/executiveAnalyticsEngine'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}))

const baseDrivers: DriverData[] = [
  {
    fullName: 'Jürgen Tamm',
    expiryDate: '12 / 11 / 2026',
    personalCode: '39001010006',
    licenseNumber: 'EE-B0984122',
    documentType: 'B',
    status: 'REGISTRY RECORD',
  },
]

const optimalAsset: FleetAsset = {
  assetId: 'EE-FLEET-991',
  driverName: 'Jürgen Tamm',
  speed: '62 km/h',
  energy: '74%',
  batteryPercent: 74,
  status: 'optimal',
  statusLabel: 'OPTIMAL CLEARANCE',
}

const criticalAsset: FleetAsset = {
  assetId: 'EE-FLEET-118',
  driverName: 'Unassigned',
  speed: '0 km/h',
  energy: '12%',
  batteryPercent: 12,
  status: 'critical',
  statusLabel: 'CRITICAL WARNING',
}

describe('AI summary triggers — no automatic Gemini on telemetry', () => {
  it('does not auto-invoke Gemini from Operations telemetry or priority changes', () => {
    expect(operationsSource).not.toMatch(/useEffect\([\s\S]*loadSummary/)
    expect(operationsSource).not.toContain('priorityKey')
    expect(operationsSource).toContain('Refresh AI Summary')
    expect(operationsSource).toContain('onClick={() => void loadSummary()}')
  })

  it('does not auto-invoke Gemini from Executive Analytics metric changes', () => {
    expect(executiveSource).not.toMatch(/useEffect\([\s\S]*loadSummary/)
    expect(executiveSource).not.toContain('summaryKey')
    expect(executiveSource).toContain('Refresh AI Summary')
    expect(executiveSource).toContain('onClick={() => void loadSummary()}')
  })

  it('keeps telemetry refresh separate from Gemini in DashboardLayout', () => {
    const intervalBlock = dashboardSource.match(
      /setInterval\(\(\) => \{[\s\S]*?\},\s*FLEET_TELEMETRY_INTERVAL_MS\)/,
    )?.[0]
    expect(intervalBlock).toBeDefined()
    expect(intervalBlock).toContain('simulateFleetTelemetry')
    expect(intervalBlock).not.toMatch(/gemini|invoke|fetchGemini|answerCopilot/i)
  })

  it('shows explicit-generation loading copy only during summaryLoading', () => {
    expect(operationsSource).toContain('Generating AI summary…')
    expect(executiveSource).toContain('Generating AI summary…')
    expect(operationsSource).not.toContain('Generating natural-language summary')
    expect(executiveSource).not.toContain('Generating executive summary from deterministic snapshot')
  })
})

describe('AI summary triggers — explicit user action and request-time snapshot', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({
      data: { text: 'Summarized fleet state.' },
      error: null,
    })
  })

  it('Operations builds context from current fleet rows at request time', () => {
    const before = buildOpsCopilotContextAtRequestTime([optimalAsset], baseDrivers)
    const after = buildOpsCopilotContextAtRequestTime([optimalAsset, criticalAsset], baseDrivers)

    expect(before.simulatedClearance).not.toEqual(after.simulatedClearance)
    expect(after.fleetHealthSummary?.some((row) => row.includes('critical: 1'))).toBe(true)
  })

  it('Operations explicit summary invokes Gemini once per call', async () => {
    const snapshot = computeOperationsSnapshot(
      [criticalAsset].map((asset) => ({
        assetId: asset.assetId,
        status: asset.status,
        statusLabel: asset.statusLabel,
      })),
      baseDrivers.map((driver) => ({
        fullName: driver.fullName,
        expiryDate: driver.expiryDate,
      })),
    )
    const context = buildOpsCopilotContextAtRequestTime([criticalAsset], baseDrivers, snapshot)

    await fetchOperationsSummary(context)

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]?.[0]).toBe('gemini-copilot')
  })

  it('Executive explicit summary invokes Gemini once per call', async () => {
    const snapshot = computeExecutiveAnalyticsSnapshot(
      [optimalAsset, criticalAsset].map((asset) => ({
        assetId: asset.assetId,
        status: asset.status,
        statusLabel: asset.statusLabel,
        driverName: asset.driverName,
      })),
      baseDrivers.map((driver) => ({
        fullName: driver.fullName,
        expiryDate: driver.expiryDate,
      })),
    )

    await fetchExecutiveSummary(snapshot)

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]?.[0]).toBe('gemini-copilot')
  })

  it('Executive context reflects request-time snapshot, not a stale prior state', () => {
    const beforeSnapshot = computeExecutiveAnalyticsSnapshot(
      [optimalAsset].map((asset) => ({
        assetId: asset.assetId,
        status: asset.status,
        statusLabel: asset.statusLabel,
        driverName: asset.driverName,
      })),
      baseDrivers.map((driver) => ({
        fullName: driver.fullName,
        expiryDate: driver.expiryDate,
      })),
    )
    const afterSnapshot = computeExecutiveAnalyticsSnapshot(
      [optimalAsset, criticalAsset].map((asset) => ({
        assetId: asset.assetId,
        status: asset.status,
        statusLabel: asset.statusLabel,
        driverName: asset.driverName,
      })),
      baseDrivers.map((driver) => ({
        fullName: driver.fullName,
        expiryDate: driver.expiryDate,
      })),
    )

    const beforeContext = buildExecutiveCopilotContext(beforeSnapshot)
    const afterContext = buildExecutiveCopilotContext(afterSnapshot)

    expect(beforeContext.fleetHealthSummary).not.toEqual(afterContext.fleetHealthSummary)
    expect(afterContext.fleetHealthSummary?.some((row) => row.includes('critical: 1'))).toBe(true)
  })

  it('Operations loadSummary recomputes snapshot at click time in component source', () => {
    expect(operationsSource).toContain('const requestTimeSnapshot = computeOperationsSnapshot')
    expect(operationsSource).toContain('buildOpsCopilotContextAtRequestTime')
    expect(operationsSource).not.toMatch(/fetchOperationsSummary\(\s*snapshot\s*\)/)
  })

  it('Executive loadSummary recomputes snapshot at click time in component source', () => {
    expect(executiveSource).toContain('const requestTimeSnapshot = computeExecutiveAnalyticsSnapshot')
    expect(executiveSource).not.toMatch(/fetchExecutiveSummary\(\s*snapshot\s*\)/)
  })

  it('does not expose raw Gemini or upstream errors in summary components', () => {
    expect(operationsSource).not.toContain('upstream_gemini')
    expect(executiveSource).not.toContain('upstream_gemini')
    expect(operationsSource).toContain('GeminiCopilotError')
    expect(executiveSource).toContain('GeminiCopilotError')
  })
})

describe('AI summary triggers — deterministic updates unchanged', () => {
  it('Operations still derives Fleet Health and priorities from fleetAssets via useMemo', () => {
    expect(operationsSource).toContain('computeOperationsSnapshot')
    expect(operationsSource).toContain('const { health } = snapshot')
    expect(operationsSource).toContain('snapshot.priorityActions')
    expect(operationsSource).toContain('snapshot.recommendedActions')
  })

  it('Executive still derives KPIs and charts from fleetAssets via useMemo', () => {
    expect(executiveSource).toContain('computeExecutiveAnalyticsSnapshot')
    expect(executiveSource).toContain('const { kpis')
    expect(executiveSource).toContain('fleetHealthChartData')
  })

  it('preserves existing Gemini retry policy wiring', () => {
    expect(edgeHelpersSource).toContain('GEMINI_MAX_ATTEMPTS = 3')
    expect(edgeHelpersSource).toContain('GEMINI_UPSTREAM_TIMEOUT_MS = 40000')
  })
})
