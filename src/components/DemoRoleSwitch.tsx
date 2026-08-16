import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { DEMO_ROLE_OPTIONS } from '../constants/demoOrganization'
import type { MembershipRole } from '../services/authProfile'

type DemoRoleSwitchProps = {
  currentRole: MembershipRole
  onSwitchRole: (role: MembershipRole) => Promise<void>
}

/**
 * Explicit demo role switcher — only for isolated demo organization members.
 */
export default function DemoRoleSwitch({ currentRole, onSwitchRole }: DemoRoleSwitchProps) {
  const [open, setOpen] = useState(false)
  const [pendingRole, setPendingRole] = useState<MembershipRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  const otherRoles = DEMO_ROLE_OPTIONS.filter((option) => option.role !== currentRole)

  const handleSwitch = async (role: MembershipRole) => {
    setPendingRole(role)
    setError(null)
    try {
      await onSwitchRole(role)
      setOpen(false)
    } catch {
      setError('Unable to switch demo role. Please try again.')
    } finally {
      setPendingRole(null)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-300 transition-all hover:border-indigo-500/40 hover:bg-indigo-500/15"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Switch Demo Role
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">
        Switch demo perspective
      </p>
      {otherRoles.map((option) => (
        <button
          key={option.role}
          type="button"
          disabled={pendingRole !== null}
          onClick={() => {
            void handleSwitch(option.role)
          }}
          className="flex w-full flex-col rounded-lg border border-white/8 bg-slate-950/50 px-3 py-2 text-left transition-colors hover:border-indigo-500/30 disabled:opacity-50"
        >
          <span className="text-xs font-semibold text-white">{option.title}</span>
          <span className="text-[10px] text-slate-400">{option.subtitle}</span>
        </button>
      ))}
      {error ? (
        <p className="text-[10px] text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full text-[10px] font-medium text-slate-500 hover:text-slate-300"
      >
        Cancel
      </button>
    </div>
  )
}
