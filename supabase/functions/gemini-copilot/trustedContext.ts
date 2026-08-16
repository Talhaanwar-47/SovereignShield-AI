import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ClientDemoTelemetry, CopilotContext } from './helpers.ts'

export type MembershipRole = 'admin' | 'fleet-manager' | 'driver'

type DriverRow = {
  id?: string
  name?: string | null
  expiry_date?: string | null
  user_id?: string | null
}

type VehicleRow = {
  id?: string
  asset_id?: string | null
  assigned_driver_id?: string | null
  compliance_tier?: string | null
}

export type AuthorizedFleetRow = {
  assetId: string
  driverName: string
  status: FleetClearanceStatus
  statusLabel: string
}

export type AuthorizedDriverRow = {
  fullName: string
  expiryDate: string
}

export type AuthorizedFleetData = {
  membershipRole: MembershipRole
  assets: AuthorizedFleetRow[]
  drivers: AuthorizedDriverRow[]
}

type FleetClearanceStatus = 'critical' | 'docking' | 'optimal'

type OperationalPriorityLevel = 'CRITICAL' | 'HIGH' | 'NORMAL'

type OperationalPriorityItem = {
  level: OperationalPriorityLevel
  category: 'vehicle' | 'compliance'
  subject: string
  headline: string
  detail: string
  action: string
  simulated: boolean
}

const UNASSIGNED_DRIVER_LABEL = 'Unassigned'
const MAX_CONTEXT_ITEMS = 20
const LICENSE_APPROACHING_EXPIRY_DAYS = 30
const ASSIGNMENT_SEPARATOR = ' -> '

const LEVEL_RANK: Record<OperationalPriorityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
}

const CATEGORY_RANK = {
  vehicle: 0,
  compliance: 1,
} as const

let serverSnapshotVersionCounter = 0

/** Resets monotonic snapshot counter — for tests only. */
export function resetServerSnapshotVersionCounter(): void {
  serverSnapshotVersionCounter = 0
}

export function parseMembershipRole(role: string | null | undefined): MembershipRole | null {
  if (role === 'admin' || role === 'fleet-manager' || role === 'driver') return role
  return null
}

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

function isLicenseExpired(expiryDate: string, now: Date): boolean {
  const parsed = parseEstonianExpiryUtc(expiryDate)
  if (parsed === null) return false
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return parsed < startOfTodayUtc
}

function isLicenseApproachingExpiry(
  expiryDate: string,
  now: Date,
  withinDays: number = LICENSE_APPROACHING_EXPIRY_DAYS,
): boolean {
  const parsed = parseEstonianExpiryUtc(expiryDate)
  if (parsed === null) return false
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (parsed < startOfTodayUtc) return false
  const windowEnd = startOfTodayUtc + withinDays * 24 * 60 * 60 * 1000
  return parsed <= windowEnd
}

function resolveFleetStatusFromLabel(statusLabel: string): FleetClearanceStatus {
  const label = statusLabel.toUpperCase()
  if (label.includes('CRITICAL')) return 'critical'
  if (label.includes('DOCK') || label.includes('CHARGING') || label.includes('CHARGE')) {
    return 'docking'
  }
  return 'optimal'
}

function defaultStatusLabelFromDb(complianceTier: string | null | undefined): string {
  const tier = typeof complianceTier === 'string' ? complianceTier.trim() : ''
  if (!tier) return 'OPTIMAL CLEARANCE'
  if (tier.toLowerCase() === 'critical') return 'CRITICAL WARNING'
  return tier
}

function formatLicenseExpiryRow(fullName: string, expiryDate: string, now: Date): string | null {
  const driverName = fullName.trim()
  const expiry = expiryDate.trim()
  if (!driverName || !expiry || expiry === '—' || expiry === '-') return null
  if (isLicenseExpired(expiry, now)) return `${driverName} -> expired`
  return `${driverName} -> ${expiry}`
}

function parseClearanceRow(row: string): { assetId: string; statusLabel: string } | null {
  const separatorAt = row.indexOf(ASSIGNMENT_SEPARATOR)
  if (separatorAt <= 0) return null
  const assetId = row.slice(0, separatorAt).trim()
  const statusLabel = row.slice(separatorAt + ASSIGNMENT_SEPARATOR.length).trim()
  if (!assetId || !statusLabel) return null
  return { assetId, statusLabel }
}

/**
 * Accepts client-reported demo clearance only for asset IDs the user can already see via RLS.
 * Rejects unknown asset IDs and malformed rows.
 */
export function mergeValidatedClientDemoClearance(
  authorizedAssetIds: ReadonlySet<string>,
  clientRows: string[] | undefined,
): Map<string, string> {
  const merged = new Map<string, string>()
  if (!clientRows) return merged

  for (const row of clientRows) {
    const parsed = parseClearanceRow(row)
    if (!parsed) continue
    if (!authorizedAssetIds.has(parsed.assetId)) continue
    merged.set(parsed.assetId, parsed.statusLabel)
  }

  return merged
}

