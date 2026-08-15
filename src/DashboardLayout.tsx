import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import {
  Shield,
  Activity,
  LogOut,
  Terminal,
  CheckCircle,
  FileText,
  BookOpen,
  Layers,
  UserCheck,
  ShieldAlert,
  Navigation,
  Upload,
  ScanLine,
  Cpu,
  BadgeCheck,
  Sparkles,
  Loader2,
  Battery,
  Gauge,
  AlertTriangle,
  LayoutGrid,
  Bell,
  Scale,
} from 'lucide-react'
import type { MembershipRole } from './services/authProfile'
import {
  fetchDrivers,
  fetchVehicles,
  formatRegistryRecordCount,
  mayDisplayDriverPii,
  stripDriverPii,
  type FleetDataSource,
} from './services/fleetService'
import { answerCopilotQuery, GeminiCopilotError } from './services/geminiCopilot'
import { isTransientCopilotFailure, type CopilotFailureKind } from './services/geminiCopilotHelpers'
import { createFleetSnapshot } from './services/fleetSnapshot'
import { FLEET_TELEMETRY_INTERVAL_MS, simulateFleetTelemetry } from './services/fleetTelemetry'
import { OperationsCommandCenter } from './components/OperationsCommandCenter'
import { AlertIncidentCenter } from './components/AlertIncidentCenter'
import { ComplianceRiskIntelligence } from './components/ComplianceRiskIntelligence'
import { ExecutiveAnalytics } from './components/ExecutiveAnalytics'
import { AuditSecurityCenter } from './components/AuditSecurityCenter'
import {
  recordCopilotAuditEvent,
  recordFleetRegistryAuditEvent,
  recordVerificationAuditEvent,
} from './services/auditEventService'
import { computeOperationsSnapshot } from './services/operationsPriorityEngine'
import { DemoGuidePanel } from './components/demo/DemoGuidePanel'
import { ProductOverviewPanel } from './components/demo/ProductOverviewPanel'
import { RoleOverviewPanel } from './components/demo/RoleOverviewPanel'
import DemoRoleSwitch from './components/DemoRoleSwitch'
import { ModuleLoadingPanel } from './components/demo/DemoUxPrimitives'
import {
  COPILOT_DISCLOSURE,
  COPILOT_SUGGESTED_PROMPTS,
  EMPTY_STATES,
  LOADING_LABELS,
  NAV_TAB_LABELS,
} from './data/demoExperience'
import {
  formatOcrConfidencePercent,
  isLowOcrConfidence,
  OCR_LOADING_STEPS,
  recognizeDocumentText,
} from './services/ocrService'
import type { DriverData, OcrPipelinePhase, OcrResult } from './types/driver'
import type { FleetAsset, FleetClearanceStatus } from './types/fleet'
import { parseOcrText } from './utils/ocrParser'
import { validateOcrFile } from './utils/ocrValidation'
import {
  formatOcrExtractedPiiForDisplay,
  shouldDisplayOcrExtractedPiiField,
} from './utils/ocrPiiDisplay'
import {
  compareOcrToRegistry,
  formatFieldMatchLabel,
  type DriverMatchComparison,
} from './utils/driverMatch'
import {
  getVerificationDecision,
  VERIFICATION_STATUS_DESCRIPTIONS,
  type VerificationDecision,
} from './utils/verificationDecision'

interface DashboardProps {
  displayName: string
  roleLabel: string
  /** Real organization_members.role — never Login selector. */
  membershipRole: MembershipRole | null
  /** Verified Supabase Auth user.id */
  userId: string
  organizationName: string | null
  /** True for isolated public demo tenant members (STEP 26E). */
  isDemoOrganization?: boolean
  /** Demo-only secure role switch — undefined for production members. */
  onSwitchDemoRole?: (role: MembershipRole) => Promise<void>
  onLogout: () => void
}

type TabId = 'dashboard' | 'identity' | 'fleet' | 'operations' | 'alerts' | 'compliance' | 'copilot' | 'auditor' | 'analytics'

function DataLoadingPanel({ label }: { label: string }) {
  return <ModuleLoadingPanel label={label} hint="Loading records from application database…" />
}

const fleetStatusStyles: Record<FleetClearanceStatus, { badge: string; dot: string }> = {
  optimal: {
    badge:
      'border-emerald-400/45 bg-emerald-500/10 text-emerald-300 shadow-sm shadow-emerald-500/25',
    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]',
  },
  critical: {
    badge: 'border-red-400/45 bg-red-500/10 text-red-300 shadow-sm shadow-red-500/25',
    dot: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)] animate-pulse',
  },
  docking: {
    badge: 'border-cyan-400/45 bg-cyan-500/10 text-cyan-300 shadow-sm shadow-cyan-500/25',
    dot: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]',
  },
}

const OCR_STEP_DISPLAY_LABELS = [
  'Initializing local Tesseract OCR layers...',
  'Scanning document text...',
  'Extracting identity fields...',
] as const

function formatDataSourceLabel(source: FleetDataSource): string {
  return source === 'supabase' ? 'Data Source: Supabase' : 'Data Source: Demo Fallback'
}

function formatRegistryDataSourceLabel(source: FleetDataSource): string {
  return source === 'supabase' ? 'Registry: Supabase' : 'Registry: Demo Fallback'
}

