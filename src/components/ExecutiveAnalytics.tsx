import { useCallback, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  Sparkles,
  Truck,
  UserCheck,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DriverData } from '../types/driver'
import type { FleetAsset } from '../types/fleet'
import type { OperationalPriorityItem } from '../types/operations'
import { computeExecutiveAnalyticsSnapshot } from '../services/executiveAnalyticsEngine'
import { fetchExecutiveSummary } from '../services/executiveAnalyticsCopilotHelpers'
import { GeminiCopilotError } from '../services/geminiCopilot'
import { LOADING_LABELS } from '../data/demoExperience'

type ExecutiveAnalyticsProps = {
  fleetAssets: FleetAsset[]
  driverRecords: DriverData[]
  vehiclesLoading: boolean
  driversLoading: boolean
  isActive: boolean
}

const chartTooltipStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#1e293b',
  borderRadius: '12px',
  fontSize: '12px',
}

const priorityStyles = {
  CRITICAL: {
    badge: 'border-red-400/45 bg-red-500/10 text-red-300',
    dot: 'bg-red-400',
  },
  HIGH: {
    badge: 'border-amber-400/45 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  NORMAL: {
    badge: 'border-emerald-400/45 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
} as const

const FLEET_HEALTH_COLORS = {
  Optimal: '#34d399',
  Critical: '#f87171',
  'Charging / Docking': '#22d3ee',
} as const

function KpiCard({
  label,
  value,
  tone = 'text-white',
  hint,
}: {
  label: string
  value: string | number
  tone?: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/30 p-5 backdrop-blur-md">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-slate-600">{hint}</p> : null}
    </div>
  )
}

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

