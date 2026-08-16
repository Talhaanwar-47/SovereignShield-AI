import type { FleetClearanceStatus } from '../types/fleet'
import type {
  FleetHealthSnapshot,
  OperationalPriorityItem,
  OperationalPriorityLevel,
  OperationsSnapshot,
} from '../types/operations'

/** Days before expiry to flag HIGH compliance priority (parseable dates only). */
export const LICENSE_APPROACHING_EXPIRY_DAYS = 30

export type OperationsFleetAsset = {
  assetId: string
  status: FleetClearanceStatus
  statusLabel: string
  /** Resolved assignment label when building Gemini fleet context. */
  driverName?: string
}

export type OperationsDriverRecord = {
  fullName: string
  expiryDate: string
}

const LEVEL_RANK: Record<OperationalPriorityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
}

const CATEGORY_RANK = {
  vehicle: 0,
  compliance: 1,
} as const

function parseEstonianExpiryUtc(expiry: string): number | null {
  const match = expiry.trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const parsed = Date.UTC(year, month - 1, day)
  if (
    new Date(parsed).getUTCFullYear() !== year ||
    new Date(parsed).getUTCMonth() !== month - 1 ||
    new Date(parsed).getUTCDate() !== day
  ) {
    return null
  }

  return parsed
}

export function isLicenseExpired(expiryDate: string, now: Date = new Date()): boolean {
  const parsed = parseEstonianExpiryUtc(expiryDate)
  if (parsed === null) return false

  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return parsed < startOfTodayUtc
}

export function isLicenseApproachingExpiry(
  expiryDate: string,
  now: Date = new Date(),
  withinDays: number = LICENSE_APPROACHING_EXPIRY_DAYS,
): boolean {
  const parsed = parseEstonianExpiryUtc(expiryDate)
  if (parsed === null) return false

  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (parsed < startOfTodayUtc) return false

  const windowEnd = startOfTodayUtc + withinDays * 24 * 60 * 60 * 1000
  return parsed <= windowEnd
}

function vehiclePriorityLevel(
  status: FleetClearanceStatus,
): OperationalPriorityLevel {
  if (status === 'critical') return 'CRITICAL'
  if (status === 'docking') return 'HIGH'
  return 'NORMAL'
}

function compliancePriorityLevel(
  driver: OperationsDriverRecord,
  now: Date,
): OperationalPriorityLevel | null {
  const expiry = driver.expiryDate.trim()
  const name = driver.fullName.trim()
  if (!name || !expiry || expiry === '—' || expiry === '-') return null

  if (isLicenseExpired(expiry, now)) return 'CRITICAL'
  if (isLicenseApproachingExpiry(expiry, now)) return 'HIGH'
  return 'NORMAL'
}

function sortPriorityItems(items: OperationalPriorityItem[]): OperationalPriorityItem[] {
  return [...items].sort((a, b) => {
    const levelDiff = LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
    if (levelDiff !== 0) return levelDiff
    const categoryDiff = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]
    if (categoryDiff !== 0) return categoryDiff
    return a.subject.localeCompare(b.subject)
  })
}

function buildFleetHealth(assets: OperationsFleetAsset[]): FleetHealthSnapshot {
  const totalVehicles = assets.length
  const optimal = assets.filter((a) => a.status === 'optimal').length
  const critical = assets.filter((a) => a.status === 'critical').length
  const chargingDocking = assets.filter((a) => a.status === 'docking').length
  const activeAvailable = assets.filter((a) => a.status !== 'critical').length

  return {
    totalVehicles,
    activeAvailable,
    optimal,
    critical,
    chargingDocking,
  }
}

