import type { MembershipRole } from './authProfile'
import type {
  AuditCategory,
  AuditCategoryFilter,
  AuditEvent,
  AuditResult,
  AuditResultFilter,
  AuditSecuritySummary,
  AuditSeverity,
  AuditSeverityFilter,
} from '../types/audit'

export type RecordAuditEventInput = {
  category: AuditCategory
  action: string
  actorDisplayName: string
  actorUserId?: string
  roleLabel?: string
  resourceType?: string
  resourceDisplayId?: string
  severity: AuditSeverity
  result: AuditResult
  source: string
  /** Override only when an authoritative timestamp is supplied externally. */
  timestamp?: string
}

type AuditListener = () => void

let sessionEvents: AuditEvent[] = []
let eventCounter = 0
const listeners = new Set<AuditListener>()

/** Tracks which summary metrics have an active session data source. */
const metricSourcesActive = {
  authentication: false,
  authorization: false,
  security: false,
  aiCopilot: false,
}

export const HISTORICAL_AUDIT_UNAVAILABLE_MESSAGE =
  'No historical audit data is available.'

export const SESSION_AUDIT_SCOPE_MESSAGE =
  'Events below are recorded in the current browser session only. They are not persisted and will not survive refresh or logout.'

function notifyListeners(): void {
  for (const listener of listeners) {
    listener()
  }
}

function markMetricSource(category: AuditCategory): void {
  if (category === 'Authentication') metricSourcesActive.authentication = true
  if (category === 'Authorization') metricSourcesActive.authorization = true
  if (category === 'Security') metricSourcesActive.security = true
  if (category === 'AI Copilot') metricSourcesActive.aiCopilot = true
}

/**
 * Records a session-scoped audit event with a timestamp captured at write time.
 * Does not persist to database or expose sensitive fields.
 */
