import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Filter,
  History,
  Lock,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import type { MembershipRole } from '../services/authProfile'
import {
  availableCategoryFilters,
  computeAuditSecuritySummary,
  filterAuditEvents,
  filterAuditEventsForViewer,
  formatAuditTimestamp,
  getSessionAuditEvents,
  HISTORICAL_AUDIT_UNAVAILABLE_MESSAGE,
  SESSION_AUDIT_SCOPE_MESSAGE,
  subscribeAuditEvents,
} from '../services/auditEventService'
import type {
  AuditCategoryFilter,
  AuditEvent,
  AuditMetricValue,
  AuditResultFilter,
  AuditSeverityFilter,
} from '../types/audit'

type AuditSecurityCenterProps = {
  displayName: string
  roleLabel: string
  membershipRole: MembershipRole | null
  userId: string
}

const severityStyles = {
  INFO: 'border-sky-400/35 bg-sky-500/10 text-sky-300',
  WARNING: 'border-amber-400/35 bg-amber-500/10 text-amber-300',
  CRITICAL: 'border-red-400/35 bg-red-500/10 text-red-300',
} as const

const resultStyles = {
  SUCCESS: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300',
  FAILED: 'border-red-400/35 bg-red-500/10 text-red-300',
  DENIED: 'border-violet-400/35 bg-violet-500/10 text-violet-300',
} as const

const SEVERITY_FILTERS: AuditSeverityFilter[] = ['All', 'INFO', 'WARNING', 'CRITICAL']
const RESULT_FILTERS: AuditResultFilter[] = ['All', 'SUCCESS', 'FAILED', 'DENIED']

