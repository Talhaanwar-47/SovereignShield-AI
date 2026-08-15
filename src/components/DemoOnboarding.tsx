import { ArrowRight, LogOut, Shield, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { DEMO_ROLE_OPTIONS } from '../constants/demoOrganization'
import type { MembershipRole } from '../services/authProfile'
import { DemoModeBadge, SimulatedTelemetryBadge } from './demo/DemoUxPrimitives'

type DemoOnboardingProps = {
  displayName: string
  onSelectRole: (role: MembershipRole) => Promise<void>
  onLogout: () => void
}

/**
 * Public recruiter demo entry — shown when Google auth succeeded but no production membership exists.
 * Each visitor explicitly chooses one of three real demo roles.
 */
export default function DemoOnboarding({
  displayName,
  onSelectRole,
  onLogout,
}: DemoOnboardingProps) {
  const [pendingRole, setPendingRole] = useState<MembershipRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSelect = async (role: MembershipRole) => {
    setPendingRole(role)
    setError(null)
    try {
      await onSelectRole(role)
    } catch {
      setError('Unable to enter demo mode. Please try again.')
      setPendingRole(null)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f1a] px-6 py-12">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <DemoModeBadge />
            <SimulatedTelemetryBadge />
          </div>
          <div className="mb-3 flex items-center justify-center gap-2">
            <Shield className="h-6 w-6 text-indigo-400" aria-hidden="true" />
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-300/80">
              Public recruiter demo
            </p>
          </div>
          <h1 className="text-3xl font-bold text-white">Explore SovereignShield AI</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            Signed in as{' '}
            <span className="font-semibold text-slate-200">{displayName}</span>. Choose a demo
            role to experience the same application from an Admin, Fleet Manager, or Driver
            perspective — isolated demo data only, with real role-based access control.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {DEMO_ROLE_OPTIONS.map((option) => {
            const isPending = pendingRole === option.role
            const isDisabled = pendingRole !== null && !isPending

            return (
              <button
                key={option.role}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  void handleSelect(option.role)
                }}
                className="group flex flex-col rounded-3xl border border-white/8 bg-slate-950/70 p-6 text-left transition-all hover:border-indigo-500/30 hover:bg-slate-950/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="mb-4 flex items-center gap-2">
                  <Sparkles
                    className="h-4 w-4 text-indigo-400 group-hover:text-indigo-300"
                    aria-hidden="true"
                  />
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                    {option.title}
                  </span>
                </div>
                <p className="text-sm font-semibold text-white">{option.subtitle}</p>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-400">
                  {option.description}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400">
                  {isPending ? 'Entering demo…' : 'Enter demo'}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </button>
            )
          })}
        </div>

        {error ? (
          <p className="mt-4 text-center text-sm text-rose-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-8 rounded-2xl border border-white/8 bg-white/3 p-4 text-center text-xs text-slate-500">
          Production organization access requires an administrator invitation. Demo mode uses an
          isolated tenant with synthetic fleet data — never production records.
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="mx-auto mt-6 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-white/20 hover:bg-white/10"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  )
}
