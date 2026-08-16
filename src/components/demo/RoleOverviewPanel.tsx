import { Shield, Truck, UserCheck } from 'lucide-react'
import type { MembershipRole } from '../../services/authProfile'
import { ROLE_OVERVIEWS } from '../../data/demoExperience'

const roleIcons = {
  admin: Shield,
  'fleet-manager': Truck,
  driver: UserCheck,
} as const

type RoleOverviewPanelProps = {
  activeRole: MembershipRole | null
  activeRoleLabel: string
}

export function RoleOverviewPanel({ activeRole, activeRoleLabel }: RoleOverviewPanelProps) {
  return (
    <section aria-labelledby="role-overview-heading">
      <h2
        id="role-overview-heading"
        className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-500"
      >
        Role Experiences
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        Authorization is determined by Supabase organization membership — not the login demo role
        selector. Your active session role:{' '}
        <span className="font-semibold text-slate-300">{activeRoleLabel}</span>
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {ROLE_OVERVIEWS.map((role) => {
          const Icon = roleIcons[role.role]
          const isActive = activeRole === role.role

          return (
            <article
              key={role.role}
              className={`rounded-2xl border p-5 backdrop-blur-md ${
                isActive
                  ? 'border-blue-500/25 bg-blue-500/10 shadow-md shadow-blue-950/20'
                  : 'border-slate-900 bg-slate-900/30'
              }`}
            >
              <div className="mb-3 flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    isActive ? 'bg-blue-500/15' : 'bg-slate-800/80'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${isActive ? 'text-blue-300' : 'text-slate-500'}`}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="text-sm font-bold text-white">{role.title}</h3>
                {isActive ? (
                  <span className="ml-auto rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                    Active
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-relaxed text-slate-400">{role.description}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
