import { AlertCircle, LogOut, Shield } from 'lucide-react'

type NoOrganizationAccessProps = {
  displayName: string
  onLogout: () => void
}

/**
 * Shown when Supabase Auth succeeded but organization_members has no usable row.
 * Blocks the dashboard shell — org-scoped modules must not mount.
 */
export default function NoOrganizationAccess({
  displayName,
  onLogout,
}: NoOrganizationAccessProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f1a] px-6 py-12">
      <div
        className="w-full max-w-lg rounded-3xl border border-rose-500/20 bg-slate-950/80 p-8 shadow-2xl shadow-slate-950/50 backdrop-blur-xl"
        role="alert"
        aria-live="polite"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10">
            <Shield className="h-6 w-6 text-rose-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-300/80">
              Access denied
            </p>
            <h1 className="text-xl font-bold text-white">No organization access</h1>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-slate-300">
          Signed in as <span className="font-semibold text-white">{displayName}</span>, but this
          account is not assigned to an organization in SovereignShield AI.
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-white/8 bg-white/3 p-4 text-sm text-slate-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p>
            Fleet, Copilot, compliance, analytics, and other organization modules stay unavailable
            until an administrator adds you to <code className="text-slate-300">organization_members</code>.
            The login role selector does not grant access.
          </p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-white/20 hover:bg-white/10"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  )
}
