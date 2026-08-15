import { describe, expect, it, beforeEach } from 'vitest'
import {
  availableCategoryFilters,
  computeAuditSecuritySummary,
  filterAuditEvents,
  filterAuditEventsForViewer,
  formatAuditTimestamp,
  recordAuditEvent,
  recordCopilotAuditEvent,
  recordFleetRegistryAuditEvent,
  recordMembershipAuditEvent,
  resetSessionAuditEventsForTests,
  getSessionAuditEvents,
  HISTORICAL_AUDIT_UNAVAILABLE_MESSAGE,
} from './auditEventService'

describe('auditEventService', () => {
  beforeEach(() => {
    resetSessionAuditEventsForTests()
  })

  it('records session events with authoritative timestamps and safe fields only', () => {
    const event = recordAuditEvent({
      category: 'Authentication',
      action: 'User signed in',
      actorDisplayName: 'Test User',
      actorUserId: 'user-1',
      roleLabel: 'Admin',
      severity: 'INFO',
      result: 'SUCCESS',
      source: 'client-auth-session',
    })

    expect(event.id).toMatch(/^session-\d+$/)
    expect(Date.parse(event.timestamp)).not.toBeNaN()
    expect(event.category).toBe('Authentication')
    expect(getSessionAuditEvents()).toHaveLength(1)
  })

  it('never stores sensitive payload fields on audit events', () => {
    recordCopilotAuditEvent({
      actorDisplayName: 'Test User',
      actorUserId: 'user-1',
      success: false,
      failureKind: 'upstream_timeout',
    })

    const serialized = JSON.stringify(getSessionAuditEvents()[0])
    expect(serialized).not.toMatch(/personalCode|licenseNumber|password|token|apiKey|prompt/i)
    expect(getSessionAuditEvents()[0]?.action).toBe('AI upstream failure')
    expect(getSessionAuditEvents()[0]?.source).toContain('upstream_timeout')
  })

  it('labels AI upstream failures accurately without breach terminology', () => {
    recordCopilotAuditEvent({
      actorDisplayName: 'Test User',
      actorUserId: 'user-1',
      success: false,
      failureKind: 'upstream_gemini',
    })

    const event = getSessionAuditEvents()[0]
    expect(event?.action).toBe('AI upstream failure')
    expect(event?.action.toLowerCase()).not.toContain('breach')
    expect(event?.severity).toBe('WARNING')
  })

  it('computes authentication and authorization summary counts from session events', () => {
    recordAuditEvent({
      category: 'Authentication',
      action: 'User signed in',
      actorDisplayName: 'Admin User',
      actorUserId: 'admin-1',
      severity: 'INFO',
      result: 'SUCCESS',
      source: 'test',
    })
    recordAuditEvent({
      category: 'Authentication',
      action: 'Google sign-in failed',
      actorDisplayName: 'Anonymous',
      severity: 'WARNING',
      result: 'FAILED',
      source: 'test',
    })
    recordMembershipAuditEvent({
      actorDisplayName: 'Admin User',
      actorUserId: 'admin-1',
      membershipRole: null,
      roleLabel: 'Authenticated',
    })

    const summary = computeAuditSecuritySummary(getSessionAuditEvents())
    expect(summary.successfulAuthentication).toBe(1)
    expect(summary.failedAuthentication).toBe(1)
    expect(summary.authorizationDenials).toBe(1)
    expect(summary.historicalAuditAvailable).toBe(false)
  })

  it('shows unavailable summary metrics before any tracked session activity', () => {
    const summary = computeAuditSecuritySummary([])
    expect(summary.successfulAuthentication).toBe('Unavailable')
    expect(summary.aiServiceFailures).toBe('Unavailable')
  })

  it('filters events for driver viewers to own actor scope', () => {
    recordAuditEvent({
      category: 'Fleet',
      action: 'Registry loaded',
      actorDisplayName: 'Other Driver',
      actorUserId: 'other-driver',
      severity: 'INFO',
      result: 'SUCCESS',
      source: 'test',
    })
    recordAuditEvent({
      category: 'Fleet',
      action: 'Registry loaded',
      actorDisplayName: 'Self Driver',
      actorUserId: 'self-driver',
      severity: 'INFO',
      result: 'SUCCESS',
      source: 'test',
    })

    const filtered = filterAuditEventsForViewer(getSessionAuditEvents(), {
      membershipRole: 'driver',
      userId: 'self-driver',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.actorUserId).toBe('self-driver')
  })

  it('allows admin viewers to see all session events', () => {
    recordAuditEvent({
      category: 'System',
      action: 'Token refreshed',
      actorDisplayName: 'Admin',
      actorUserId: 'admin-1',
      severity: 'INFO',
      result: 'SUCCESS',
      source: 'test',
    })

    const filtered = filterAuditEventsForViewer(getSessionAuditEvents(), {
      membershipRole: 'admin',
      userId: 'admin-1',
    })

    expect(filtered).toHaveLength(1)
  })

  it('filters by category, severity, and result client-side', () => {
    recordAuditEvent({
      category: 'AI Copilot',
      action: 'AI upstream failure',
      actorDisplayName: 'User',
      actorUserId: 'user-1',
      severity: 'WARNING',
      result: 'FAILED',
      source: 'test',
    })
    recordAuditEvent({
      category: 'Authentication',
      action: 'User signed in',
      actorDisplayName: 'User',
      actorUserId: 'user-1',
      severity: 'INFO',
      result: 'SUCCESS',
      source: 'test',
    })

    const filtered = filterAuditEvents(getSessionAuditEvents(), {
      category: 'AI Copilot',
      severity: 'WARNING',
      result: 'FAILED',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.category).toBe('AI Copilot')
  })

  it('exposes only categories present in session events for filtering', () => {
    recordFleetRegistryAuditEvent({
      actorDisplayName: 'User',
      actorUserId: 'user-1',
      registry: 'vehicles',
      source: 'supabase',
    })

    expect(availableCategoryFilters(getSessionAuditEvents())).toEqual(['All', 'Fleet'])
  })

  it('records fleet registry failures without exposing raw database errors', () => {
    recordFleetRegistryAuditEvent({
      actorDisplayName: 'User',
      actorUserId: 'user-1',
      registry: 'drivers',
      source: 'fallback',
      error: 'permission denied for table drivers',
    })

    const event = getSessionAuditEvents()[0]
    expect(event?.result).toBe('FAILED')
    expect(event?.action).toBe('Registry load failed')
    expect(JSON.stringify(event)).not.toContain('permission denied')
  })

  it('formats invalid timestamps as unavailable', () => {
    expect(formatAuditTimestamp('not-a-date')).toBe('Unavailable')
  })

  it('uses historical unavailable message constant', () => {
    expect(HISTORICAL_AUDIT_UNAVAILABLE_MESSAGE).toBe('No historical audit data is available.')
  })
})
