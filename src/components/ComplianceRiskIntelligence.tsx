import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  HelpCircle,
  Loader2,
  Scale,
  ShieldAlert,
  Sparkles,
  Truck,
  UserCheck,
} from 'lucide-react'
import type { DriverData } from '../types/driver'
import type { FleetAsset } from '../types/fleet'
import type { ComplianceCriticalItem, DriverComplianceRow, LicenseComplianceStatus } from '../types/compliance'
import {
  COMPLIANCE_NOT_RISK_MESSAGE,
  computeComplianceSnapshot,
} from '../services/complianceEngine'
import { fetchComplianceExplanation } from '../services/complianceCopilotHelpers'
import { GeminiCopilotError } from '../services/geminiCopilot'
import { EMPTY_STATES, LOADING_LABELS } from '../data/demoExperience'

type ComplianceRiskIntelligenceProps = {
  fleetAssets: FleetAsset[]
  driverRecords: DriverData[]
  vehiclesLoading: boolean
  driversLoading: boolean
}

const licenseStatusStyles: Record<
  LicenseComplianceStatus,
  { badge: string; label: string }
> = {
  EXPIRED: {
    badge: 'border-red-400/45 bg-red-500/10 text-red-300',
    label: 'Expired',
  },
  EXPIRING_SOON: {
    badge: 'border-amber-400/45 bg-amber-500/10 text-amber-300',
    label: 'Expiring Soon',
  },
  VALID: {
    badge: 'border-emerald-400/45 bg-emerald-500/10 text-emerald-300',
    label: 'Valid',
  },
  UNKNOWN: {
    badge: 'border-slate-500/45 bg-slate-500/10 text-slate-400',
    label: 'Unknown',
  },
}

const priorityStyles = {
  CRITICAL: 'border-red-400/45 bg-red-500/10 text-red-300',
  HIGH: 'border-amber-400/45 bg-amber-500/10 text-amber-300',
  UNKNOWN: 'border-slate-500/45 bg-slate-500/10 text-slate-400',
  NORMAL: 'border-emerald-400/45 bg-emerald-500/10 text-emerald-300',
} as const

