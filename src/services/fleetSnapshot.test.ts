import { describe, expect, it, beforeEach } from 'vitest'
import type { DriverData } from '../types/driver'
import type { FleetAsset } from '../types/fleet'
import {
  captureRequestTimeCopilotContext,
  createFleetSnapshot,
  resetFleetSnapshotVersionCounter,
} from './fleetSnapshot'
import { simulateFleetTelemetry, withSimulatedClearance } from './fleetTelemetry'
import { buildSystemInstruction } from './geminiCopilotHelpers'

const baseDrivers: DriverData[] = [
  {
    fullName: 'Jürgen Tamm',
    expiryDate: '12 / 11 / 2026',
    personalCode: '39001010006',
    licenseNumber: 'EE-B0984122',
    documentType: 'Driving License',
    status: 'REGISTRY RECORD',
  },
  {
    fullName: 'Mari Ots',
    expiryDate: '01/01/2020',
    personalCode: '49001010007',
    licenseNumber: 'EE-B0000001',
    documentType: 'Driving License',
    status: 'REGISTRY RECORD',
  },
]

const baseAssets: FleetAsset[] = [
  {
    assetId: 'EE-FLEET-991',
    driverName: 'Jürgen Tamm',
    speed: '45 km/h',
    energy: '72% Electric EV',
    batteryPercent: 72,
    status: 'optimal',
    statusLabel: 'OPTIMAL CLEARANCE',
  },
  {
    assetId: 'EE-FLEET-118',
    driverName: 'Unassigned',
    speed: '118 km/h (High)',
    energy: '18% Electric EV',
    batteryPercent: 18,
    status: 'critical',
    statusLabel: 'CRITICAL WARNING',
  },
]

describe('fleetTelemetry', () => {
  it('can change simulated clearance between telemetry ticks', () => {
    const random = {
      delta: () => 70,
      departure: () => 0,
      departureSpeed: () => 0,
    }
    const next = simulateFleetTelemetry(baseAssets, 1, random)
    const before = baseAssets.find((a) => a.assetId === 'EE-FLEET-991')?.statusLabel
    const after = next.find((a) => a.assetId === 'EE-FLEET-991')?.statusLabel
    expect(before).toBe('OPTIMAL CLEARANCE')
    expect(after).toBe('CRITICAL WARNING')
  })

  it('preserves stable assignments while telemetry changes', () => {
    const random = { delta: () => 5, departure: () => 0, departureSpeed: () => 10 }
    const next = simulateFleetTelemetry(baseAssets, 2, random)
    expect(next.map((a) => a.driverName)).toEqual(['Jürgen Tamm', 'Unassigned'])
    expect(next.map((a) => a.assetId)).toEqual(['EE-FLEET-991', 'EE-FLEET-118'])
  })
})

describe('createFleetSnapshot', () => {
  beforeEach(() => {
    resetFleetSnapshotVersionCounter()
  })

  it('generates monotonic snapshotVersion and ISO snapshotCapturedAt', () => {
    const capturedAt = new Date('2026-08-14T08:00:00.000Z')
    const first = createFleetSnapshot(baseAssets, baseDrivers, capturedAt)
    const second = createFleetSnapshot(baseAssets, baseDrivers, capturedAt)

    expect(first.snapshotVersion).toBe(1)
    expect(second.snapshotVersion).toBe(2)
    expect(first.snapshotCapturedAt).toBe('2026-08-14T08:00:00.000Z')
    expect(first.context.snapshotVersion).toBe(1)
    expect(first.context.snapshotCapturedAt).toBe('2026-08-14T08:00:00.000Z')
    expect(first.context.telemetryMode).toBe('simulated')
  })

  it('captures current simulated clearance at request time', () => {
    const critical118 = withSimulatedClearance(
      baseAssets,
      'EE-FLEET-118',
      'critical',
      'CRITICAL WARNING',
    )

    const snapshotA = createFleetSnapshot(critical118, baseDrivers)
    expect(snapshotA.context.simulatedClearance).toContain('EE-FLEET-118 -> CRITICAL WARNING')

    const shifted = withSimulatedClearance(
      withSimulatedClearance(baseAssets, 'EE-FLEET-118', 'optimal', 'OPTIMAL CLEARANCE'),
      'EE-FLEET-991',
      'critical',
      'CRITICAL WARNING',
    )
    const snapshotB = createFleetSnapshot(shifted, baseDrivers)
    expect(snapshotB.context.simulatedClearance).toContain('EE-FLEET-991 -> CRITICAL WARNING')
    expect(snapshotB.context.simulatedClearance).not.toContain('EE-FLEET-118 -> CRITICAL WARNING')
  })

  it('excludes PII from Copilot context', () => {
    const snapshot = createFleetSnapshot(baseAssets, baseDrivers)
    const serialized = JSON.stringify(snapshot.context)
    expect(serialized).not.toContain('39001010006')
    expect(serialized).not.toContain('EE-B0984122')
    expect(serialized).not.toContain('49001010007')
    expect(serialized).not.toContain('EE-B0000001')
    expect(snapshot.context.licenseExpiry).toEqual([
      'Jürgen Tamm -> 12 / 11 / 2026',
      'Mari Ots -> expired',
    ])
  })

  it('keeps assignments stable across snapshot captures', () => {
    const snapshot = createFleetSnapshot(baseAssets, baseDrivers)
    expect(snapshot.context.assignments).toEqual([
      'EE-FLEET-991 -> Jürgen Tamm',
      'EE-FLEET-118 -> Unassigned',
    ])
  })

  it('includes snapshot metadata in Gemini system instruction', () => {
    const context = captureRequestTimeCopilotContext(baseAssets, baseDrivers)
    const instruction = buildSystemInstruction(context)
    expect(instruction).toContain('snapshotVersion=1')
    expect(instruction).toContain('snapshotCapturedAt=')
    expect(instruction).toContain('EE-FLEET-118 -> CRITICAL WARNING')
    expect(instruction).toContain('authoritative')
  })

  it('does not reuse an old snapshot when fleet state changes before next capture', () => {
    const first = captureRequestTimeCopilotContext(baseAssets, baseDrivers)
    const updatedAssets = withSimulatedClearance(
      withSimulatedClearance(baseAssets, 'EE-FLEET-118', 'optimal', 'OPTIMAL CLEARANCE'),
      'EE-FLEET-991',
      'critical',
      'CRITICAL WARNING',
    )
    const second = captureRequestTimeCopilotContext(updatedAssets, baseDrivers)

    expect(first.snapshotVersion).toBe(1)
    expect(second.snapshotVersion).toBe(2)
    expect(first.simulatedClearance).toContain('EE-FLEET-118 -> CRITICAL WARNING')
    expect(second.simulatedClearance).toContain('EE-FLEET-991 -> CRITICAL WARNING')
  })
})
