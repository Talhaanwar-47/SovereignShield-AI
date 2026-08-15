export type LicenseComplianceStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' | 'UNKNOWN'

export type CompliancePriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'UNKNOWN'

export type DriverComplianceRow = {
  driverName: string
  assignedVehicle: string | null
  licenseStatus: LicenseComplianceStatus
  /** Display expiry only when parseable or explicitly known — never PII. */
  expiryDate: string | null
  compliancePriority: CompliancePriority
  recommendedAction: string
}

export type VehicleComplianceRow = {
  assetId: string
  assignedDriver: string
  statusLabel: string
  simulated: true
  source: 'simulated-telemetry'
  recommendedAction: string
}

export type ComplianceCriticalItem = {
  priority: CompliancePriority
  category: 'driver' | 'vehicle'
  subject: string
  title: string
  description: string
  recommendedAction: string
  simulated?: boolean
}

export type ComplianceSnapshot = {
  totalDrivers: number
  expiredCount: number
  expiringSoonCount: number
  validCount: number
  unknownCount: number
  /** Null when no drivers have parseable expiry — avoids misleading 100%. */
  compliancePercentage: number | null
  compliancePercentageLabel: string
  criticalItems: ComplianceCriticalItem[]
  driverCompliance: DriverComplianceRow[]
  vehicleCompliance: VehicleComplianceRow[]
}
