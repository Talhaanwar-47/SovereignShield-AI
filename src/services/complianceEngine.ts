import type { FleetClearanceStatus } from '../types/fleet'
import type {
  ComplianceCriticalItem,
  CompliancePriority,
  ComplianceSnapshot,
  DriverComplianceRow,
  LicenseComplianceStatus,
  VehicleComplianceRow,
} from '../types/compliance'
import {
  isLicenseApproachingExpiry,
  isLicenseExpired,
  LICENSE_APPROACHING_EXPIRY_DAYS,
} from './operationsPriorityEngine'

export type ComplianceDriverRecord = {
  fullName: string
  expiryDate: string
}

export type ComplianceFleetAsset = {
  assetId: string
  driverName: string
  status: FleetClearanceStatus
  statusLabel: string
}

const PRIORITY_RANK: Record<CompliancePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  UNKNOWN: 2,
  NORMAL: 3,
}

/** Estonian DD/MM/YYYY — matches existing project conventions. */
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

export function classifyLicenseStatus(
  expiryDate: string,
  now: Date = new Date(),
): LicenseComplianceStatus {
  const expiry = expiryDate.trim()
  if (!expiry || expiry === '—' || expiry === '-') return 'UNKNOWN'

  if (isLicenseExpired(expiry, now)) return 'EXPIRED'
  if (parseEstonianExpiryUtc(expiry) === null) return 'UNKNOWN'
  if (isLicenseApproachingExpiry(expiry, now, LICENSE_APPROACHING_EXPIRY_DAYS)) {
    return 'EXPIRING_SOON'
  }

  return 'VALID'
}

function licenseStatusToPriority(status: LicenseComplianceStatus): CompliancePriority {
  if (status === 'EXPIRED') return 'CRITICAL'
  if (status === 'EXPIRING_SOON') return 'HIGH'
  if (status === 'UNKNOWN') return 'UNKNOWN'
  return 'NORMAL'
}

function findAssignedVehicle(
  driverName: string,
  assets: ComplianceFleetAsset[],
): string | null {
  const normalized = driverName.trim()
  const match = assets.find((asset) => asset.driverName.trim() === normalized)
  return match?.assetId ?? null
}

function buildDriverAction(status: LicenseComplianceStatus): string {
  switch (status) {
    case 'EXPIRED':
      return 'Resolve license compliance issue'
    case 'EXPIRING_SOON':
      return 'Review license renewal timeline'
    case 'UNKNOWN':
      return 'Review missing or unparseable expiry data'
    default:
      return 'No immediate action'
  }
}

function buildDriverComplianceRows(
  drivers: ComplianceDriverRecord[],
  assets: ComplianceFleetAsset[],
  now: Date,
): DriverComplianceRow[] {
  return drivers
    .map((driver) => {
      const driverName = driver.fullName.trim()
      if (!driverName) return null

      const licenseStatus = classifyLicenseStatus(driver.expiryDate, now)
      const parsed = parseEstonianExpiryUtc(driver.expiryDate)

      return {
        driverName,
        assignedVehicle: findAssignedVehicle(driverName, assets),
        licenseStatus,
        expiryDate:
          licenseStatus === 'UNKNOWN' && parsed === null
            ? null
            : licenseStatus === 'EXPIRED'
              ? null
              : driver.expiryDate.trim() || null,
        compliancePriority: licenseStatusToPriority(licenseStatus),
        recommendedAction: buildDriverAction(licenseStatus),
      }
    })
    .filter((row): row is DriverComplianceRow => row !== null)
    .sort((a, b) => a.driverName.localeCompare(b.driverName))
}

function buildVehicleComplianceRows(assets: ComplianceFleetAsset[]): VehicleComplianceRow[] {
  return assets
    .map((asset) => {
      const assetId = asset.assetId.trim()
      if (!assetId) return null

      let recommendedAction: string
      if (asset.status === 'critical') {
        recommendedAction = 'Review simulated vehicle status — not a real maintenance record'
      } else if (asset.status === 'docking') {
        recommendedAction = 'Review simulated charging/docking status'
      } else {
        recommendedAction = 'No immediate action'
      }

      return {
        assetId,
        assignedDriver: asset.driverName.trim() || 'Unassigned',
        statusLabel: asset.statusLabel.trim() || 'Unknown',
        simulated: true as const,
        source: 'simulated-telemetry' as const,
        recommendedAction,
      }
    })
    .filter((row): row is VehicleComplianceRow => row !== null)
    .sort((a, b) => a.assetId.localeCompare(b.assetId))
}

