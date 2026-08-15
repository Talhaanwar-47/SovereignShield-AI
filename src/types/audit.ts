export type AuditCategory =
  | 'Authentication'
  | 'Authorization'
  | 'Fleet'
  | 'Compliance'
  | 'AI Copilot'
  | 'Security'
  | 'System'

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED'

export type AuditEvent = {
  /** Stable session-scoped identifier — not a persisted DB id. */
  id: string
  /** ISO timestamp recorded at event creation time. */
  timestamp: string
  category: AuditCategory
  action: string
  actorDisplayName: string
  /** Verified Supabase user id when available — used for driver-scoped views. */
  actorUserId?: string
  /** Display-only membership label when authorized/available. */
  roleLabel?: string
  resourceType?: string
  resourceDisplayId?: string
  severity: AuditSeverity
  result: AuditResult
  source: string
}

export type AuditCategoryFilter = AuditCategory | 'All'

export type AuditSeverityFilter = AuditSeverity | 'All'

export type AuditResultFilter = AuditResult | 'All'

export type AuditMetricValue = number | 'Unavailable'

export type AuditSecuritySummary = {
  successfulAuthentication: AuditMetricValue
  failedAuthentication: AuditMetricValue
  authorizationDenials: AuditMetricValue
  securityWarnings: AuditMetricValue
  aiServiceFailures: AuditMetricValue
  /** No persisted organization audit log exists in this demo. */
  historicalAuditAvailable: false
  sessionEventCount: number
}
