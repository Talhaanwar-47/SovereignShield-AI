import type { FleetAsset, FleetClearanceStatus } from '../types/fleet'

export const FLEET_TELEMETRY_INTERVAL_MS = 3000
const MAX_FLEET_SPEED_KMH = 129
const FAST_CHARGE_THRESHOLD = 12
const FAST_CHARGE_RESTORE_PERCENT = 94

function parseSpeedKmh(speed: string): number {
  const match = speed.match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

function formatSpeedKmh(kmh: number): string {
  if (kmh <= 0) return '0 km/h (Stationary)'
  if (kmh > 110) return `${kmh} km/h (High)`
  return `${kmh} km/h`
}

function isElectricEv(energy: string): boolean {
  return /electric\s*ev/i.test(energy)
}

function formatEnergyPercent(percent: number, template: string): string {
  if (isElectricEv(template)) return `${percent}% Electric EV`
  if (/diesel/i.test(template)) return `${percent}% Diesel Engine`
  return `${percent}% Electric EV`
}

function deriveLiveFleetStatus(
  speedKmh: number,
  batteryPercent: number,
  isEv: boolean,
  fastChargeReset: boolean,
): Pick<FleetAsset, 'status' | 'statusLabel'> {
  if (fastChargeReset) {
    return { status: 'docking', statusLabel: 'FAST-CHARGE RESET' }
  }
  if (speedKmh > 110 || (isEv && batteryPercent <= 25 && speedKmh > 0)) {
    return { status: 'critical', statusLabel: 'CRITICAL WARNING' }
  }
  if (speedKmh === 0 && isEv && batteryPercent >= 88) {
    return { status: 'docking', statusLabel: 'DOCK CHARGING' }
  }
  return { status: 'optimal', statusLabel: 'OPTIMAL CLEARANCE' }
}

export type FleetTelemetryRandom = {
  delta: () => number
  departure: () => number
  departureSpeed: () => number
}

const defaultRandom: FleetTelemetryRandom = {
  delta: () => Math.floor(Math.random() * 13) - 6,
  departure: () => Math.random(),
  departureSpeed: () => Math.floor(Math.random() * 26) + 4,
}

/**
 * Applies one simulated telemetry tick — speed, battery, and clearance status.
 * Database-backed fields (assetId, driverName) are preserved unchanged.
 */
export function simulateFleetTelemetry(
  assets: FleetAsset[],
  tick: number,
  random: FleetTelemetryRandom = defaultRandom,
): FleetAsset[] {
  return assets.map((asset) => {
    const currentSpeed = parseSpeedKmh(asset.speed)
    const delta = random.delta()
    let nextSpeed = Math.min(MAX_FLEET_SPEED_KMH, Math.max(0, currentSpeed + delta))

    if (currentSpeed === 0 && random.departure() < 0.35) {
      nextSpeed = random.departureSpeed()
    }

    const ev = isElectricEv(asset.energy)
    let batteryPercent = asset.batteryPercent
    let energy = asset.energy
    let fastChargeReset = false

    if (ev && tick % 3 === 0) {
      batteryPercent = Math.max(0, batteryPercent - 1)
      energy = formatEnergyPercent(batteryPercent, asset.energy)
    }

    if (ev && batteryPercent < FAST_CHARGE_THRESHOLD) {
      batteryPercent = FAST_CHARGE_RESTORE_PERCENT
      energy = `${FAST_CHARGE_RESTORE_PERCENT}% Electric EV`
      fastChargeReset = true
      nextSpeed = 0
    }

    const liveStatus = deriveLiveFleetStatus(nextSpeed, batteryPercent, ev, fastChargeReset)

    return {
      ...asset,
      speed: formatSpeedKmh(nextSpeed),
      energy,
      batteryPercent,
      ...liveStatus,
    }
  })
}

/** Test helper — force a specific clearance status without changing assignments. */
export function withSimulatedClearance(
  assets: FleetAsset[],
  assetId: string,
  status: FleetClearanceStatus,
  statusLabel: string,
): FleetAsset[] {
  return assets.map((asset) =>
    asset.assetId === assetId ? { ...asset, status, statusLabel } : asset,
  )
}