function SummaryCard({
  label,
  value,
  tone = 'text-white',
}: {
  label: string
  value: AuditMetricValue
  tone?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/30 p-5 backdrop-blur-md">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${value === 'Unavailable' ? 'text-slate-400' : tone}`}>
        {value}
      </p>
    </div>
  )
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
        active
          ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
          : 'border-white/8 bg-slate-950/40 text-slate-500 hover:border-white/15 hover:text-slate-300'
      }`}
    >
      {label}
    </button>
  )
}

function AuditTimelineRow({ event }: { event: AuditEvent }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/2">
      <td className="px-4 py-4 font-mono text-xs text-slate-400">
        {formatAuditTimestamp(event.timestamp)}
      </td>
      <td className="px-4 py-4 text-xs font-medium text-slate-300">{event.category}</td>
      <td className="px-4 py-4 text-sm text-white">{event.action}</td>
      <td className="px-4 py-4 text-sm text-slate-300">
        <div>{event.actorDisplayName}</div>
        {event.roleLabel ? (
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-600">
            {event.roleLabel}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-4 text-sm text-slate-400">
        {event.resourceType ? (
          <>
            <span className="text-slate-500">{event.resourceType}</span>
            {event.resourceDisplayId ? (
              <span className="mt-0.5 block font-mono text-xs text-blue-300/80">
                {event.resourceDisplayId}
              </span>
            ) : null}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${resultStyles[event.result]}`}
        >
          {event.result}
        </span>
      </td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${severityStyles[event.severity]}`}
        >
          {event.severity}
        </span>
      </td>
    </tr>
  )
}

export function AuditSecurityCenter({
  displayName,
  roleLabel,
  membershipRole,
  userId,
}: AuditSecurityCenterProps) {
  const [eventsVersion, setEventsVersion] = useState(0)
  const [categoryFilter, setCategoryFilter] = useState<AuditCategoryFilter>('All')
  const [severityFilter, setSeverityFilter] = useState<AuditSeverityFilter>('All')
  const [resultFilter, setResultFilter] = useState<AuditResultFilter>('All')

  useEffect(() => subscribeAuditEvents(() => setEventsVersion((v) => v + 1)), [])

  const viewerEvents = useMemo(() => {
    void eventsVersion
    return filterAuditEventsForViewer(getSessionAuditEvents(), {
      membershipRole,
      userId,
    })
  }, [eventsVersion, membershipRole, userId])

  const summary = useMemo(() => computeAuditSecuritySummary(viewerEvents), [viewerEvents])

  const categoryOptions = useMemo(
    () => availableCategoryFilters(viewerEvents),
    [viewerEvents],
  )

  const activeCategoryFilter =
    categoryFilter !== 'All' && !categoryOptions.includes(categoryFilter)
      ? 'All'
      : categoryFilter

  const filteredEvents = useMemo(
    () =>
      filterAuditEvents(viewerEvents, {
        category: activeCategoryFilter,
        severity: severityFilter,
        result: resultFilter,
      }),
    [viewerEvents, activeCategoryFilter, severityFilter, resultFilter],
  )

  return (
    <div className="relative mx-auto max-w-6xl space-y-8">
      <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-amber-950/15 to-slate-950/80 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
              <ShieldAlert className="h-3 w-3" />
              Audit & Security Center
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Security Activity Console
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Session-scoped audit visibility for authorized users. Events are recorded from real
              application activity in this browser session only. No passwords, tokens, API keys,
              license numbers, personal codes, or sensitive payloads are stored or displayed.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-semibold text-slate-300">
              <Shield className="h-3.5 w-3.5 text-amber-400" />
              {displayName}
            </div>
            <p className="mt-1">{roleLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-950/40 p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
            <History className="h-4 w-4" />
            Historical Audit
          </div>
          <p className="text-sm text-slate-400">{HISTORICAL_AUDIT_UNAVAILABLE_MESSAGE}</p>
          <p className="mt-2 text-xs text-slate-600">
            No persisted organization audit log exists in this demo application.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-amber-400/80">
            <Lock className="h-4 w-4" />
            Session Scope
          </div>
          <p className="text-sm text-amber-200/80">{SESSION_AUDIT_SCOPE_MESSAGE}</p>
          <p className="mt-2 text-xs text-amber-300/50">
            Session events recorded: {summary.sessionEventCount}
          </p>
        </div>
      </div>

      <section>
        <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          Authentication & Security Overview
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            label="Successful Auth"
            value={summary.successfulAuthentication}
            tone="text-emerald-300"
          />
          <SummaryCard
            label="Failed Auth"
            value={summary.failedAuthentication}
            tone="text-red-400"
          />
          <SummaryCard
            label="Authorization Denials"
            value={summary.authorizationDenials}
            tone="text-violet-300"
          />
          <SummaryCard
            label="Security Warnings"
            value={summary.securityWarnings}
            tone="text-amber-300"
          />
          <SummaryCard
            label="AI Service Failures"
            value={summary.aiServiceFailures}
            tone="text-orange-300"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-white/8 bg-slate-950/50 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-white/8 bg-white/3 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">Audit Timeline</h3>
              <p className="mt-0.5 text-xs text-slate-500">Current session events only</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-600">
              <Filter className="h-3.5 w-3.5" />
              Client-side filters
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map((option) => (
                <FilterButton
                  key={option}
                  label={option}
                  active={activeCategoryFilter === option}
                  onClick={() => setCategoryFilter(option)}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-wrap gap-2">
                {SEVERITY_FILTERS.map((option) => (
                  <FilterButton
                    key={`severity-${option}`}
                    label={option === 'All' ? 'All Severities' : option}
                    active={severityFilter === option}
                    onClick={() => setSeverityFilter(option)}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {RESULT_FILTERS.map((option) => (
                  <FilterButton
                    key={`result-${option}`}
                    label={option === 'All' ? 'All Results' : option}
                    active={resultFilter === option}
                    onClick={() => setResultFilter(option)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {viewerEvents.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <ShieldCheck className="mb-4 h-10 w-10 text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">{HISTORICAL_AUDIT_UNAVAILABLE_MESSAGE}</p>
            <p className="mt-2 max-w-md text-xs text-slate-500">
              No session audit events have been recorded yet. Events will appear here as
              authentication, registry, Copilot, and security activity occurs in this browser
              session.
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <AlertTriangle className="mb-3 h-8 w-8 text-amber-500/70" />
            <p className="text-sm text-slate-400">No events match the selected filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/8 bg-white/3">
                  {[
                    'Time',
                    'Category',
                    'Action',
                    'Actor',
                    'Resource',
                    'Result',
                    'Severity',
                  ].map((label) => (
                    <th
                      key={label}
                      className="px-4 py-4 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <AuditTimelineRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