function buildCriticalItems(
  drivers: DriverComplianceRow[],
  vehicles: VehicleComplianceRow[],
): ComplianceCriticalItem[] {
  const items: ComplianceCriticalItem[] = []

  for (const driver of drivers) {
    if (driver.compliancePriority === 'NORMAL') continue

    const title =
      driver.licenseStatus === 'EXPIRED'
        ? 'Expired License'
        : driver.licenseStatus === 'EXPIRING_SOON'
          ? 'License Expiring Soon'
          : 'Expiry Data Requires Review'

    items.push({
      priority: driver.compliancePriority,
      category: 'driver',
      subject: driver.driverName,
      title,
      description:
        driver.licenseStatus === 'UNKNOWN'
          ? 'Missing or unparseable license expiry date'
          : driver.licenseStatus === 'EXPIRED'
            ? 'License compliance status: EXPIRED'
            : `License expires ${driver.expiryDate ?? 'soon'}`,
      recommendedAction: driver.recommendedAction,
    })
  }

  for (const vehicle of vehicles) {
    if (vehicle.statusLabel.toUpperCase().includes('CRITICAL')) {
      items.push({
        priority: 'CRITICAL',
        category: 'vehicle',
        subject: vehicle.assetId,
        title: 'Simulated Critical Warning',
        description: `${vehicle.statusLabel} — simulated demo telemetry only`,
        recommendedAction: vehicle.recommendedAction,
        simulated: true,
      })
    } else if (
      vehicle.statusLabel.toUpperCase().includes('CHARGE') ||
      vehicle.statusLabel.toUpperCase().includes('DOCK')
    ) {
      items.push({
        priority: 'HIGH',
        category: 'vehicle',
        subject: vehicle.assetId,
        title: vehicle.statusLabel,
        description: 'Simulated charging/docking telemetry — not live GPS',
        recommendedAction: vehicle.recommendedAction,
        simulated: true,
      })
    }
  }

  return items.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (rankDiff !== 0) return rankDiff
    return a.subject.localeCompare(b.subject)
  })
}

function computeCompliancePercentage(
  expiredCount: number,
  expiringSoonCount: number,
  validCount: number,
): { compliancePercentage: number | null; compliancePercentageLabel: string } {
  const knownCount = expiredCount + expiringSoonCount + validCount
  if (knownCount === 0) {
    return {
      compliancePercentage: null,
      compliancePercentageLabel: 'Unavailable — no parseable expiry data',
    }
  }

  const percentage = Math.round((validCount / knownCount) * 100)
  return {
    compliancePercentage: percentage,
    compliancePercentageLabel: `${percentage}%`,
  }
}

/**
 * Deterministic compliance snapshot from RLS-scoped drivers and fleet assets.
 * Does not calculate risk scores or invent compliance data.
 */
export function computeComplianceSnapshot(
  drivers: ComplianceDriverRecord[],
  assets: ComplianceFleetAsset[],
  now: Date = new Date(),
): ComplianceSnapshot {
  const driverCompliance = buildDriverComplianceRows(drivers, assets, now)
  const vehicleCompliance = buildVehicleComplianceRows(assets)

  const expiredCount = driverCompliance.filter((d) => d.licenseStatus === 'EXPIRED').length
  const expiringSoonCount = driverCompliance.filter(
    (d) => d.licenseStatus === 'EXPIRING_SOON',
  ).length
  const validCount = driverCompliance.filter((d) => d.licenseStatus === 'VALID').length
  const unknownCount = driverCompliance.filter((d) => d.licenseStatus === 'UNKNOWN').length

  const { compliancePercentage, compliancePercentageLabel } = computeCompliancePercentage(
    expiredCount,
    expiringSoonCount,
    validCount,
  )

  return {
    totalDrivers: driverCompliance.length,
    expiredCount,
    expiringSoonCount,
    validCount,
    unknownCount,
    compliancePercentage,
    compliancePercentageLabel,
    criticalItems: buildCriticalItems(driverCompliance, vehicleCompliance),
    driverCompliance,
    vehicleCompliance,
  }
}

/** Explicit statement — no driver risk model exists in this demo. */
export const DRIVER_RISK_UNAVAILABLE_MESSAGE =
  'Driver risk scores are not available in the current demo.'

export const COMPLIANCE_NOT_RISK_MESSAGE =
  'Compliance indicators are available, but they are not equivalent to a driver risk score.'
