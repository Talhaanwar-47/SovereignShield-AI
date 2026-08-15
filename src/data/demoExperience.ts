import type { MembershipRole } from '../services/authProfile'

export const PRODUCT_TITLE = 'SovereignShield AI'

export const PRODUCT_TAGLINE = 'AI-Powered Fleet Intelligence & Operations Platform'

export const PRODUCT_DESCRIPTION =
  'An enterprise fleet intelligence platform combining secure role-based access, compliance intelligence, operational prioritization, alerts, analytics, and natural-language AI assistance.'

export const DEMO_MODE_LABEL = 'DEMO MODE'

export const SIMULATED_TELEMETRY_LABEL = 'SIMULATED TELEMETRY'

export const REAL_APPLICATION_DATA_LABEL = 'REAL APPLICATION DATA'

export const UNAVAILABLE_LABEL = 'UNAVAILABLE'

export type RoleOverview = {
  role: MembershipRole
  title: string
  description: string
}

export const ROLE_OVERVIEWS: RoleOverview[] = [
  {
    role: 'admin',
    title: 'Admin',
    description: 'Organization-wide operational visibility.',
  },
  {
    role: 'fleet-manager',
    title: 'Fleet Manager',
    description: 'Fleet and compliance operational management.',
  },
  {
    role: 'driver',
    title: 'Driver',
    description: 'Own permitted vehicle and compliance information.',
  },
]

export type DemoGuideStep = {
  order: number
  title: string
  description: string
  tabId:
    | 'fleet'
    | 'copilot'
    | 'operations'
    | 'alerts'
    | 'compliance'
    | 'analytics'
    | 'auditor'
  optionalPrompt?: string
}

export const DEMO_GUIDE_STEPS: DemoGuideStep[] = [
  {
    order: 1,
    title: 'Fleet Intelligence',
    description: 'Review RLS-scoped vehicle inventory and simulated clearance status.',
    tabId: 'fleet',
  },
  {
    order: 2,
    title: 'AI Copilot',
    description: 'Ask a natural-language question grounded in authorized session context.',
    tabId: 'copilot',
    optionalPrompt: 'Which vehicle is assigned to Jürgen?',
  },
  {
    order: 3,
    title: 'Operations Command Center',
    description: 'Review deterministic operational priorities.',
    tabId: 'operations',
  },
  {
    order: 4,
    title: 'Alert & Incident Center',
    description: 'Inspect critical and high-priority operational alerts.',
    tabId: 'alerts',
  },
  {
    order: 5,
    title: 'Compliance & Risk Intelligence',
    description: 'Review license compliance indicators for the current scope.',
    tabId: 'compliance',
  },
  {
    order: 6,
    title: 'Executive Analytics',
    description: 'View executive KPIs from current snapshot engines.',
    tabId: 'analytics',
  },
  {
    order: 7,
    title: 'Audit & Security Center',
    description: 'Review session-scoped security and audit activity.',
    tabId: 'auditor',
  },
]

export const COPILOT_SUGGESTED_PROMPTS = [
  'Which vehicle is assigned to Jürgen?',
  'What should I prioritize today?',
  "Summarize today's fleet.",
  'Which licenses need attention?',
  'Explain the current fleet health.',
] as const

export const PRODUCT_CAPABILITIES = [
  'Secure RBAC/RLS architecture',
  'AI Copilot',
  'Fleet Intelligence',
  'Compliance Intelligence',
  'Operational Prioritization',
  'Alert Management',
  'Executive Analytics',
  'Audit & Security',
] as const

export const EMPTY_STATES = {
  noAlerts: 'No active operational alerts.',
  noHistoricalAudit:
    'No historical audit data is available. Current session activity is shown below.',
  noDriverRisk: 'Driver risk scores are not available in the current demo.',
  noComplianceData: 'Compliance data is unavailable for the current scope.',
  noVehicles: 'No vehicle records available for the current RLS-scoped session.',
  noDrivers: 'No driver records available for the current RLS-scoped session.',
  noElevatedPriorities: 'No elevated operational priorities in the current snapshot.',
} as const

export const LOADING_LABELS = {
  fleet: 'Loading fleet intelligence…',
  copilot: 'Generating AI summary…',
  operations: 'Loading operations snapshot…',
  alerts: 'Loading alert snapshot…',
  compliance: 'Loading compliance data…',
  analytics: 'Loading executive analytics…',
  audit: 'Loading audit & security data…',
  registry: 'Loading registry records…',
} as const

/** Maps internal tab ids to recruiter-friendly navigation labels. */
export const NAV_TAB_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  fleet: 'Fleet Intelligence',
  copilot: 'AI Fleet Copilot',
  operations: 'Operations Command Center',
  alerts: 'Alert & Incident Center',
  compliance: 'Compliance & Risk Intelligence',
  analytics: 'Executive Analytics',
  auditor: 'Audit & Security Center',
  identity: 'AI Identity Verification',
}

export const COPILOT_DISCLOSURE =
  'AI-powered · Natural language · Grounded in authorized application context. The assistant only uses data supplied from your session — not live GPS, maintenance records, or driver risk scores.'

export const DEMO_DISCLAIMERS = {
  noLiveTelemetry:
    'Vehicle speed, battery, and clearance status are simulated demo telemetry — not live GPS or production telemetry.',
  noDriverRisk: 'Driver risk scores are not available in this demo.',
  noMaintenanceRecords: 'Simulated vehicle status is not a real maintenance record.',
  noProductionDeployment: 'This environment demonstrates application capabilities — not a production fleet deployment.',
} as const
