import { Info } from 'lucide-react'
import { DEMO_MODE_LABEL, SIMULATED_TELEMETRY_LABEL } from '../data/demoExperience'

type DemoModeBannerProps = {
  /** When true, do not claim that authentication is simulated. */
  isAuthenticated?: boolean
}

export default function DemoModeBanner({ isAuthenticated = false }: DemoModeBannerProps) {
  return (
    <div
      role="status"
      aria-label="Demo mode notice"
      className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
          <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
            {DEMO_MODE_LABEL}
          </span>
          <span className="rounded-full border border-slate-600/50 bg-slate-900/60 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-300">
            {SIMULATED_TELEMETRY_LABEL}
          </span>
        </div>
        <p className="text-[11px] font-medium text-amber-200/90">
          {isAuthenticated ? (
            <>
              Vehicle telemetry is simulated. Registry and membership data come from the application
              database under RLS. Audit events are session-only.
            </>
          ) : (
            <>
              Demo environment with simulated fleet telemetry. Sign in with Google for real Supabase
              Auth and RLS-scoped data.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