export function ExecutiveAnalytics({
  fleetAssets,
  driverRecords,
  vehiclesLoading,
  driversLoading,
}: ExecutiveAnalyticsProps) {
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const snapshot = useMemo(
    () =>
      computeExecutiveAnalyticsSnapshot(
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

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const requestTimeSnapshot = computeExecutiveAnalyticsSnapshot(
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
      )
      const text = await fetchExecutiveSummary(requestTimeSnapshot)
      setSummary(text)
    } catch (err) {
      const message =
        err instanceof GeminiCopilotError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to generate executive summary.'
      setSummaryError(message)
    } finally {
      setSummaryLoading(false)
    }
  }, [fleetAssets, driverRecords])

  const loading = vehiclesLoading || driversLoading

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-white/8 bg-slate-950/50 px-8 py-16 backdrop-blur-xl">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-violet-400" />
        <p className="text-sm font-semibold text-white">{LOADING_LABELS.analytics}</p>
        <p className="mt-1 text-xs text-slate-500">Aggregating RLS-scoped fleet intelligence…</p>
      </div>
    )
  }

  const { kpis, fleetHealth, compliance, alertSummary, assignment, priorityActions } = snapshot

  const fleetHealthChartData = [
    { status: 'Optimal', count: fleetHealth.optimal },
    { status: 'Critical', count: fleetHealth.critical },
    { status: 'Charging / Docking', count: fleetHealth.chargingDocking },
  ]

  const complianceChartData = [
    { label: 'Valid', count: compliance.validCount },
    { label: 'Expiring Soon', count: compliance.expiringSoonCount },
    { label: 'Expired', count: compliance.expiredCount },
    { label: 'Unknown', count: compliance.unknownCount },
  ]

  const complianceColors: Record<string, string> = {
    Valid: '#34d399',
    'Expiring Soon': '#fbbf24',
    Expired: '#f87171',
    Unknown: '#94a3b8',
  }

  return (
    <div className="relative mx-auto max-w-6xl space-y-8">
      <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-violet-950/20 to-slate-950/80 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
              <Activity className="h-3 w-3" />
              Executive Analytics
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Executive Overview</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Current snapshot analytics from your RLS-scoped fleet, compliance, and operations
              engines. Vehicle status uses simulated demo telemetry — not live GPS or production
              telemetry. Gemini summarizes supplied facts only; it does not calculate KPIs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={summaryLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/15 disabled:opacity-60"
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
        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          <BarChart3 className="h-4 w-4" />
          Key Performance Indicators
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <KpiCard label="Total Vehicles" value={kpis.totalVehicles} />
          <KpiCard label="Assigned Vehicles" value={kpis.assignedVehicles} tone="text-blue-300" />
          <KpiCard label="Unassigned Vehicles" value={kpis.unassignedVehicles} tone="text-slate-300" />
          <KpiCard label="Critical Vehicles" value={kpis.criticalVehicles} tone="text-red-400" />
          <KpiCard
            label="Charging / Docking"
            value={kpis.chargingDockingVehicles}
            tone="text-cyan-300"
            hint="Simulated telemetry"
          />
          <KpiCard label="Optimal Vehicles" value={kpis.optimalVehicles} tone="text-emerald-400" />
          <KpiCard label="Total Drivers" value={kpis.totalDrivers} tone="text-indigo-300" />
          <KpiCard
            label="Compliance %"
            value={kpis.compliancePercentageLabel}
            tone={
              compliance.compliancePercentage === null ? 'text-slate-400' : 'text-emerald-300'
            }
          />
          <KpiCard label="Expired Licenses" value={kpis.expiredLicenses} tone="text-red-400" />
          <KpiCard label="Expiring Soon" value={kpis.expiringSoon} tone="text-amber-300" />
          <KpiCard
            label="Open Critical Alerts"
            value={kpis.openCriticalAlerts}
            tone={kpis.openCriticalAlerts > 0 ? 'text-red-400' : 'text-emerald-400'}
          />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-3xl border border-white/8 bg-slate-950/50 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                Fleet Health
              </h3>
            </div>
            <span className="rounded-full border border-slate-600/50 bg-slate-800/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Simulated Telemetry
            </span>
          </div>
          {fleetHealth.totalVehicles === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">
              No vehicles in the current RLS-scoped session.
            </p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fleetHealthChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="status" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="count" name="Vehicles" radius={[4, 4, 0, 0]}>
                    {fleetHealthChartData.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={
                          FLEET_HEALTH_COLORS[entry.status as keyof typeof FLEET_HEALTH_COLORS] ??
                          '#6366f1'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/8 bg-slate-950/50 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              Compliance Analytics
            </h3>
          </div>
          <div className="mb-4 rounded-2xl border border-white/8 bg-slate-950/60 p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Compliance Rate</p>
            <p
              className={`mt-1 text-3xl font-bold ${
                compliance.compliancePercentage === null ? 'text-slate-400' : 'text-emerald-300'
              }`}
            >
              {compliance.compliancePercentageLabel}
            </p>
            {compliance.compliancePercentage === null ? (
              <p className="mt-1 text-xs text-slate-500">
                Percentage unavailable when no parseable expiry data exists.
              </p>
            ) : null}
          </div>
          {compliance.totalDrivers === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No driver compliance records in the current RLS-scoped session.
            </p>
          ) : (
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={complianceChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" name="Drivers" radius={[4, 4, 0, 0]}>
                    {complianceChartData.map((entry) => (
                      <Cell key={entry.label} fill={complianceColors[entry.label] ?? '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-3xl border border-white/8 bg-slate-950/50 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              Alert Analytics
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Total Alerts', value: alertSummary.total, tone: 'text-white' },
              { label: 'Critical', value: alertSummary.critical, tone: 'text-red-400' },
              { label: 'High', value: alertSummary.high, tone: 'text-amber-300' },
              { label: 'Open', value: alertSummary.open, tone: 'text-sky-300' },
              { label: 'Acknowledged', value: alertSummary.acknowledged, tone: 'text-violet-300' },
              { label: 'Resolved', value: alertSummary.resolved, tone: 'text-emerald-300' },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-2xl border border-slate-900 bg-slate-900/30 p-4"
              >
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</p>
                <p className={`mt-1 text-xl font-bold ${metric.tone}`}>{metric.value}</p>
              </div>
            ))}
          </div>
          {alertSummary.total === 0 ? (
            <p className="mt-4 text-center text-xs text-slate-500">
              No elevated alerts from the current operations snapshot.
            </p>
          ) : null}
        </section>

        <section className="rounded-3xl border border-white/8 bg-slate-950/50 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              Assignment Coverage
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Assigned" value={assignment.assignedVehicles} tone="text-blue-300" />
            <KpiCard
              label="Unassigned"
              value={assignment.unassignedVehicles}
              tone="text-slate-300"
            />
            <KpiCard
              label="Coverage"
              value={assignment.assignmentCoverageLabel}
              tone={
                assignment.assignmentCoveragePercent === null
                  ? 'text-slate-400'
                  : 'text-emerald-300'
              }
            />
          </div>
          {assignment.totalVehicles === 0 ? (
            <p className="mt-4 text-center text-xs text-slate-500">
              Assignment coverage unavailable — no vehicles in session.
            </p>
          ) : (
            <p className="mt-4 text-xs text-slate-500">
              Coverage = assigned vehicles ÷ total vehicles. Based on authoritative{' '}
              <span className="font-mono text-slate-400">assigned_driver_id</span> assignments
              only.
            </p>
          )}
        </section>
      </div>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-indigo-400" />
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            Priority Actions
          </h3>
        </div>
        {priorityActions.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-300">No elevated priorities</p>
                <p className="mt-1 text-xs text-slate-400">
                  Operations snapshot reports no critical or high-priority items.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {priorityActions.map((item) => (
              <PriorityActionCard
                key={`${item.level}-${item.category}-${item.subject}`}
                item={item}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-white/8 bg-slate-950/50 p-6 shadow-2xl backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            AI Executive Summary
          </h3>
        </div>
        <div className="rounded-2xl border border-white/8 bg-slate-950/60 p-5">
          {summaryLoading ? (
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              Generating AI summary…
            </div>
          ) : summaryError ? (
            <div>
              <p className="text-sm text-red-300">{summaryError}</p>
              <button
                type="button"
                onClick={() => void loadSummary()}
                className="mt-3 text-xs font-semibold text-violet-300 hover:text-violet-200"
              >
                Retry summary
              </button>
            </div>
          ) : summary ? (
            <p className="text-sm leading-relaxed text-slate-200">{summary}</p>
          ) : (
            <p className="text-sm text-slate-500">
              Click Refresh AI Summary to generate an executive summary from the current snapshot.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
