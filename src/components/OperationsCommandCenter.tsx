import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { DriverData } from '../types/driver'
import type { FleetAsset } from '../types/fleet'
import type { OperationalPriorityItem } from '../types/operations'
import { GeminiCopilotError } from '../services/geminiCopilot'
import {
  buildOpsCopilotContextAtRequestTime,
  fetchOperationsSummary,
} from '../services/operationsCopilotHelpers'
import { computeOperationsSnapshot } from '../services/operationsPriorityEngine'
import { LOADING_LABELS } from '../data/demoExperience'

type OperationsCommandCenterProps = {
  fleetAssets: FleetAsset[]
  driverRecords: DriverData[]
  vehiclesLoading: boolean
  driversLoading: boolean
  isActive: boolean
}

const priorityStyles = {
  CRITICAL: {
    badge: 'border-red-400/45 bg-red-500/10 text-red-300',
    dot: 'bg-red-400',
    label: 'Critical',
  },
  HIGH: {
    badge: 'border-amber-400/45 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
    label: 'High',
  },
  NORMAL: {
    badge: 'border-emerald-400/45 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
    label: 'Normal',
  },
} as const

function PriorityActionCard({ item }: { item: OperationalPriorityItem }) {
  const style = priorityStyles[item.level]

  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${style.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {item.level}
        </span>
        {item.simulated ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Simulated
          </span>
        ) : null}
      </div>
      <p className="font-mono text-sm font-semibold text-blue-300">{item.subject}</p>
      <p className="mt-1 text-sm font-medium text-white">{item.headline}</p>
      <p className="mt-1 text-xs text-slate-400">{item.detail}</p>
      <p className="mt-3 text-xs text-slate-300">
        <span className="font-semibold text-slate-200">Action:</span> {item.action}
      </p>
    </div>
  )
}

export function OperationsCommandCenter({
  fleetAssets,
  driverRecords,
  vehiclesLoading,
  driversLoading,
}: OperationsCommandCenterProps) {
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const snapshot = useMemo(
    () =>
      computeOperationsSnapshot(
        fleetAssets.map((asset) => ({
          assetId: asset.assetId,
          status: asset.status,
          statusLabel: asset.statusLabel,
        })),
        driverRecords.map((driver) => ({
          fullName: driver.fullName,
          expiryDate: driver.expiryDate,
        })),
      ),
    [fleetAssets, driverRecords],
  )

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const requestTimeSnapshot = computeOperationsSnapshot(
        fleetAssets.map((asset) => ({
          assetId: asset.assetId,
          status: asset.status,
          statusLabel: asset.statusLabel,
        })),
        driverRecords.map((driver) => ({
          fullName: driver.fullName,
          expiryDate: driver.expiryDate,
        })),
      )
      const context = buildOpsCopilotContextAtRequestTime(
        fleetAssets,
        driverRecords,
        requestTimeSnapshot,
      )
      const text = await fetchOperationsSummary(context)
      setSummary(text)
    } catch (err) {
      const message =
        err instanceof GeminiCopilotError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to generate operational summary.'
      setSummaryError(message)
    } finally {
      setSummaryLoading(false)
    }
  }, [fleetAssets, driverRecords])

  const loading = vehiclesLoading || driversLoading

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-white/8 bg-slate-950/50 px-8 py-16 backdrop-blur-xl">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-indigo-400" />
        <p className="text-sm font-semibold text-white">{LOADING_LABELS.operations}</p>
        <p className="mt-1 text-xs text-slate-500">Building RLS-scoped priority context…</p>
      </div>
    )
  }

  const { health } = snapshot

  return (
    <div className="relative mx-auto max-w-6xl space-y-8">
      <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-indigo-950/20 to-slate-950/80 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-300">
              <LayoutGrid className="h-3 w-3" />
              AI Operations Command Center
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Operational Priority Layer
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Deterministic demo priorities from your RLS-scoped fleet and compliance data.
              Vehicle clearance is simulated telemetry — not live GPS or real maintenance data.
              Gemini explains the supplied snapshot; it does not calculate underlying scores.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={summaryLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-2.5 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/15 disabled:opacity-60"
          >
            {summaryLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh AI Summary
          </button>
        </div>
      </div>

      <section>
        <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          Fleet Health
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Total Vehicles', value: health.totalVehicles, tone: 'text-white' },
            { label: 'Active / Available', value: health.activeAvailable, tone: 'text-blue-300' },
            { label: 'Optimal', value: health.optimal, tone: 'text-emerald-400' },
            { label: 'Critical', value: health.critical, tone: 'text-red-400' },
            { label: 'Charging / Docking', value: health.chargingDocking, tone: 'text-cyan-300' },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-slate-900 bg-slate-900/30 p-5 backdrop-blur-md"
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</p>
              <p className={`mt-2 text-2xl font-bold ${metric.tone}`}>{metric.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              Priority Actions
            </h3>
          </div>
          {snapshot.priorityActions.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-300">No elevated priorities</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Fleet and compliance indicators are within normal demo thresholds.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {snapshot.priorityActions.map((item) => (
                <PriorityActionCard
                  key={`${item.level}-${item.category}-${item.subject}`}
                  item={item}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-8">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-400" />
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                AI Operational Summary
              </h3>
            </div>
            <div className="rounded-2xl border border-white/8 bg-slate-950/60 p-5">
              {summaryLoading ? (
                <div className="flex items-center gap-3 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                  Generating AI summary…
                </div>
              ) : summaryError ? (
                <div>
                  <p className="text-sm text-red-300">{summaryError}</p>
                  <button
                    type="button"
                    onClick={() => void loadSummary()}
                    className="mt-3 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                  >
                    Retry summary
                  </button>
                </div>
              ) : summary ? (
                <p className="text-sm leading-relaxed text-slate-200">{summary}</p>
              ) : (
                <p className="text-sm text-slate-500">
                  Click Refresh AI Summary to generate an operational summary from the current
                  snapshot.
                </p>
              )}
              <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Simulated vehicle telemetry · RLS-scoped snapshot · Gemini explains only
              </p>
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                Recommended Actions
              </h3>
            </div>
            {snapshot.recommendedActions.length === 0 ? (
              <p className="rounded-2xl border border-white/8 bg-slate-950/40 p-4 text-sm text-slate-400">
                Continue routine monitoring. No corrective actions suggested.
              </p>
            ) : (
              <ul className="space-y-2">
                {snapshot.recommendedActions.map((action) => (
                  <li
                    key={action}
                    className="flex items-start gap-3 rounded-xl border border-white/8 bg-slate-950/40 px-4 py-3 text-sm text-slate-200"
                  >
                    <Zap className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