function displayOcrProgressMessage(message: string): string {
  const stepIndex = OCR_LOADING_STEPS.indexOf(message as (typeof OCR_LOADING_STEPS)[number])
  if (stepIndex >= 0) {
    return OCR_STEP_DISPLAY_LABELS[stepIndex] ?? message
  }
  return message
}

function formatGeminiTerminalLines(text: string): string[] {
  const segments = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (segments.length === 0) {
    return ['AI AGENT [gemini]: Null inference vector returned from compliance core.']
  }

  return segments.map((line, index) =>
    index === 0 ? `AI AGENT [gemini]: ${line}` : `AI AGENT: ${line}`,
  )
}

function copilotFailureSupportLine(kind?: CopilotFailureKind): string {
  if (kind === 'invoke_network') {
    return 'AI AGENT: Connection issue · Check your network and try again.'
  }
  if (kind === 'edge_error') {
    return 'AI AGENT: Request could not be completed · See message above.'
  }
  if (kind && isTransientCopilotFailure(kind)) {
    return 'AI AGENT: AI service is temporarily busy · Please try again in a moment.'
  }
  return 'AI AGENT: Please try again.'
}

export default function DashboardLayout({
  displayName,
  roleLabel,
  membershipRole,
  userId,
  organizationName,
  isDemoOrganization = false,
  onSwitchDemoRole,
  onLogout,
}: DashboardProps) {
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || 'A'
  const showDriverPii = mayDisplayDriverPii(membershipRole)
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [copilotQuery, setCopilotQuery] = useState('')
  const [copilotLoading, setCopilotLoading] = useState(false)
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    'SYSTEM: SovereignShield AI Core v4.1.0 Initialized.',
    'NETWORK: Application session ready · Demo mode active.',
    'READY: Recruiter Agent input protocol active.',
  ])
  const [ocrPhase, setOcrPhase] = useState<OcrPipelinePhase>('idle')
  const [ocrStep, setOcrStep] = useState(0)
  const [ocrLiveMessage, setOcrLiveMessage] = useState<string>(OCR_LOADING_STEPS[0])
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)
  const [driverMatchResult, setDriverMatchResult] = useState<DriverMatchComparison | null>(null)
  const [verificationDecision, setVerificationDecision] = useState<VerificationDecision | null>(
    null,
  )
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocrAbortControllerRef = useRef<AbortController | null>(null)
  const [driverRecords, setDriverRecords] = useState<DriverData[]>([])
  const [selectedRegistryIndex, setSelectedRegistryIndex] = useState(0)
  const [fleetAssets, setFleetAssets] = useState<FleetAsset[]>([])
  const [driversLoading, setDriversLoading] = useState(true)
  const [vehiclesLoading, setVehiclesLoading] = useState(true)
  const [driverDataSource, setDriverDataSource] = useState<FleetDataSource>('fallback')
  const [vehicleDataSource, setVehicleDataSource] = useState<FleetDataSource>('fallback')
  const fleetTickRef = useRef(0)
  const fleetAssetsRef = useRef(fleetAssets)
  const driverRecordsRef = useRef(driverRecords)

  useEffect(() => {
    fleetAssetsRef.current = fleetAssets
  }, [fleetAssets])

  useEffect(() => {
    driverRecordsRef.current = driverRecords
  }, [driverRecords])

  const selectedDriver =
    driverRecords.length > 0
      ? driverRecords[Math.min(selectedRegistryIndex, driverRecords.length - 1)] ?? null
      : null

  const optimalCount = fleetAssets.filter((asset) => asset.status === 'optimal').length
  const criticalCount = fleetAssets.filter((asset) => asset.status === 'critical').length

  const operationsSnapshot = useMemo(
    () =>
      computeOperationsSnapshot(
        fleetAssets.map((asset) => ({
          assetId: asset.assetId,
          status: asset.status,
          statusLabel: asset.statusLabel,
        })),
        driverRecords.map((driver) => ({
          fullName: driver.fullName,
          expiryDate: driver.expiryDate,
        })),
      ),
    [fleetAssets, driverRecords],
  )

  const dashboardLoading = driversLoading || vehiclesLoading

  useEffect(() => {
    if (membershipRole == null) return

    let cancelled = false

    async function fetchCloudData() {
      setDriversLoading(true)
      setVehiclesLoading(true)

      const access = { membershipRole, userId }
      const driverResult = await fetchDrivers(access)
      if (cancelled) return
      setDriverRecords(
        mayDisplayDriverPii(membershipRole)
          ? driverResult.data
          : driverResult.data.map(stripDriverPii),
      )
      setSelectedRegistryIndex(0)
      setDriverDataSource(driverResult.source)
      recordFleetRegistryAuditEvent({
        actorDisplayName: displayName,
        actorUserId: userId,
        roleLabel,
        registry: 'drivers',
        source: driverResult.source,
        error: driverResult.error,
      })

      setDriversLoading(false)

      const vehicleResult = await fetchVehicles(access)
      if (cancelled) return
      setFleetAssets(vehicleResult.data)
      setVehicleDataSource(vehicleResult.source)
      recordFleetRegistryAuditEvent({
        actorDisplayName: displayName,
        actorUserId: userId,
        roleLabel,
        registry: 'vehicles',
        source: vehicleResult.source,
        error: vehicleResult.error,
      })

      setVehiclesLoading(false)
    }

    fetchCloudData()
    return () => {
      cancelled = true
    }
  }, [membershipRole, userId, displayName, roleLabel])

  useEffect(() => {
    if (vehiclesLoading) return

    fleetTickRef.current = 0
    const intervalId = window.setInterval(() => {
      fleetTickRef.current += 1
      const tick = fleetTickRef.current
      setFleetAssets((prev) => {
        if (prev.length === 0) return prev
        return simulateFleetTelemetry(prev, tick)
      })
    }, FLEET_TELEMETRY_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [vehiclesLoading])

  useEffect(() => {
    return () => {
      ocrAbortControllerRef.current?.abort()
    }
  }, [])

  const compareAgainstSelectedRegistry = (
    parsed: OcrResult,
    registry: DriverData | null,
    confidence: number | null,
  ) => {
    const registryForCompare =
      registry == null
        ? null
        : showDriverPii
          ? registry
          : stripDriverPii(registry)
    const matchResult = registryForCompare
      ? compareOcrToRegistry(parsed, registryForCompare)
      : null
    const decision = matchResult ? getVerificationDecision(matchResult, confidence) : null
    setDriverMatchResult(matchResult)
    setVerificationDecision(decision)
    if (decision) {
      recordVerificationAuditEvent({
        actorDisplayName: displayName,
        actorUserId: userId,
        roleLabel,
        status: decision.status,
      })
    }
  }

  const handleSelectRegistryRecord = (index: number) => {
    setSelectedRegistryIndex(index)
    if (ocrPhase === 'complete' && ocrResult) {
      const registry = driverRecords[index] ?? null
      compareAgainstSelectedRegistry(ocrResult, registry, ocrConfidence)
    }
  }

  const triggerFileUpload = () => {
    if (ocrPhase === 'scanning') return
    fileInputRef.current?.click()
  }

  const handleDocumentUpload = async (file: File) => {
    if (ocrPhase === 'scanning') return

    const validationError = validateOcrFile(file)
    if (validationError) {
      setOcrError(validationError)
      setOcrPhase('idle')
      setOcrStep(0)
      setOcrLiveMessage('')
      setOcrResult(null)
      setOcrConfidence(null)
      setDriverMatchResult(null)
      setVerificationDecision(null)
      return
    }

    ocrAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    ocrAbortControllerRef.current = abortController
    const { signal } = abortController

    setOcrResult(null)
    setOcrConfidence(null)
    setDriverMatchResult(null)
    setVerificationDecision(null)
    setOcrError(null)
    setOcrPhase('scanning')
    setOcrStep(0)
    setOcrLiveMessage(OCR_LOADING_STEPS[0])

    try {
      const { text, confidence } = await recognizeDocumentText(
        file,
        (update) => {
          if (signal.aborted) return
          setOcrStep(update.step)
          setOcrLiveMessage(update.message)
        },
        signal,
      )

      if (signal.aborted) return

      const parsed = parseOcrText(text, selectedDriver?.documentType)
      if (signal.aborted) return

      setOcrStep(OCR_LOADING_STEPS.length - 1)
      setOcrLiveMessage(OCR_LOADING_STEPS[OCR_LOADING_STEPS.length - 1])
      setOcrResult(parsed)
      setOcrConfidence(confidence)
      // Fleet Manager must not compare against PII; missing fields stay UNAVAILABLE.
      // OCR compares against the selected registry record only.
      compareAgainstSelectedRegistry(parsed, selectedDriver, confidence)
      setOcrPhase('complete')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      const message =
        err instanceof Error
          ? err.message
          : 'Local OCR scan failed. Please retry with a clearer document image.'
      setOcrError(message)
      setOcrPhase('idle')
      setOcrStep(0)
      setOcrResult(null)
      setOcrConfidence(null)
      setDriverMatchResult(null)
      setVerificationDecision(null)
    } finally {
      if (ocrAbortControllerRef.current === abortController) {
        ocrAbortControllerRef.current = null
      }
    }
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void handleDocumentUpload(file)
  }

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (ocrPhase === 'scanning') return
    setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    if (ocrPhase === 'scanning') return
    const file = event.dataTransfer.files?.[0]
    if (file) void handleDocumentUpload(file)
  }

  const executeCopilotQuery = async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed || copilotLoading) return

    setCopilotQuery('')
    setCopilotLoading(true)
    setTerminalHistory((prev) => [
      ...prev,
      `❯ ${trimmed}`,
      'AI AGENT: Uplink established · Gemini inference core processing...',
    ])

    try {
      // Request-time snapshot — never a stale tab-open or initial-load context.
      const currentAssets = fleetAssetsRef.current
      const currentDrivers = driverRecordsRef.current
      const fleetSnapshot = createFleetSnapshot(currentAssets, currentDrivers)
      const context = fleetSnapshot.context
      const geminiText = await answerCopilotQuery(trimmed, context)
      const responseLines = formatGeminiTerminalLines(geminiText)
      setTerminalHistory((prev) => [...prev.slice(0, -1), ...responseLines])
      recordCopilotAuditEvent({
        actorDisplayName: displayName,
        actorUserId: userId,
        roleLabel,
        success: true,
      })
    } catch (err) {
      const copilotErr = err instanceof GeminiCopilotError ? err : null
      const faultMessage =
        copilotErr?.message ??
        (err instanceof Error ? err.message : 'AI service is temporarily busy. Please try again.')
      recordCopilotAuditEvent({
        actorDisplayName: displayName,
        actorUserId: userId,
        roleLabel,
        success: false,
        failureKind: copilotErr?.kind,
      })
      setTerminalHistory((prev) => [
        ...prev.slice(0, -1),
        `EXCEPTION [COPILOT]: ${faultMessage}`,
        copilotFailureSupportLine(copilotErr?.kind),
      ])
    } finally {
      setCopilotLoading(false)
    }
  }

  const runCopilotCommand = (e: FormEvent) => {
    e.preventDefault()
    void executeCopilotQuery(copilotQuery)
  }

  const navTabs = [
    { id: 'dashboard' as const, label: NAV_TAB_LABELS.dashboard, icon: Layers },
    { id: 'fleet' as const, label: NAV_TAB_LABELS.fleet, icon: Navigation },
    { id: 'copilot' as const, label: NAV_TAB_LABELS.copilot, icon: Terminal, premium: true },
    { id: 'operations' as const, label: NAV_TAB_LABELS.operations, icon: LayoutGrid, premium: true },
    { id: 'alerts' as const, label: NAV_TAB_LABELS.alerts, icon: Bell, premium: true },
    { id: 'compliance' as const, label: NAV_TAB_LABELS.compliance, icon: Scale, premium: true },
    { id: 'analytics' as const, label: NAV_TAB_LABELS.analytics, icon: Activity, premium: true },
    { id: 'auditor' as const, label: NAV_TAB_LABELS.auditor, icon: ShieldAlert },
    { id: 'identity' as const, label: NAV_TAB_LABELS.identity, icon: UserCheck },
  ]

  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-[#06060f] font-sans text-slate-100">
      <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-slate-900/60 bg-[#0a0a16]">
        <div>
          <div className="flex items-center gap-3 border-b border-slate-950 p-6">
            <div className="rounded-lg bg-linear-to-br from-blue-600 to-indigo-600 p-2 shadow-lg shadow-blue-500/20">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-wider text-white">SovereignShield</h1>
              <p className="font-mono text-[10px] uppercase tracking-widest text-blue-400">
                v1.0 (ESTONIA)
              </p>
            </div>
          </div>

          <nav className="space-y-1.5 p-4" aria-label="Primary navigation">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-semibold tracking-wide transition-all ${
                  activeTab === tab.id
                    ? 'border-blue-500/20 bg-blue-600/10 text-blue-400 shadow-md shadow-blue-950/40'
                    : 'border-transparent text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <tab.icon
                    className={`h-4 w-4 ${activeTab === tab.id ? 'text-blue-400' : 'text-slate-500'}`}
                  />
                  <span>{tab.label}</span>
                </div>
                {tab.premium && (
                  <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] text-blue-400">
                    CORE
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="space-y-3 border-t border-slate-950 bg-slate-950/20 p-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-900 bg-slate-950/40 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-tr from-indigo-600 to-purple-600 text-xs font-bold text-white shadow-inner">
              {avatarInitial}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-200">{displayName}</p>
              <p className="font-mono text-[10px] text-indigo-400">{roleLabel}</p>
              {organizationName ? (
                <p className="truncate font-mono text-[10px] text-slate-500">{organizationName}</p>
              ) : null}
            </div>
          </div>
          {isDemoOrganization && membershipRole && onSwitchDemoRole ? (
            <DemoRoleSwitch currentRole={membershipRole} onSwitchRole={onSwitchDemoRole} />
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-850 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-400 transition-all hover:border-red-900/30 hover:bg-red-950/30 hover:text-red-400"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout Session</span>
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="z-10 flex h-16 items-center justify-between border-b border-slate-900 bg-[#0a0a16]/40 px-6 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <span className="font-semibold text-slate-200">
              {NAV_TAB_LABELS[activeTab] ?? activeTab}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500/20"
            >
              <BookOpen className="h-3 w-3" aria-hidden="true" />
              Demo Guide
            </button>
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] ${
                driverDataSource === 'supabase'
                  ? 'border-emerald-500/10 bg-emerald-500/5 text-emerald-400'
                  : 'border-amber-500/20 bg-amber-500/5 text-amber-300'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  driverDataSource === 'supabase'
                    ? 'animate-ping bg-emerald-400'
                    : 'bg-amber-400'
                }`}
              />
              {formatRegistryDataSourceLabel(driverDataSource)}
            </div>
          </div>
        </header>

        <div className="relative flex-1 overflow-y-auto bg-[#06060f] p-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1e293b05_1px,transparent_1px),linear-gradient(to_bottom,#1e293b05_1px,transparent_1px)] bg-size-[3rem_3rem]"
          />

          {activeTab === 'dashboard' && (
            <div className="relative mx-auto max-w-6xl space-y-8">
              <ProductOverviewPanel organizationName={organizationName} />

              {dashboardLoading ? (
                <ModuleLoadingPanel
                  label={LOADING_LABELS.fleet}
                  hint="Preparing current snapshot metrics…"
                />
              ) : (
                <section aria-labelledby="snapshot-metrics-heading">
                  <h2
                    id="snapshot-metrics-heading"
                    className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-500"
                  >
                    Current Session Snapshot
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      {
                        title: 'Total Vehicles',
                        value: fleetAssets.length,
                        hint:
                          vehicleDataSource === 'supabase'
                            ? 'Supabase registry'
                            : 'Demo fallback registry',
                      },
                      {
                        title: 'Total Drivers',
                        value: driverRecords.length,
                        hint:
                          driverDataSource === 'supabase'
                            ? 'RLS-scoped registry'
                            : 'Demo fallback registry',
                      },
                      {
                        title: 'Critical Vehicles',
                        value: criticalCount,
                        hint: 'Simulated telemetry',
                      },
                      {
                        title: 'Priority Actions',
                        value: operationsSnapshot.priorityActions.length,
                        hint: 'Operations engine',
                      },
                    ].map((kpi) => (
                      <div
                        key={kpi.title}
                        className="rounded-2xl border border-slate-900 bg-slate-900/30 p-5 backdrop-blur-md"
                      >
                        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                          {kpi.title}
                        </p>
                        <p className="mt-2 text-2xl font-bold text-white">{kpi.value}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{kpi.hint}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <RoleOverviewPanel activeRole={membershipRole} activeRoleLabel={roleLabel} />

              <DemoGuidePanel
                onNavigate={(tabId) => setActiveTab(tabId)}
                onCopilotPrompt={(prompt) => void executeCopilotQuery(prompt)}
              />
            </div>
          )}

          {activeTab === 'identity' && (
            <div className="relative mx-auto max-w-4xl space-y-8">
              {driversLoading ? (
                <DataLoadingPanel label={LOADING_LABELS.registry} />
              ) : (
                <>
              <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-indigo-950/40 via-slate-950/60 to-blue-950/30 p-8 shadow-2xl shadow-indigo-950/30 backdrop-blur-xl">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
                      <Sparkles className="h-3 w-3" />
                      Local OCR Pipeline
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Local Identity Assessment
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                      Local OCR + registry comparison. Tesseract.js extracts structured fields from
                      EU driver licenses in the browser. Parser validation runs on extracted fields;
                      government verification is not performed.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/30 px-4 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                      <Cpu className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Engine</p>
                      <p className="text-xs font-semibold text-slate-200">Tesseract.js · est+eng</p>
                    </div>
                  </div>
                </div>
              </div>

              {driverRecords.length > 0 && ocrPhase !== 'complete' && (
                <div className="rounded-3xl border border-white/8 bg-slate-950/50 p-5 backdrop-blur-xl">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Loaded Registry Record · {formatRegistryRecordCount(driverRecords.length)}
                  </p>
                  <div className="space-y-2">
                    {driverRecords.map((record, index) => {
                      const selected = index === selectedRegistryIndex
                      return (
                        <button
                          key={record.id ?? `${record.fullName}-${index}`}
                          type="button"
                          onClick={() => handleSelectRegistryRecord(index)}
                          className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                            selected
                              ? 'border-indigo-400/40 bg-indigo-500/10'
                              : 'border-white/5 bg-white/3 hover:border-white/15 hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-300">
                              {record.fullName.charAt(0)}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-white">{record.fullName}</p>
                              <p className="font-mono text-[10px] text-slate-500">
                                {showDriverPii ? record.personalCode : '—'}
                              </p>
                            </div>
                          </div>
                          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                            {selected ? 'SELECTED' : record.status}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-3 text-[11px] text-slate-500">
                    OCR compares against the selected registry record.
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileInputChange}
              />

              <button
                type="button"
                onClick={triggerFileUpload}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                disabled={ocrPhase === 'scanning'}
                className={`group relative w-full overflow-hidden rounded-3xl border border-dashed p-12 text-center transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-70 ${
                  isDragging
                    ? 'border-blue-400/55 bg-linear-to-b from-blue-500/15 to-indigo-500/10 shadow-lg shadow-blue-500/15'
                    : 'border-blue-400/25 bg-linear-to-b from-blue-500/8 to-indigo-500/5 hover:border-blue-400/45 hover:from-blue-500/12 hover:to-indigo-500/8 hover:shadow-lg hover:shadow-blue-500/10'
                }`}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.12),transparent_55%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                />
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 shadow-inner shadow-blue-500/20 transition-transform duration-300 group-hover:scale-105">
                  {ocrPhase === 'scanning' ? (
                    <Loader2 className="h-7 w-7 animate-spin text-blue-300" />
                  ) : (
                    <Upload className="h-7 w-7 text-blue-300" />
                  )}
                </div>
                <p className="relative text-base font-semibold text-white">
                  {ocrPhase === 'complete' ? 'Re-upload Document' : 'Click to Upload EU Driver\'s License'}
                </p>
                <p className="relative mt-2 text-xs text-slate-500">
                  Secure document ingestion · Tesseract.js (est+eng) extracts identity fields locally
                </p>
                <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
                  {['JPEG', 'PNG', 'WebP'].map((fmt) => (
                    <span
                      key={fmt}
                      className="rounded-md border border-white/8 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-400"
                    >
                      {fmt}
                    </span>
                  ))}
                </div>
              </button>

              {ocrPhase === 'scanning' && (
                <div className="rounded-3xl border border-indigo-500/20 bg-indigo-500/5 p-6 backdrop-blur-md">
                  <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15">
                      <ScanLine className="h-5 w-5 animate-pulse text-indigo-300" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Running local OCR extraction</p>
                      <p className="text-xs text-indigo-300/70">{displayOcrProgressMessage(ocrLiveMessage)}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {OCR_LOADING_STEPS.map((step, index) => {
                      const isActive = ocrStep === index
                      const isDone = ocrStep > index
                      const stepLabel = OCR_STEP_DISPLAY_LABELS[index] ?? step
                      return (
                        <div
                          key={step}
                          className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-300 ${
                            isActive
                              ? 'border-indigo-400/30 bg-indigo-500/10 shadow-sm shadow-indigo-500/10'
                              : isDone
                                ? 'border-emerald-500/20 bg-emerald-500/5'
                                : 'border-white/5 bg-black/20 opacity-40'
                          }`}
                        >
                          <div
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                              isDone
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : isActive
                                  ? 'bg-indigo-500/20 text-indigo-300'
                                  : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            {isDone ? '✓' : index + 1}
                          </div>
                          <span
                            className={`font-mono text-xs ${
                              isActive ? 'text-indigo-200' : isDone ? 'text-emerald-300' : 'text-slate-500'
                            }`}
                          >
                            {stepLabel}
                          </span>
                          {isActive && (
                            <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-indigo-300" />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-indigo-500 to-violet-400 transition-all duration-500 ease-out"
                      style={{ width: `${((ocrStep + 1) / OCR_LOADING_STEPS.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {ocrError && (
                <div className="rounded-3xl border border-red-500/20 bg-red-950/20 p-5 backdrop-blur-md">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    <div>
                      <p className="text-sm font-semibold text-slate-100">OCR scan interrupted</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{ocrError}</p>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Upload a high-contrast JPEG, PNG, or WebP image of the driver license and try again.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {ocrPhase === 'complete' && ocrResult && (
                <div className="overflow-hidden rounded-3xl border border-emerald-500/25 bg-linear-to-br from-emerald-950/30 via-slate-950/80 to-slate-950/60 shadow-2xl shadow-emerald-950/20 backdrop-blur-xl">
                  <div className="border-b border-emerald-500/15 bg-emerald-500/5 px-6 py-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-400/30">
                          <BadgeCheck className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white">Extracted Identity Profile</h3>
                          <p className="text-xs text-emerald-300/70">
                            OCR extraction complete · Government verification not performed
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-emerald-300 shadow-sm shadow-emerald-500/20">
                        OCR EXTRACTED
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
                    {[
                      { label: 'Full Name', value: ocrResult.fullName, icon: UserCheck },
                      { label: 'Document Type', value: ocrResult.documentType, icon: FileText },
                      {
                        label: 'Personal Code',
                        value: formatOcrExtractedPiiForDisplay(
                          ocrResult.personalCode,
                          membershipRole,
                          'personalCode',
                          driverMatchResult,
                        ),
                        icon: Shield,
                        mono: true,
                        protectedField: !shouldDisplayOcrExtractedPiiField(
                          membershipRole,
                          'personalCode',
                          driverMatchResult,
                        ),
                      },
                      {
                        label: 'License Number',
                        value: formatOcrExtractedPiiForDisplay(
                          ocrResult.licenseNumber,
                          membershipRole,
                          'licenseNumber',
                          driverMatchResult,
                        ),
                        icon: ScanLine,
                        mono: true,
                        protectedField: !shouldDisplayOcrExtractedPiiField(
                          membershipRole,
                          'licenseNumber',
                          driverMatchResult,
                        ),
                      },
                      { label: 'Expiry Date', value: ocrResult.expiryDate, icon: CheckCircle },
                    ].map(({ label, value, icon: Icon, mono, protectedField }) => (
                      <div
                        key={label}
                        className="group rounded-2xl border border-white/8 bg-white/3 p-4 transition-colors hover:border-emerald-500/20 hover:bg-emerald-500/5"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-emerald-400/70" />
                          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                            {label}
                          </p>
                        </div>
                        <p
                          className={`text-sm font-bold ${
                            protectedField
                              ? 'text-slate-400 italic'
                              : `text-white ${mono ? 'font-mono tracking-wide' : ''}`
                          }`}
                          aria-label={protectedField ? value : undefined}
                        >
                          {value}
                        </p>
                      </div>
                    ))}

                    <div className="flex items-center gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4 sm:col-span-2">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-lg font-black text-emerald-300">
                        {ocrResult.fullName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-bold text-white">{ocrResult.fullName}</p>
                        <p className="text-xs text-emerald-300/80">
                          Identity data extracted from uploaded document · Local OCR ·{' '}
                          {ocrConfidence === null
                            ? 'Confidence score unavailable'
                            : `OCR confidence ${formatOcrConfidencePercent(ocrConfidence)}`}
                        </p>
                        {isLowOcrConfidence(ocrConfidence) && (
                          <p className="mt-1 text-xs text-amber-300/90">
                            Low OCR confidence — please verify the extracted fields against the
                            uploaded document.
                          </p>
                        )}
                      </div>
                      <CheckCircle className="h-6 w-6 shrink-0 text-emerald-400" />
                    </div>

                    {driverMatchResult && (
                      <div className="rounded-2xl border border-white/8 bg-white/3 p-4 sm:col-span-2">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                              Local OCR ↔ Registry Comparison
                            </p>
                            <p className="mt-1 text-sm font-bold text-white">
                              {driverMatchResult.overallStatus}
                            </p>
                          </div>
                          <span className="rounded-full border border-slate-600/40 bg-slate-900/60 px-3 py-1 font-mono text-xs text-slate-200">
                            Match score {driverMatchResult.matchScore}%
                          </span>
                        </div>
                        <p className="mb-3 text-[11px] text-slate-500">
                          Local comparison against loaded registry record · Government verification
                          not performed
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {(
                            [
                              ['fullName', 'Name'],
                              ['personalCode', 'Personal Code'],
                              ['licenseNumber', 'License Number'],
                              ['expiryDate', 'Expiry Date'],
                            ] as const
                          ).map(([field, label]) => (
                            <div
                              key={field}
                              className="rounded-xl border border-white/5 bg-black/20 px-3 py-2"
                            >
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                                {label}
                              </p>
                              <p className="mt-1 text-xs text-slate-200">
                                {formatFieldMatchLabel(driverMatchResult.fields[field])}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {verificationDecision && (
                      <div className="rounded-2xl border border-white/8 bg-white/3 p-4 sm:col-span-2">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                              Local Identity Assessment
                            </p>
                            <p className="mt-1 text-sm font-bold text-white">
                              {verificationDecision.status}
                            </p>
                          </div>
                          <span className="rounded-full border border-slate-600/40 bg-slate-900/60 px-3 py-1 font-mono text-xs text-slate-200">
                            Match score {verificationDecision.score}%
                          </span>
                        </div>
                        <p className="mb-2 text-[11px] text-slate-500">
                          Local assessment only · Government verification not performed
                        </p>
                        <p className="text-xs text-slate-300">
                          {VERIFICATION_STATUS_DESCRIPTIONS[verificationDecision.status]}
                        </p>
                        <p className="mt-2 text-[11px] text-slate-500">
                          OCR confidence{' '}
                          {ocrConfidence === null
                            ? 'unavailable'
                            : formatOcrConfidencePercent(ocrConfidence)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">{verificationDecision.reason}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

                </>
              )}
            </div>
          )}

          {activeTab === 'fleet' && (
            <div className="relative mx-auto max-w-6xl space-y-8">
              {vehiclesLoading ? (
                <DataLoadingPanel label={LOADING_LABELS.fleet} />
              ) : (
                <>
              <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-slate-950/80 to-blue-950/30 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                      <Navigation className="h-3 w-3" />
                      Live Fleet Telemetry (Simulated)
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Asset Tracking Matrix
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                      Vehicle inventory from the application database. Speed, energy, and
                      clearance status are simulated client-side for demonstration — not live
                      GPS. Assigned drivers come only from vehicles.assigned_driver_id.
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="rounded-2xl border border-white/8 bg-black/30 px-4 py-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Active Units</p>
                      <p className="text-xl font-bold text-white">{fleetAssets.length}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Optimal Clearance</p>
                      <p className="text-xl font-bold text-emerald-400">{optimalCount}</p>
                    </div>
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Critical Warnings</p>
                      <p className="text-xl font-bold text-red-400">{criticalCount}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border border-white/8 bg-slate-950/50 shadow-2xl shadow-black/30 backdrop-blur-xl">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-white/8 bg-white/3">
                        {[
                          { label: 'Asset ID', icon: Navigation },
                          { label: 'Assigned Driver', icon: UserCheck },
                          { label: 'Speed', icon: Gauge },
                          { label: 'Energy / Battery', icon: Battery },
                          { label: 'Status', icon: ShieldAlert },
                        ].map(({ label, icon: Icon }) => (
                          <th
                            key={label}
                            className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <Icon className="h-3 w-3 text-slate-600" />
                              {label}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fleetAssets.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-500">
                            {EMPTY_STATES.noVehicles}
                          </td>
                        </tr>
                      ) : (
                      fleetAssets.map((asset, index) => (
                        <tr
                          key={asset.assetId}
                          className={`border-b border-white/5 transition-colors hover:bg-white/3 ${
                            index === fleetAssets.length - 1 ? 'border-b-0' : ''
                          }`}
                        >
                          <td className="px-5 py-4">
                            <span className="font-mono text-sm font-semibold tracking-wide text-blue-300">
                              {asset.assetId}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-[10px] font-bold text-slate-300">
                                {asset.driverName.charAt(0)}
                              </div>
                              <span className="text-sm font-medium text-slate-200">{asset.driverName}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span className="font-mono text-sm text-slate-300">{asset.speed}</span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex min-w-[140px] flex-col gap-1.5">
                              <span className="text-xs font-medium text-slate-300">{asset.energy}</span>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    asset.batteryPercent <= 25
                                      ? 'bg-linear-to-r from-red-500 to-orange-400'
                                      : asset.batteryPercent <= 50
                                        ? 'bg-linear-to-r from-amber-500 to-yellow-400'
                                        : 'bg-linear-to-r from-emerald-500 to-cyan-400'
                                  }`}
                                  style={{ width: `${asset.batteryPercent}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${fleetStatusStyles[asset.status].badge}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${fleetStatusStyles[asset.status].dot}`}
                              />
                              {asset.statusLabel}
                            </span>
                          </td>
                        </tr>
                      ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 bg-black/20 px-5 py-3">
                  <p className="text-[11px] text-slate-500">
                    Fleet inventory · {formatDataSourceLabel(vehicleDataSource)} · Telemetry
                    simulated (not live)
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-400/80">
                      Simulated telemetry active
                    </span>
                  </div>
                </div>
              </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'operations' && (
            <OperationsCommandCenter
              fleetAssets={fleetAssets}
              driverRecords={driverRecords}
              vehiclesLoading={vehiclesLoading}
              driversLoading={driversLoading}
              isActive={activeTab === 'operations'}
            />
          )}

          {activeTab === 'alerts' && (
            <AlertIncidentCenter
              fleetAssets={fleetAssets}
              driverRecords={driverRecords}
              vehiclesLoading={vehiclesLoading}
              driversLoading={driversLoading}
            />
          )}

          {activeTab === 'compliance' && (
            <ComplianceRiskIntelligence
              fleetAssets={fleetAssets}
              driverRecords={driverRecords}
              vehiclesLoading={vehiclesLoading}
              driversLoading={driversLoading}
            />
          )}

          {activeTab === 'copilot' && (
            <div className="relative mx-auto flex h-full max-w-4xl flex-col space-y-4">
              <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-indigo-950/30 via-slate-950/60 to-slate-950/80 p-6 shadow-2xl shadow-indigo-950/20 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-300">
                      <Terminal className="h-3 w-3" />
                      Sovereign Copilot Core
                    </div>
                    <h2 className="text-xl font-bold tracking-tight text-white">AI Fleet Command Terminal</h2>
                    <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-400">
                      {COPILOT_DISCLOSURE}
                    </p>
                  </div>
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                    AI-powered
                  </span>
                </div>
              </div>

              <div
                className="relative min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-white/8 bg-slate-950/70 shadow-inner shadow-black/40"
                aria-live="polite"
                aria-busy={copilotLoading}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1e293b08_1px,transparent_1px),linear-gradient(to_bottom,#1e293b08_1px,transparent_1px)] bg-size-[2rem_2rem]"
                />
                <div className="relative h-full max-h-[420px] overflow-y-auto p-4 font-mono text-xs">
                  {terminalHistory.map((item, idx) => (
                    <div
                      key={`${idx}-${item.slice(0, 24)}`}
                      className={`mb-2 rounded-lg p-2.5 leading-relaxed transition-all ${
                        item.startsWith('❯')
                          ? 'bg-blue-500/8 font-bold text-blue-400 ring-1 ring-blue-500/10'
                          : item.startsWith('EXCEPTION')
                            ? 'border border-red-500/25 bg-red-950/30 text-red-300'
                            : item.startsWith('AI AGENT')
                              ? 'border border-emerald-500/25 bg-emerald-500/8 text-emerald-300 shadow-sm shadow-emerald-500/15'
                              : item.startsWith('AI')
                                ? 'border border-emerald-500/15 bg-emerald-500/5 text-emerald-400/90'
                                : 'text-slate-500'
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-slate-950/50 p-4 backdrop-blur-md">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Suggested Prompts
                </p>
                <p className="mb-3 text-[11px] text-slate-500">
                  Optional examples — you can ask any natural-language question.
                </p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {COPILOT_SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={copilotLoading}
                      aria-label={`Suggested prompt: ${prompt}`}
                      onClick={() => void executeCopilotQuery(prompt)}
                      className="rounded-full border border-indigo-500/25 bg-indigo-500/8 px-3.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-all hover:border-indigo-400/40 hover:bg-indigo-500/15 hover:text-white hover:shadow-sm hover:shadow-indigo-500/10 disabled:opacity-60"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <form onSubmit={runCopilotCommand} className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-blue-400" aria-hidden="true">
                    ❯
                  </span>
                  <input
                    type="text"
                    value={copilotQuery}
                    disabled={copilotLoading}
                    aria-label="Copilot natural language prompt"
                    onChange={(e) => setCopilotQuery(e.target.value)}
                    placeholder={
                      copilotLoading
                        ? LOADING_LABELS.copilot
                        : 'Ask anything about your authorized fleet context…'
                    }
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 font-mono text-xs text-slate-200 transition-colors focus:border-blue-500/40 focus:outline-none focus:ring-1 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={copilotLoading}
                    className="flex items-center gap-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-600/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {copilotLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        {LOADING_LABELS.copilot}
                      </>
                    ) : (
                      'Send'
                    )}
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'auditor' && (
            <AuditSecurityCenter
              displayName={displayName}
              roleLabel={roleLabel}
              membershipRole={membershipRole}
              userId={userId}
            />
          )}

          {activeTab === 'analytics' && (
            <ExecutiveAnalytics
              fleetAssets={fleetAssets}
              driverRecords={driverRecords}
              vehiclesLoading={vehiclesLoading}
              driversLoading={driversLoading}
              isActive={activeTab === 'analytics'}
            />
          )}
        </div>
      </div>
    </div>
  )
}
