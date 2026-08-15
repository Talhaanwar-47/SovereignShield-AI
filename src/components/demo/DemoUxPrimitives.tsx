import { Loader2 } from 'lucide-react'
import {
  DEMO_MODE_LABEL,
  SIMULATED_TELEMETRY_LABEL,
  UNAVAILABLE_LABEL,
} from '../../data/demoExperience'

export function DemoModeBadge() {
  return (
    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-300">
      {DEMO_MODE_LABEL}
    </span>
  )
}

export function SimulatedTelemetryBadge() {
  return (
    <span className="rounded-full border border-slate-600/50 bg-slate-800/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
      {SIMULATED_TELEMETRY_LABEL}
    </span>
  )
}

export function RealApplicationDataBadge() {
  return (
    <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300">
      REAL APPLICATION DATA
    </span>
  )
}

export function UnavailableBadge() {
  return (
    <span className="rounded-full border border-slate-600/50 bg-slate-800/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500">
      {UNAVAILABLE_LABEL}
    </span>
  )
}

export function ModuleLoadingPanel({
  label,
  hint,
}: {
  label: string
  hint?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center rounded-3xl border border-white/8 bg-slate-950/50 px-8 py-16 backdrop-blur-xl"
    >
      <Loader2 className="mb-4 h-8 w-8 animate-spin text-indigo-400" aria-hidden="true" />
      <p className="text-sm font-semibold text-white">{label}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

export function EmptyStatePanel({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/50 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-300">{title}</p>
      {description ? <p className="mt-2 text-xs text-slate-500">{description}</p> : null}
    </div>
  )
}