function buildVehiclePriorityItems(assets: OperationsFleetAsset[]): OperationalPriorityItem[] {
  return assets.map((asset) => {
    const assetId = asset.assetId.trim()
    const statusLabel = asset.statusLabel.trim() || 'Unknown'
    const level = vehiclePriorityLevel(asset.status)

    if (level === 'CRITICAL') {
      return {
        level,
        category: 'vehicle',
        subject: assetId,
        headline: 'Critical Warning',
        detail: `${statusLabel} (simulated demo telemetry)`,
        action: 'Review vehicle condition',
        simulated: true,
      }
    }

    if (level === 'HIGH') {
      const headline =
        statusLabel.includes('CHARGE') || statusLabel.includes('DOCK')
          ? statusLabel
          : 'Simulated Attention Required'
      return {
        level,
        category: 'vehicle',
        subject: assetId,
        headline,
        detail: `${statusLabel} (simulated demo telemetry)`,
        action: 'Review simulated vehicle status',
        simulated: true,
      }
    }

    return {
      level,
      category: 'vehicle',
      subject: assetId,
      headline: 'Optimal Clearance',
      detail: `${statusLabel} (simulated demo telemetry)`,
      action: 'No action required',
      simulated: true,
    }
  })
}

function buildCompliancePriorityItems(
  drivers: OperationsDriverRecord[],
  now: Date,
): OperationalPriorityItem[] {
  const items: OperationalPriorityItem[] = []

  for (const driver of drivers) {
    const level = compliancePriorityLevel(driver, now)
    if (level === null) continue

    const name = driver.fullName.trim()
    const expiry = driver.expiryDate.trim()

    if (level === 'CRITICAL') {
      items.push({
        level,
        category: 'compliance',
        subject: name,
        headline: 'Expired License',
        detail: 'License expired',
        action: 'Resolve compliance issue',
        simulated: false,
      })
      continue
    }

    if (level === 'HIGH') {
      items.push({
        level,
        category: 'compliance',
        subject: name,
        headline: 'License Approaching Expiry',
        detail: `Expires ${expiry}`,
        action: 'Review license renewal timeline',
        simulated: false,
      })
      continue
    }

    items.push({
      level,
      category: 'compliance',
      subject: name,
      headline: 'Valid License',
      detail: `Valid until ${expiry}`,
      action: 'No action required',
      simulated: false,
    })
  }

  return items
}

function formatPriorityRow(item: OperationalPriorityItem): string {
  const sim = item.simulated ? ' (simulated)' : ''
  return `${item.level} | ${item.subject} | ${item.headline}${sim} | Action: ${item.action}`
}

function buildRecommendedActions(priorityActions: OperationalPriorityItem[]): string[] {
  const actions: string[] = []

  for (const item of priorityActions) {
    if (item.level === 'NORMAL') continue
    if (item.category === 'vehicle') {
      actions.push(`Review ${item.subject}`)
    } else if (item.level === 'CRITICAL') {
      actions.push(`Resolve ${item.subject}'s expired license`)
    } else {
      actions.push(`Review ${item.subject}'s license expiry`)
    }
  }

  if (priorityActions.some((item) => item.level !== 'NORMAL')) {
    actions.push('Recheck fleet status after corrective action')
  }

  return [...new Set(actions)]
}

/**
 * Deterministic operational priority engine from RLS-scoped fleet + driver rows.
 * Does not call Gemini and does not invent data beyond supplied fields.
 */
export function computeOperationsSnapshot(
  assets: OperationsFleetAsset[],
  drivers: OperationsDriverRecord[] = [],
  now: Date = new Date(),
): OperationsSnapshot {
  const health = buildFleetHealth(assets)
  const allItems = sortPriorityItems([
    ...buildVehiclePriorityItems(assets),
    ...buildCompliancePriorityItems(drivers, now),
  ])

  const priorityActions = allItems.filter((item) => item.level !== 'NORMAL')
  const recommendedActions = buildRecommendedActions(allItems)

  const fleetHealthSummary = [
    `totalVehicles: ${health.totalVehicles}`,
    `activeAvailable: ${health.activeAvailable}`,
    `optimal: ${health.optimal}`,
    `critical: ${health.critical}`,
    `chargingDocking: ${health.chargingDocking}`,
    'telemetryMode: simulated',
  ]

  const operationalPriorities =
    priorityActions.length > 0
      ? priorityActions.map(formatPriorityRow)
      : ['NORMAL | Fleet operations | No critical or high-priority items | Action: Continue routine monitoring']

  return {
    health,
    priorityActions,
    recommendedActions,
    operationalPriorities,
    fleetHealthSummary,
    telemetryMode: 'simulated',
  }
}