export function recordAuditEvent(input: RecordAuditEventInput): AuditEvent {
  eventCounter += 1
  markMetricSource(input.category)

  const event: AuditEvent = {
    id: `session-${eventCounter}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    category: input.category,
    action: input.action,
    actorDisplayName: input.actorDisplayName.trim() || 'Unknown actor',
    actorUserId: input.actorUserId,
    roleLabel: input.roleLabel,
    resourceType: input.resourceType,
    resourceDisplayId: input.resourceDisplayId,
    severity: input.severity,
    result: input.result,
    source: input.source,
  }

  sessionEvents = [event, ...sessionEvents]
  notifyListeners()
  return event
}

export function getSessionAuditEvents(): readonly AuditEvent[] {
  return sessionEvents
}

export function subscribeAuditEvents(listener: AuditListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only reset — not used in production UI. */
export function resetSessionAuditEventsForTests(): void {
  sessionEvents = []
  eventCounter = 0
  metricSourcesActive.authentication = false
  metricSourcesActive.authorization = false
  metricSourcesActive.security = false
  metricSourcesActive.aiCopilot = false
  notifyListeners()
}

export function filterAuditEventsForViewer(
  events: readonly AuditEvent[],
  viewer: { membershipRole: MembershipRole | null; userId: string },
): AuditEvent[] {
  if (viewer.membershipRole === 'driver') {
    return events.filter((event) => !event.actorUserId || event.actorUserId === viewer.userId)
  }
  return [...events]
}

export function filterAuditEvents(
  events: readonly AuditEvent[],
  filters: {
    category: AuditCategoryFilter
    severity: AuditSeverityFilter
    result: AuditResultFilter
  },
): AuditEvent[] {
  return events.filter((event) => {
    if (filters.category !== 'All' && event.category !== filters.category) return false
    if (filters.severity !== 'All' && event.severity !== filters.severity) return false
    if (filters.result !== 'All' && event.result !== filters.result) return false
    return true
  })
}

export function availableCategoryFilters(events: readonly AuditEvent[]): AuditCategoryFilter[] {
  const categories = new Set<AuditCategory>()
  for (const event of events) {
    categories.add(event.category)
  }
  const ordered: AuditCategory[] = [
    'Authentication',
    'Authorization',
    'Fleet',
    'Compliance',
    'AI Copilot',
    'Security',
    'System',
  ]
  const present = ordered.filter((category) => categories.has(category))
  return present.length > 0 ? (['All', ...present] as AuditCategoryFilter[]) : ['All']
}


export function computeAuditSecuritySummary(events: readonly AuditEvent[]): AuditSecuritySummary {
  const authEvents = events.filter((event) => event.category === 'Authentication')
  const authTracked = metricSourcesActive.authentication || authEvents.length > 0

  return {
    successfulAuthentication: authTracked
      ? authEvents.filter((event) => event.result === 'SUCCESS').length
      : 'Unavailable',
    failedAuthentication: authTracked
      ? authEvents.filter((event) => event.result === 'FAILED').length
      : 'Unavailable',
    authorizationDenials:
      metricSourcesActive.authorization || events.some((event) => event.category === 'Authorization')
        ? events.filter(
            (event) =>
              event.category === 'Authorization' &&
              (event.result === 'DENIED' || event.result === 'FAILED'),
          ).length
        : 'Unavailable',
    securityWarnings:
      metricSourcesActive.security ||
      metricSourcesActive.authorization ||
      events.some(
        (event) =>
          event.category === 'Security' ||
          (event.category === 'Authorization' && event.severity === 'WARNING'),
      )
        ? events.filter(
            (event) =>
              event.severity === 'WARNING' &&
              (event.category === 'Security' || event.category === 'Authorization'),
          ).length
        : 'Unavailable',
    aiServiceFailures:
      metricSourcesActive.aiCopilot || events.some((event) => event.category === 'AI Copilot')
        ? events.filter(
            (event) => event.category === 'AI Copilot' && event.result === 'FAILED',
          ).length
        : 'Unavailable',
    historicalAuditAvailable: false,
    sessionEventCount: events.length,
  }
}

export function formatAuditTimestamp(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return 'Unavailable'
  return new Date(parsed).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Safe metadata only — never records prompt text or PII. */
export function recordCopilotAuditEvent(options: {
  actorDisplayName: string
  actorUserId: string
  roleLabel?: string
  success: boolean
  failureKind?: string
}): AuditEvent {
  return recordAuditEvent({
    category: 'AI Copilot',
    action: options.success ? 'Copilot request completed' : 'AI upstream failure',
    actorDisplayName: options.actorDisplayName,
    actorUserId: options.actorUserId,
    roleLabel: options.roleLabel,
    resourceType: 'Copilot',
    resourceDisplayId: 'Fleet Copilot',
    severity: options.success ? 'INFO' : 'WARNING',
    result: options.success ? 'SUCCESS' : 'FAILED',
    source: options.success
      ? 'client-gemini-copilot'
      : `client-gemini-copilot${options.failureKind ? `:${options.failureKind}` : ''}`,
  })
}

export function recordFleetRegistryAuditEvent(options: {
  actorDisplayName: string
  actorUserId: string
  roleLabel?: string
  registry: 'drivers' | 'vehicles'
  source: 'supabase' | 'fallback'
  error?: string
}): AuditEvent {
  const failed = Boolean(options.error) || options.source === 'fallback'
  return recordAuditEvent({
    category: 'Fleet',
    action: failed ? 'Registry load failed' : 'Registry loaded',
    actorDisplayName: options.actorDisplayName,
    actorUserId: options.actorUserId,
    roleLabel: options.roleLabel,
    resourceType: 'Registry',
    resourceDisplayId: options.registry,
    severity: failed ? 'WARNING' : 'INFO',
    result: failed ? 'FAILED' : 'SUCCESS',
    source: 'client-fleet-service',
  })
}

export function recordMembershipAuditEvent(options: {
  actorDisplayName: string
  actorUserId: string
  membershipRole: MembershipRole | null
  roleLabel: string
}): AuditEvent {
  if (options.membershipRole) {
    return recordAuditEvent({
      category: 'Authorization',
      action: 'Organization membership resolved',
      actorDisplayName: options.actorDisplayName,
      actorUserId: options.actorUserId,
      roleLabel: options.roleLabel,
      resourceType: 'Membership',
      resourceDisplayId: options.roleLabel,
      severity: 'INFO',
      result: 'SUCCESS',
      source: 'client-auth-profile',
    })
  }

  return recordAuditEvent({
    category: 'Authorization',
    action: 'Organization membership unresolved',
    actorDisplayName: options.actorDisplayName,
    actorUserId: options.actorUserId,
    roleLabel: options.roleLabel,
    resourceType: 'Membership',
    resourceDisplayId: 'Unresolved',
    severity: 'WARNING',
    result: 'DENIED',
    source: 'client-auth-profile',
  })
}

export function recordVerificationAuditEvent(options: {
  actorDisplayName: string
  actorUserId: string
  roleLabel?: string
  status: string
}): AuditEvent {
  const failed = options.status === 'MISMATCH' || options.status === 'LOW OCR CONFIDENCE'
  return recordAuditEvent({
    category: 'Compliance',
    action: 'Identity verification evaluated',
    actorDisplayName: options.actorDisplayName,
    actorUserId: options.actorUserId,
    roleLabel: options.roleLabel,
    resourceType: 'Verification',
    resourceDisplayId: options.status,
    severity: failed ? 'WARNING' : 'INFO',
    result: failed ? 'FAILED' : 'SUCCESS',
    source: 'client-ocr-pipeline',
  })
}
