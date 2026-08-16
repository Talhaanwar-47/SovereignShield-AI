import {
  DEMO_DISCLAIMERS,
  PRODUCT_CAPABILITIES,
  PRODUCT_DESCRIPTION,
  PRODUCT_TAGLINE,
  PRODUCT_TITLE,
  REAL_APPLICATION_DATA_LABEL,
  SIMULATED_TELEMETRY_LABEL,
} from '../../data/demoExperience'

type ProductOverviewPanelProps = {
  organizationName: string | null
}

export function ProductOverviewPanel({ organizationName }: ProductOverviewPanelProps) {
  return (
    <section
      aria-labelledby="product-overview-heading"
      className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-indigo-950/20 to-slate-950/80 p-8 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-300">
          {REAL_APPLICATION_DATA_LABEL}
        </span>
        <span className="rounded-full border border-slate-600/50 bg-slate-800/50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {SIMULATED_TELEMETRY_LABEL}
        </span>
      </div>

      <h1 id="product-overview-heading" className="mt-4 text-3xl font-bold tracking-tight text-white">
        {PRODUCT_TITLE}
      </h1>
      <p className="mt-2 text-lg font-medium text-indigo-300">{PRODUCT_TAGLINE}</p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">{PRODUCT_DESCRIPTION}</p>

      {organizationName ? (
        <p className="mt-3 text-xs text-slate-500">
          Organization context:{' '}
          <span className="font-medium text-slate-300">{organizationName}</span>
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCT_CAPABILITIES.map((capability) => (
          <div
            key={capability}
            className="rounded-xl border border-white/8 bg-slate-950/50 px-4 py-3 text-sm text-slate-300"
          >
            {capability}
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-slate-500">{DEMO_DISCLAIMERS.noLiveTelemetry}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{DEMO_DISCLAIMERS.noDriverRisk}</p>
    </section>
  )
}
