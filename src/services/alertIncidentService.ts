import type {
  AlertFilter,
  AlertSeverity,
  AlertState,
  AlertSummary,
  OperationalAlert,
} from '../types/alerts'
import type { OperationalPriorityItem, OperationsSnapshot } from '../types/operations'

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Stable deterministic alert id — no random values, no invented timestamps. */
export function buildDeterministicAlertId(item: OperationalPriorityItem): string {
  const subjectKey =
    item.category === 'vehicle' ? item.subject.trim() : slugify(item.subject)
  const titleKey = slugify(item.headline)
  return `${item.category}:${subjectKey}:${titleKey}`
}

function mapSeverity(level: OperationalPriorityItem['level']): AlertSeverity {
  if (level === 'CRITICAL') return 'critical'
  if (level === 'HIGH') return 'high'
  return 'normal'
}

function mapSource(item: OperationalPriorityItem): string {
  if (item.simulated) return 'simulated-vehicle-telemetry'
  if (item.headline === 'Expired License') return 'license-expiry-registry'
  if (item.headline === 'License Approaching Expiry') return 'license-expiry-registry'
  return 'compliance-registry'
}

/** Maps one deterministic priority row to an operational alert (default state: open). */
export function priorityItemToAlert(item: OperationalPriorityItem): OperationalAlert {
  const subjectName = item.subject.trim()
  const subjectId = item.category === 'vehicle' ? subjectName : slugify(subjectName)

  return {
    id: buildDeterministicAlertId(item),
    severity: mapSeverity(item.level),
    category: item.category,
    subjectId,
    subjectName,
    title: item.headline,
    description: item.detail,
    source: mapSource(item),
    simulated: item.simulated,
    recommendedAction: item.action,
    state: 'open',
  }
}

/**
 * Builds alerts from the same operations snapshot used by the Command Center.
 * Does not recalculate priorities — consumes priorityActions only.
 */
export function alertsFromOperationsSnapshot(
  snapshot: OperationsSnapshot,
  lifecycleOverrides: Record<string, AlertState> = {},
): OperationalAlert[] {
  return snapshot.priorityActions.map((item) => {
    const alert = priorityItemToAlert(item)
    const override = lifecycleOverrides[alert.id]
    return override ? { ...alert, state: override } : alert
  })
}

export function computeAlertSummary(alerts: OperationalAlert[]): AlertSummary {
  return {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === 'critical').length,
    high: alerts.filter((a) => a.severity === 'high').length,
    open: alerts.filter((a) => a.state === 'open').length,
    acknowledged: alerts.filter((a) => a.state === 'acknowledged').length,
    resolved: alerts.filter((a) => a.state === 'resolved').length,
  }
}

export function filterAlerts(alerts: OperationalAlert[], filter: AlertFilter): OperationalAlert[] {
  switch (filter) {
    case 'all':
      return alerts
    case 'critical':
      return alerts.filter((a) => a.severity === 'critical')
    case 'high':
      return alerts.filter((a) => a.severity === 'high')
    case 'vehicle':
      return alerts.filter((a) => a.category === 'vehicle')
    case 'compliance':
      return alerts.filter((a) => a.category === 'compliance')
    case 'open':
      return alerts.filter((a) => a.state === 'open')
    case 'acknowledged':
      return alerts.filter((a) => a.state === 'acknowledged')
    case 'resolved':
      return alerts.filter((a) => a.state === 'resolved')
  }
}

export function nextAlertState(action: 'acknowledge' | 'resolve' | 'reopen'): AlertState {
  if (action === 'reopen') return 'open'
  if (action === 'acknowledge') return 'acknowledged'
  return 'resolved'
}

export function isValidAlertTransition(
  current: AlertState,
  action: 'acknowledge' | 'resolve' | 'reopen',
): boolean {
  if (action === 'reopen') return current !== 'open'
  if (action === 'acknowledge') return current === 'open'
  if (action === 'resolve') return current === 'open' || current === 'acknowledged'
  return false
}
