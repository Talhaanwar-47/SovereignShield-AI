import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Eye,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { AlertFilter, AlertState, OperationalAlert } from '../types/alerts'
import type { DriverData } from '../types/driver'
import type { FleetAsset } from '../types/fleet'
import {
  alertsFromOperationsSnapshot,
  computeAlertSummary,
  filterAlerts,
  isValidAlertTransition,
  nextAlertState,
} from '../services/alertIncidentService'
import { computeOperationsSnapshot } from '../services/operationsPriorityEngine'
import { EMPTY_STATES, LOADING_LABELS } from '../data/demoExperience'
import { fetchAlertExplanation } from '../services/alertCopilotHelpers'
import { GeminiCopilotError } from '../services/geminiCopilot'

type AlertIncidentCenterProps = {
  fleetAssets: FleetAsset[]
  driverRecords: DriverData[]
  vehiclesLoading: boolean
  driversLoading: boolean
}

const severityStyles = {
  critical: {
    badge: 'border-red-400/45 bg-red-500/10 text-red-300',
    dot: 'bg-red-400',
  },
  high: {
    badge: 'border-amber-400/45 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  normal: {
    badge: 'border-emerald-400/45 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
} as const

const stateStyles: Record<AlertState, string> = {
  open: 'border-sky-400/35 bg-sky-500/10 text-sky-300',
  acknowledged: 'border-violet-400/35 bg-violet-500/10 text-violet-300',
  resolved: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300',
}

const FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'open', label: 'Open' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'resolved', label: 'Resolved' },
]

