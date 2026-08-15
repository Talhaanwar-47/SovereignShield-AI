/** Production tenant — real organization memberships take precedence over demo. */
export const PRODUCTION_ORGANIZATION_NAME = 'SovereignShield Fleet'

/** Isolated public recruiter demo tenant (STEP 26E). */
export const DEMO_ORGANIZATION_NAME = 'SovereignShield Demo'

/** Fixed demo organization UUID — must match migration seed. */
export const DEMO_ORGANIZATION_ID = 'd0000000-0000-4000-8000-000000000001'

export const DEMO_ROLES = ['admin', 'fleet-manager', 'driver'] as const

export type DemoRoleOption = {
  role: (typeof DEMO_ROLES)[number]
  title: string
  subtitle: string
  description: string
}

export const DEMO_ROLE_OPTIONS: DemoRoleOption[] = [
  {
    role: 'admin',
    title: 'Admin Demo',
    subtitle: 'Organization-wide fleet operations view.',
    description:
      'Full demo fleet visibility, driver registry with authorized PII, operations, compliance, analytics, and audit.',
  },
  {
    role: 'fleet-manager',
    title: 'Fleet Manager Demo',
    subtitle: 'Fleet and compliance management with protected driver PII hidden.',
    description:
      'Organization-wide demo fleet and compliance visibility without protected driver PII fields.',
  },
  {
    role: 'driver',
    title: 'Driver Demo',
    subtitle: 'Individual driver and assigned-vehicle experience.',
    description:
      'Own demo driver record, assigned vehicle, compliance information, and role-scoped alerts and audit.',
  },
]