function DriverComplianceTable({ rows }: { rows: DriverComplianceRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-slate-500">{EMPTY_STATES.noComplianceData}</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-white/8 bg-white/3">
            {['Driver', 'Assigned Vehicle', 'License Status', 'Expiry', 'Action Required'].map(
              (label) => (
                <th
                  key={label}
                  className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500"
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const style = licenseStatusStyles[row.licenseStatus]
            return (
              <tr key={row.driverName} className="border-b border-white/5 hover:bg-white/2">
                <td className="px-5 py-4 text-sm font-medium text-white">{row.driverName}</td>
                <td className="px-5 py-4 font-mono text-sm text-blue-300">
                  {row.assignedVehicle ?? '—'}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${style.badge}`}
                  >
                    {row.licenseStatus.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm text-slate-400">{row.expiryDate ?? '—'}</td>
                <td className="px-5 py-4 text-sm text-slate-300">{row.recommendedAction}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CriticalItemCard({ item }: { item: ComplianceCriticalItem }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/60 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${priorityStyles[item.priority]}`}
        >
          {item.priority}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {item.category}
        </span>
        {item.simulated ? (
          <span className="rounded-full border border-slate-600/50 bg-slate-800/50 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-400">
            Simulated
          </span>
        ) : null}
      </div>
      <p className="font-mono text-sm text-blue-300">{item.subject}</p>
      <p className="mt-1 text-sm font-medium text-white">{item.title}</p>
      <p className="mt-1 text-xs text-slate-400">{item.description}</p>
      <p className="mt-2 text-xs text-slate-300">
        <span className="font-semibold text-slate-200">Action:</span> {item.recommendedAction}
      </p>
    </div>
  )
}

export function ComplianceRiskIntelligence({
  fleetAssets,
  driverRecords,
  vehiclesLoading,
  driversLoading,
}: ComplianceRiskIntelligenceProps) {
  const [explaining, setExplaining] = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [explainError, setExplainError] = useState<string | null>(null)

  const snapshot = useMemo(
    () =>
      computeComplianceSnapshot(
        driverRecords.map((d) => ({ fullName: d.fullName, expiryDate: d.expiryDate })),
        fleetAssets.map((a) => ({
          assetId: a.assetId,
          driverName: a.driverName,
          status: a.status,
          statusLabel: a.statusLabel,
        })),
      ),
    [driverRecords, fleetAssets],
  )

  const handleExplain = useCallback(async () => {
    setExplaining(true)
    setExplainError(null)
    try {
      const text = await fetchComplianceExplanation(snapshot)
      setExplanation(text)
    } catch (err) {
      const message =
        err instanceof GeminiCopilotError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to explain compliance snapshot.'
      setExplainError(message)
    } finally {
      setExplaining(false)
    }
  }, [snapshot])

  const loading = vehiclesLoading || driversLoading

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-white/8 bg-slate-950/50 px-8 py-16 backdrop-blur-xl">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-indigo-400" />
        <p className="text-sm font-semibold text-white">{LOADING_LABELS.compliance}</p>
        <p className="mt-1 text-xs text-slate-500">Building RLS-scoped compliance snapshot…</p>
      </div>
    )
  }

  return (
    <div className="relative mx-auto max-w-6xl space-y-8">
      <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-emerald-950/10 to-slate-950/80 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
              <Scale className="h-3 w-3" />
              Compliance &amp; Risk Intelligence
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              License &amp; Fleet Compliance Console
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Deterministic compliance indicators from RLS-scoped registry data. Vehicle status
              reflects simulated demo telemetry only. No driver risk scores are calculated.
            </p>
          </div>
          <button
            type="button"
            disabled={explaining}
            onClick={() => void handleExplain()}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-2.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-60"
          >
            {explaining ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Explain Compliance
          </button>
        </div>
        {explanation ? (
          <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
              AI Compliance Summary
            </p>
            <p className="text-sm leading-relaxed text-slate-200">{explanation}</p>
          </div>
        ) : null}
        {explainError ? <p className="mt-3 text-xs text-red-300">{explainError}</p> : null}
      </div>

      {/* A. Compliance Overview */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          <ClipboardCheck className="h-4 w-4" />
          Compliance Overview
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            {
              label: 'Overall Compliance',
              value: snapshot.compliancePercentageLabel,
              tone:
                snapshot.compliancePercentage === null
                  ? 'text-slate-400'
                  : snapshot.compliancePercentage >= 80
                    ? 'text-emerald-400'
                    : 'text-amber-400',
            },
            { label: 'Expired Licenses', value: snapshot.expiredCount, tone: 'text-red-400' },
            { label: 'Expiring Soon', value: snapshot.expiringSoonCount, tone: 'text-amber-400' },
            { label: 'Valid', value: snapshot.validCount, tone: 'text-emerald-400' },
            {
              label: 'Data Requiring Review',
              value: snapshot.unknownCount,
              tone: 'text-slate-400',
            },
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

      {/* B. License Compliance */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          <UserCheck className="h-4 w-4" />
          License Compliance
        </h3>
        <div className="overflow-hidden rounded-3xl border border-white/8 bg-slate-950/50 shadow-2xl backdrop-blur-xl">
          <DriverComplianceTable rows={snapshot.driverCompliance} />
        </div>
      </section>

      {/* C. Critical Compliance Items */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Critical Compliance Items
        </h3>
        {snapshot.criticalItems.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <p className="text-sm font-semibold text-emerald-300">
                No critical compliance items in the current session.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {snapshot.criticalItems.map((item) => (
              <CriticalItemCard key={`${item.category}-${item.subject}-${item.title}`} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* D. Vehicle Compliance */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          <Truck className="h-4 w-4" />
          Vehicle Compliance
          <span className="rounded-full border border-slate-600/50 px-2 py-0.5 font-mono text-[9px] uppercase text-slate-500">
            Simulated Telemetry
          </span>
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {snapshot.vehicleCompliance.length === 0 ? (
            <p className="col-span-full text-sm text-slate-500">No vehicle records available.</p>
          ) : (
            snapshot.vehicleCompliance.map((vehicle) => (
              <div
                key={vehicle.assetId}
                className="rounded-2xl border border-white/8 bg-slate-950/60 p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-sm font-semibold text-blue-300">{vehicle.assetId}</p>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    Simulated
                  </span>
                </div>
                <p className="text-sm text-white">Status: {vehicle.statusLabel}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Driver: {vehicle.assignedDriver} · Source: {vehicle.source}
                </p>
                <p className="mt-2 text-xs text-slate-300">{vehicle.recommendedAction}</p>
              </div>
            ))
          )}
        </div>
      </section>

      {/* E. Risk Intelligence */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          <ShieldAlert className="h-4 w-4" />
          Risk Intelligence
          <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] uppercase text-amber-300">
            Data Unavailable
          </span>
        </h3>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
          <div className="flex items-start gap-3">
            <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-200">
                {EMPTY_STATES.noDriverRisk}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {COMPLIANCE_NOT_RISK_MESSAGE}
              </p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                Compliance status ≠ driver risk score · Simulated telemetry ≠ real safety data
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