function AlertRow({
  alert,
  onLifecycle,
  onExplain,
  explaining,
  explanation,
  explainError,
}: {
  alert: OperationalAlert
  onLifecycle: (id: string, action: 'acknowledge' | 'resolve' | 'reopen') => void
  onExplain: (alert: OperationalAlert) => void
  explaining: boolean
  explanation: string | null
  explainError: string | null
}) {
  const style = severityStyles[alert.severity]

  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/60 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${style.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              {alert.severity}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${stateStyles[alert.state]}`}
            >
              {alert.state}
            </span>
            {alert.simulated ? (
              <span className="rounded-full border border-slate-600/50 bg-slate-800/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Simulated
              </span>
            ) : (
              <span className="rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                Compliance
              </span>
            )}
          </div>

          <p className="font-mono text-sm font-semibold text-blue-300">{alert.subjectName}</p>
          <p className="mt-1 text-base font-medium text-white">{alert.title}</p>
          <p className="mt-1 text-sm text-slate-400">{alert.description}</p>
          <p className="mt-3 text-xs text-slate-300">
            <span className="font-semibold text-slate-200">Action:</span>{' '}
            {alert.recommendedAction}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
            Source: {alert.source}
          </p>

          {explanation ? (
            <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                AI Explanation
              </p>
              <p className="text-sm leading-relaxed text-slate-200">{explanation}</p>
            </div>
          ) : null}
          {explainError ? (
            <p className="mt-2 text-xs text-red-300">{explainError}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {isValidAlertTransition(alert.state, 'acknowledge') ? (
            <button
              type="button"
              onClick={() => onLifecycle(alert.id, 'acknowledge')}
              className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/15"
            >
              Acknowledge
            </button>
          ) : null}
          {isValidAlertTransition(alert.state, 'resolve') ? (
            <button
              type="button"
              onClick={() => onLifecycle(alert.id, 'resolve')}
              className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/15"
            >
              Resolve
            </button>
          ) : null}
          {isValidAlertTransition(alert.state, 'reopen') ? (
            <button
              type="button"
              onClick={() => onLifecycle(alert.id, 'reopen')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/15"
            >
              <RotateCcw className="h-3 w-3" />
              Reopen
            </button>
          ) : null}
          <button
            type="button"
            disabled={explaining}
            onClick={() => onExplain(alert)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-60"
          >
            {explaining ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Explain
          </button>
        </div>
      </div>
    </div>
  )
}

export function AlertIncidentCenter({
  fleetAssets,
  driverRecords,
  vehiclesLoading,
  driversLoading,
}: AlertIncidentCenterProps) {
  const [activeFilter, setActiveFilter] = useState<AlertFilter>('all')
  const [lifecycleState, setLifecycleState] = useState<Record<string, AlertState>>({})
  const [explainingId, setExplainingId] = useState<string | null>(null)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [explainErrors, setExplainErrors] = useState<Record<string, string>>({})

  const snapshot = useMemo(
    () =>
      computeOperationsSnapshot(
        fleetAssets.map((asset) => ({
          assetId: asset.assetId,
          status: asset.status,
          statusLabel: asset.statusLabel,
          driverName: asset.driverName,
        })),
        driverRecords.map((driver) => ({
          fullName: driver.fullName,
          expiryDate: driver.expiryDate,
        })),
      ),
    [fleetAssets, driverRecords],
  )

  const alerts = useMemo(
    () => alertsFromOperationsSnapshot(snapshot, lifecycleState),
    [snapshot, lifecycleState],
  )

  const summary = useMemo(() => computeAlertSummary(alerts), [alerts])
  const filteredAlerts = useMemo(
    () => filterAlerts(alerts, activeFilter),
    [alerts, activeFilter],
  )

  const handleLifecycle = useCallback(
    (id: string, action: 'acknowledge' | 'resolve' | 'reopen') => {
      setLifecycleState((prev) => {
        const current = alerts.find((a) => a.id === id)?.state ?? 'open'
        if (!isValidAlertTransition(current, action)) return prev
        return { ...prev, [id]: nextAlertState(action) }
      })
    },
    [alerts],
  )

  const handleExplain = useCallback(async (alert: OperationalAlert) => {
    setExplainingId(alert.id)
    setExplainErrors((prev) => {
      const next = { ...prev }
      delete next[alert.id]
      return next
    })
    try {
      const text = await fetchAlertExplanation(alert)
      setExplanations((prev) => ({ ...prev, [alert.id]: text }))
    } catch (err) {
      const message =
        err instanceof GeminiCopilotError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to explain alert.'
      setExplainErrors((prev) => ({ ...prev, [alert.id]: message }))
    } finally {
      setExplainingId(null)
    }
  }, [])

  const loading = vehiclesLoading || driversLoading

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-white/8 bg-slate-950/50 px-8 py-16 backdrop-blur-xl">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-indigo-400" />
        <p className="text-sm font-semibold text-white">{LOADING_LABELS.alerts}</p>
        <p className="mt-1 text-xs text-slate-500">Syncing with operations priority engine…</p>
      </div>
    )
  }

  return (
    <div className="relative mx-auto max-w-6xl space-y-8">
      <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-red-950/10 to-slate-950/80 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-red-300">
              <Bell className="h-3 w-3" />
              Alert &amp; Incident Center
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Operational Alert Management
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Alerts are derived from the same deterministic operations snapshot as the Command
              Center. Vehicle telemetry alerts are simulated demo data. Lifecycle changes are
              session-local demo UI state — not persisted to a backend.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-amber-300/90">
            <Eye className="h-3.5 w-3.5" />
            Demo session state
          </div>
        </div>
      </div>

      <section>
        <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          Summary
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: 'Total Alerts', value: summary.total, tone: 'text-white' },
            { label: 'Critical', value: summary.critical, tone: 'text-red-400' },
            { label: 'High', value: summary.high, tone: 'text-amber-400' },
            { label: 'Open', value: summary.open, tone: 'text-sky-300' },
            { label: 'Acknowledged', value: summary.acknowledged, tone: 'text-violet-300' },
            { label: 'Resolved', value: summary.resolved, tone: 'text-emerald-400' },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-slate-900 bg-slate-900/30 p-4 backdrop-blur-md"
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</p>
              <p className={`mt-2 text-2xl font-bold ${metric.tone}`}>{metric.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              Alert List
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
                className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
                  activeFilter === filter.id
                    ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300'
                    : 'border-white/8 bg-slate-950/40 text-slate-500 hover:text-slate-300'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {filteredAlerts.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-300">
                  {alerts.length === 0
                    ? EMPTY_STATES.noAlerts
                    : 'No alerts match the selected filter'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {alerts.length === 0
                    ? 'Fleet and compliance indicators are within normal demo thresholds (NORMAL).'
                    : 'Try a different filter to view other session alerts.'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onLifecycle={handleLifecycle}
                onExplain={handleExplain}
                explaining={explainingId === alert.id}
                explanation={explanations[alert.id] ?? null}
                explainError={explainErrors[alert.id] ?? null}
              />
            ))}
          </div>
        )}
      </section>

      <div className="rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-600" />
          <span>
            RLS-scoped snapshot · Same source as Operations Command Center · No fake incidents
          </span>
        </div>
      </div>
    </div>
  )
}
