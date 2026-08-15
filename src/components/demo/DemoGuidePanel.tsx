import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { DEMO_GUIDE_STEPS, type DemoGuideStep } from '../../data/demoExperience'

type DemoGuidePanelProps = {
  onNavigate: (tabId: DemoGuideStep['tabId']) => void
  onCopilotPrompt?: (prompt: string) => void
}

export function DemoGuidePanel({ onNavigate, onCopilotPrompt }: DemoGuidePanelProps) {
  const [open, setOpen] = useState(true)

  return (
    <section
      aria-labelledby="demo-guide-heading"
      className="overflow-hidden rounded-3xl border border-emerald-500/15 bg-emerald-500/5 shadow-xl backdrop-blur-xl"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="demo-guide-content"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition hover:bg-emerald-500/5"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
            <BookOpen className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h2 id="demo-guide-heading" className="text-sm font-bold text-white">
              Demo Guide
            </h2>
            <p className="text-xs text-slate-400">
              Recommended walkthrough — navigate manually, no autoplay
            </p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div id="demo-guide-content" className="border-t border-emerald-500/10 px-6 py-4">
          <ol className="space-y-3">
            {DEMO_GUIDE_STEPS.map((step) => (
              <li
                key={step.order}
                className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-400/80">
                    Step {step.order}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">{step.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{step.description}</p>
                  {step.optionalPrompt ? (
                    <p className="mt-2 font-mono text-[11px] text-indigo-300/90">
                      Suggested prompt: “{step.optionalPrompt}”
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate(step.tabId)}
                    className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/15"
                  >
                    Open {step.title}
                  </button>
                  {step.optionalPrompt && onCopilotPrompt ? (
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate('copilot')
                        onCopilotPrompt(step.optionalPrompt!)
                      }}
                      className="rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/15"
                    >
                      Use prompt
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