function vehiclePriorityLevel(status: FleetClearanceStatus): OperationalPriorityLevel {
  if (status === 'critical') return 'CRITICAL'
  if (status === 'docking') return 'HIGH'
  return 'NORMAL'
}

function compliancePriorityLevel(
  driver: AuthorizedDriverRow,
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

function buildVehiclePriorityItems(assets: AuthorizedFleetRow[]): OperationalPriorityItem[] {
  return assets.map((asset) => {
    const level = vehiclePriorityLevel(asset.status)
    const statusLabel = asset.statusLabel.trim() || 'Unknown'

    if (level === 'CRITICAL') {
      return {
        level,
        category: 'vehicle',
        subject: asset.assetId,
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
        subject: asset.assetId,
        headline,
        detail: `${statusLabel} (simulated demo telemetry)`,
        action: 'Review simulated vehicle status',
        simulated: true,
      }
    }

    return {
      level,
      category: 'vehicle',
      subject: asset.assetId,
      headline: 'Optimal Clearance',
      detail: `${statusLabel} (simulated demo telemetry)`,
      action: 'No action required',
      simulated: true,
    }
  })
}

function buildCompliancePriorityItems(
  drivers: AuthorizedDriverRow[],
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

function computeOperationsFields(
  assets: AuthorizedFleetRow[],
  drivers: AuthorizedDriverRow[],
  now: Date,
): Pick<CopilotContext, 'fleetHealthSummary' | 'operationalPriorities' | 'recommendedActions'> {
  const totalVehicles = assets.length
  const optimal = assets.filter((asset) => asset.status === 'optimal').length
  const critical = assets.filter((asset) => asset.status === 'critical').length
  const chargingDocking = assets.filter((asset) => asset.status === 'docking').length
  const activeAvailable = assets.filter((asset) => asset.status !== 'critical').length

  const allItems = sortPriorityItems([
    ...buildVehiclePriorityItems(assets),
    ...buildCompliancePriorityItems(drivers, now),
  ])
  const priorityActions = allItems.filter((item) => item.level !== 'NORMAL')

  return {
    fleetHealthSummary: [
      `totalVehicles: ${totalVehicles}`,
      `activeAvailable: ${activeAvailable}`,
      `optimal: ${optimal}`,
      `critical: ${critical}`,
      `chargingDocking: ${chargingDocking}`,
      'telemetryMode: simulated',
    ],
    operationalPriorities:
      priorityActions.length > 0
        ? priorityActions.map(formatPriorityRow)
        : [
            'NORMAL | Fleet operations | No critical or high-priority items | Action: Continue routine monitoring',
          ],
    recommendedActions: buildRecommendedActions(allItems),
  }
}

export async function resolveMembershipRoleForUser(
  userClient: SupabaseClient,
  userId: string,
): Promise<MembershipRole | null> {
  const { data, error } = await userClient
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .order('organization_id', { ascending: true })

  if (error || !data || data.length === 0) return null

  const roles = new Set(data.map((row) => row.role))
  if (roles.size !== 1) return null

  return parseMembershipRole(data[0]?.role)
}

async function fetchAssignedDriverNames(
  userClient: SupabaseClient,
  driverIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(driverIds.filter((id) => id.trim().length > 0))]
  const names = new Map<string, string>()
  if (uniqueIds.length === 0) return names

  const { data, error } = await userClient
    .from('drivers')
    .select('id,name')
    .in('id', uniqueIds)

  if (error || !data) return names

  for (const row of data as Array<{ id?: string; name?: string | null }>) {
    if (!row.id) continue
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (name) names.set(row.id, name)
  }

  return names
}

/**
 * Loads RLS-scoped fleet rows using the authenticated user's JWT client only.
 * Never selects driver_pii — license context uses name + expiry_date only.
 */
export async function fetchAuthorizedFleetData(
  userClient: SupabaseClient,
  userId: string,
  membershipRole: MembershipRole,
): Promise<AuthorizedFleetData> {
  let driversQuery = userClient.from('drivers').select('id,name,expiry_date,user_id')
  if (membershipRole === 'driver') {
    driversQuery = driversQuery.eq('user_id', userId)
  }

  const [{ data: driverRows, error: driverError }, { data: vehicleRows, error: vehicleError }] =
    await Promise.all([
      driversQuery,
      userClient
        .from('vehicles')
        .select('id,asset_id,assigned_driver_id,compliance_tier'),
    ])

  const drivers: AuthorizedDriverRow[] = !driverError && driverRows
    ? (driverRows as DriverRow[])
        .map((row) => ({
          fullName: typeof row.name === 'string' ? row.name.trim() : '',
          expiryDate: typeof row.expiry_date === 'string' ? row.expiry_date.trim() : '—',
        }))
        .filter((row) => row.fullName.length > 0)
        .slice(0, MAX_CONTEXT_ITEMS)
    : []

  const vehicles = !vehicleError && vehicleRows ? (vehicleRows as VehicleRow[]) : []
  const assignedIds = vehicles
    .map((row) => row.assigned_driver_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const namesById = await fetchAssignedDriverNames(userClient, assignedIds)

  const assets: AuthorizedFleetRow[] = vehicles
    .map((row) => {
      const assetId =
        typeof row.asset_id === 'string' && row.asset_id.trim()
          ? row.asset_id.trim()
          : typeof row.id === 'string'
            ? `EE-FLEET-${row.id}`
            : ''
      if (!assetId) return null

      const assignedId = row.assigned_driver_id
      const driverName =
        assignedId && namesById.has(assignedId)
          ? namesById.get(assignedId)!
          : UNASSIGNED_DRIVER_LABEL
      const statusLabel = defaultStatusLabelFromDb(row.compliance_tier)

      return {
        assetId,
        driverName,
        statusLabel,
        status: resolveFleetStatusFromLabel(statusLabel),
      }
    })
    .filter((row): row is AuthorizedFleetRow => row !== null)
    .slice(0, MAX_CONTEXT_ITEMS)

  return { membershipRole, assets, drivers }
}

/**
 * Builds Gemini context from server-authorized data plus optional client demo telemetry.
 * Database-backed assignments and license expiry are always authoritative.
 */
export function buildTrustedCopilotContext(input: {
  fleetData: AuthorizedFleetData
  clientDemoTelemetry?: ClientDemoTelemetry
  capturedAt?: Date
}): CopilotContext {
  const now = input.capturedAt ?? new Date()
  serverSnapshotVersionCounter += 1

  const authorizedAssetIds = new Set(input.fleetData.assets.map((asset) => asset.assetId))
  const clientClearance = mergeValidatedClientDemoClearance(
    authorizedAssetIds,
    input.clientDemoTelemetry?.simulatedClearance,
  )

  const assetsWithClearance = input.fleetData.assets.map((asset) => {
    const clientLabel = clientClearance.get(asset.assetId)
    if (!clientLabel) return asset
    return {
      ...asset,
      statusLabel: clientLabel,
      status: resolveFleetStatusFromLabel(clientLabel),
    }
  })

  const assignments = assetsWithClearance
    .map((asset) => `${asset.assetId}${ASSIGNMENT_SEPARATOR}${asset.driverName}`)
    .slice(0, MAX_CONTEXT_ITEMS)

  const licenseExpiry = input.fleetData.drivers
    .map((driver) => formatLicenseExpiryRow(driver.fullName, driver.expiryDate, now))
    .filter((row): row is string => row !== null)
    .slice(0, MAX_CONTEXT_ITEMS)

  const simulatedClearance = assetsWithClearance
    .map((asset) => `${asset.assetId}${ASSIGNMENT_SEPARATOR}${asset.statusLabel}`)
    .slice(0, MAX_CONTEXT_ITEMS)

  const opsFields = computeOperationsFields(assetsWithClearance, input.fleetData.drivers, now)

  const clientDemoApplied = clientClearance.size > 0

  return {
    assignments,
    ...(licenseExpiry.length > 0 ? { licenseExpiry } : {}),
    ...(simulatedClearance.length > 0 ? { simulatedClearance } : {}),
    telemetryMode: 'simulated',
    snapshotVersion: serverSnapshotVersionCounter,
    snapshotCapturedAt: now.toISOString(),
    ...opsFields,
    ...(clientDemoApplied ? { clientDemoTelemetryApplied: true } : {}),
    ...(input.clientDemoTelemetry?.snapshotVersion !== undefined
      ? { clientSnapshotVersion: input.clientDemoTelemetry.snapshotVersion }
      : {}),
    ...(input.clientDemoTelemetry?.snapshotCapturedAt
      ? { clientSnapshotCapturedAt: input.clientDemoTelemetry.snapshotCapturedAt }
      : {}),
  }
}

export async function buildTrustedCopilotContextForUser(
  userClient: SupabaseClient,
  userId: string,
  clientDemoTelemetry?: ClientDemoTelemetry,
): Promise<CopilotContext | { error: 'membership_role_unresolved' }> {
  const membershipRole = await resolveMembershipRoleForUser(userClient, userId)
  if (!membershipRole) {
    return { error: 'membership_role_unresolved' }
  }

  const fleetData = await fetchAuthorizedFleetData(userClient, userId, membershipRole)
  return buildTrustedCopilotContext({ fleetData, clientDemoTelemetry })
}
