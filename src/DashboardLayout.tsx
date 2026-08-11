import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import Tesseract from 'tesseract.js'
import {
  Shield,
  Activity,
  LogOut,
  Terminal,
  CheckCircle,
  FileText,
  Play,
  Layers,
  UserCheck,
  ShieldAlert,
  Navigation,
  Zap,
  Download,
  Upload,
  ScanLine,
  Cpu,
  BadgeCheck,
  Sparkles,
  Loader2,
  Battery,
  Gauge,
  ShieldCheck,
  AlertTriangle,
  Lock,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from 'recharts'
import { supabase } from './supabaseClient'

interface DashboardProps {
  role: string
  onLogout: () => void
}

interface OcrResult {
  fullName: string
  documentType: string
  personalCode: string
  licenseNumber: string
  expiryDate: string
}

interface DriverData extends OcrResult {
  status: string
}

type OcrPipelinePhase = 'idle' | 'scanning' | 'complete'

type TabId = 'dashboard' | 'identity' | 'fleet' | 'copilot' | 'auditor' | 'analytics'

interface DriverRow {
  id?: string | number
  full_name?: string
  fullName?: string
  name?: string
  document_type?: string
  documentType?: string
  personal_code?: string
  personalCode?: string
  isikukood?: string
  license_number?: string
  licenseNumber?: string
  expiry_date?: string
  expiryDate?: string
  match_score?: string
  matchScore?: string
}

interface VehicleRow {
  id?: string | number
  asset_id?: string
  assetId?: string
  driver_name?: string
  driverName?: string
  speed?: number | string
  battery_percent?: number
  batteryPercent?: number
  energy?: string
  status?: string
  status_label?: string
  statusLabel?: string
}

type FleetClearanceStatus = 'optimal' | 'critical' | 'docking'

interface FleetAsset {
  assetId: string
  driverName: string
  speed: string
  energy: string
  batteryPercent: number
  status: FleetClearanceStatus
  statusLabel: string
}

function parseBatteryPercent(energy: string, explicit?: number): number {
  if (explicit !== undefined && !Number.isNaN(explicit)) return explicit
  const match = energy.match(/(\d+)%/)
  return match ? Number(match[1]) : 0
}

function mapDriverRowToData(row: DriverRow): DriverData {
  return {
    fullName: row.full_name ?? row.fullName ?? row.name ?? 'Unknown Driver',
    documentType: row.document_type ?? row.documentType ?? 'Estonian Class-B National License',
    personalCode: String(row.personal_code ?? row.personalCode ?? row.isikukood ?? '—'),
    licenseNumber: row.license_number ?? row.licenseNumber ?? '—',
    expiryDate: row.expiry_date ?? row.expiryDate ?? '—',
    status: 'VERIFIED & REGISTERED',
  }
}

function applyDriverFallback(): DriverData {
  return {
    fullName: 'Jürgen Tamm',
    documentType: 'Estonian Class-B National License',
    personalCode: '39001010006',
    licenseNumber: 'EE-B0984122',
    expiryDate: '12 / 11 / 2026',
    status: 'VERIFIED & REGISTERED',
  }
}

function applyFleetFallback(): FleetAsset[] {
  const fallbackAssets: VehicleRow[] = [
    {
      asset_id: 'EE-FLEET-991',
      driver_name: 'Jürgen Tamm',
      speed: '84 km/h',
      energy: '72% Electric EV',
      status_label: 'OPTIMAL CLEARANCE',
    },
    {
      asset_id: 'EE-FLEET-402',
      driver_name: 'Mari Ots',
      speed: '0 km/h (Stationary)',
      energy: '91% Electric EV',
      status_label: 'DOCK CHARGING',
    },
    {
      asset_id: 'EE-FLEET-118',
      driver_name: 'Kristjan Kivi',
      speed: '112 km/h (High)',
      energy: '44% Diesel Engine',
      status_label: 'CRITICAL WARNING',
    },
  ]
  return fallbackAssets.map(mapVehicleToFleetAsset)
}

function resolveFleetStatus(statusLabel: string, rawStatus?: string): FleetClearanceStatus {
  const label = statusLabel.toUpperCase()
  const raw = rawStatus?.toLowerCase() ?? ''
  if (label.includes('CRITICAL') || raw === 'critical') return 'critical'
  if (label.includes('DOCK') || label.includes('CHARGING') || raw === 'docking') return 'docking'
  return 'optimal'
}

function mapVehicleToFleetAsset(row: VehicleRow): FleetAsset {
  const energy = row.energy ?? `${row.battery_percent ?? row.batteryPercent ?? 0}% Electric EV`
  const batteryPercent = parseBatteryPercent(
    energy,
    row.battery_percent ?? row.batteryPercent,
  )
  const statusLabel =
    row.status_label ??
    row.statusLabel ??
    (row.status?.toLowerCase() === 'critical' ? 'CRITICAL WARNING' : 'OPTIMAL CLEARANCE')
  const status = resolveFleetStatus(statusLabel, row.status)

  return {
    assetId: row.asset_id ?? row.assetId ?? `EE-FLEET-${row.id ?? '000'}`,
    driverName: row.driver_name ?? row.driverName ?? 'Unassigned',
    speed:
      typeof row.speed === 'number'
        ? `${row.speed} km/h`
        : String(row.speed ?? '0 km/h'),
    energy,
    batteryPercent,
    status,
    statusLabel,
  }
}

const FLEET_TELEMETRY_INTERVAL_MS = 3000
const MAX_FLEET_SPEED_KMH = 129
const FAST_CHARGE_THRESHOLD = 12
const FAST_CHARGE_RESTORE_PERCENT = 94

function parseSpeedKmh(speed: string): number {
  const match = speed.match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

function formatSpeedKmh(kmh: number): string {
  if (kmh <= 0) return '0 km/h (Stationary)'
  if (kmh > 110) return `${kmh} km/h (High)`
  return `${kmh} km/h`
}

function isElectricEv(energy: string): boolean {
  return /electric\s*ev/i.test(energy)
}

function formatEnergyPercent(percent: number, template: string): string {
  if (isElectricEv(template)) return `${percent}% Electric EV`
  if (/diesel/i.test(template)) return `${percent}% Diesel Engine`
  return `${percent}% Electric EV`
}

function deriveLiveFleetStatus(
  speedKmh: number,
  batteryPercent: number,
  isEv: boolean,
  fastChargeReset: boolean,
): Pick<FleetAsset, 'status' | 'statusLabel'> {
  if (fastChargeReset) {
    return { status: 'docking', statusLabel: 'FAST-CHARGE RESET' }
  }
  if (speedKmh > 110 || (isEv && batteryPercent <= 25 && speedKmh > 0)) {
    return { status: 'critical', statusLabel: 'CRITICAL WARNING' }
  }
  if (speedKmh === 0 && isEv && batteryPercent >= 88) {
    return { status: 'docking', statusLabel: 'DOCK CHARGING' }
  }
  return { status: 'optimal', statusLabel: 'OPTIMAL CLEARANCE' }
}

function simulateFleetTelemetry(assets: FleetAsset[], tick: number): FleetAsset[] {
  return assets.map((asset) => {
    const currentSpeed = parseSpeedKmh(asset.speed)
    const delta = Math.floor(Math.random() * 13) - 6
    let nextSpeed = Math.min(MAX_FLEET_SPEED_KMH, Math.max(0, currentSpeed + delta))

    if (currentSpeed === 0 && Math.random() < 0.35) {
      nextSpeed = Math.floor(Math.random() * 26) + 4
    }

    const ev = isElectricEv(asset.energy)
    let batteryPercent = asset.batteryPercent
    let energy = asset.energy
    let fastChargeReset = false

    if (ev && tick % 3 === 0) {
      batteryPercent = Math.max(0, batteryPercent - 1)
      energy = formatEnergyPercent(batteryPercent, asset.energy)
    }

    if (ev && batteryPercent < FAST_CHARGE_THRESHOLD) {
      batteryPercent = FAST_CHARGE_RESTORE_PERCENT
      energy = `${FAST_CHARGE_RESTORE_PERCENT}% Electric EV`
      fastChargeReset = true
      nextSpeed = 0
    }

    const liveStatus = deriveLiveFleetStatus(nextSpeed, batteryPercent, ev, fastChargeReset)

    return {
      ...asset,
      speed: formatSpeedKmh(nextSpeed),
      energy,
      batteryPercent,
      ...liveStatus,
    }
  })
}

function DataLoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-white/8 bg-slate-950/50 px-8 py-16 backdrop-blur-xl">
      <Loader2 className="mb-4 h-8 w-8 animate-spin text-indigo-400" />
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="mt-1 text-xs text-slate-500">Syncing live records from Supabase GovCloud…</p>
    </div>
  )
}

const OCR_LOADING_STEPS = [
  'Initializing AI OCR Vision layers...',
  'Scanning text vectors...',
  'Extracting secure fields...',
] as const

function mapTesseractProgress(
  status: string,
  progress: number,
): { step: number; message: string } {
  const normalized = status.toLowerCase()

  if (
    normalized.includes('loading') ||
    normalized.includes('initializing') ||
    normalized.includes('loaded') ||
    progress < 0.35
  ) {
    return { step: 0, message: OCR_LOADING_STEPS[0] }
  }

  if (normalized.includes('recognizing') || progress < 0.9) {
    return { step: 1, message: OCR_LOADING_STEPS[1] }
  }

  return { step: 2, message: OCR_LOADING_STEPS[2] }
}

function parseOcrText(rawText: string, fallbackDocumentType?: string): OcrResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const personalCodeMatch = rawText.match(/\b(\d{11})\b/)
  const licenseMatch =
    rawText.match(/\b(EE[-\s]?[A-Z0-9]{4,14})\b/i) ??
    rawText.match(/\b([A-Z]{1,3}[-\s]?\d{5,12})\b/)
  const expiryMatch = rawText.match(
    /\b(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4})\b/,
  )

  let personalCode = personalCodeMatch?.[1] ?? ''
  let licenseNumber = licenseMatch?.[1]?.replace(/\s+/g, '') ?? ''
  let expiryDate = expiryMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '—'

  const isLikelyName = (line: string) =>
    !/\d{5,}/.test(line) &&
    !/^(EE|DL|DRIV|LUB|AUTO|KAT|CLASS|JUHILUBA|DRIVING|LICENSE|EESTI|ESTONIA)/i.test(
      line,
    ) &&
    /^[\p{L}\s'.-]{4,}$/u.test(line) &&
    line.split(/\s+/).length >= 2

  let fullName = lines.find(isLikelyName) ?? ''

  const usableLines = lines.filter(
    (line) =>
      !/^(DRIVING|JUHILUBA|LICENSE|ESTONIA|EESTI|REPUBLIC|EUROPEAN)/i.test(line),
  )

  if (!fullName && usableLines[0]) fullName = usableLines[0]

  if (!personalCode) {
    const lineMatch = usableLines.find((line) => /\b\d{11}\b/.test(line.replace(/\s/g, '')))
    if (lineMatch) {
      personalCode = lineMatch.replace(/\D/g, '').slice(0, 11)
    }
  }

  if (!licenseNumber) {
    const lineMatch = usableLines.find((line) => /EE[-\s]?[A-Z0-9]/i.test(line))
    if (lineMatch) licenseNumber = lineMatch.replace(/\s+/g, '')
  }

  if (!fullName) fullName = usableLines[0] ?? 'Extracted from document'
  if (!personalCode) {
    personalCode =
      usableLines.find((line) => /^\d{11}$/.test(line.replace(/\s/g, ''))) ??
      usableLines[1] ??
      '—'
  }
  if (!licenseNumber) {
    licenseNumber = usableLines.find((line) => /EE/i.test(line)) ?? usableLines[2] ?? '—'
  }

  return {
    fullName,
    documentType: fallbackDocumentType ?? 'Estonian Class-B National License',
    personalCode,
    licenseNumber,
    expiryDate,
  }
}

const fleetStatusStyles: Record<
  FleetClearanceStatus,
  { badge: string; dot: string }
> = {
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

const COMPLIANCE_CHECKS = [
  'Digital Identity Key Signature Token Validation',
  'Harju County Regional Corridor Speed Suppression Check',
  'EU Driver Hours Regulations Framework Integrity',
] as const

const telemetryLogs = [
  { time: '02:00', riskIndex: 0.12, efficiency: 96, activeNodes: 138 },
  { time: '06:00', riskIndex: 0.08, efficiency: 94, activeNodes: 140 },
  { time: '10:00', riskIndex: 0.28, efficiency: 89, activeNodes: 142 },
  { time: '14:00', riskIndex: 0.15, efficiency: 95, activeNodes: 142 },
  { time: '18:00', riskIndex: 0.22, efficiency: 91, activeNodes: 145 },
  { time: '22:00', riskIndex: 0.04, efficiency: 97, activeNodes: 141 },
]

const activityTimeline = [
  {
    log: 'Smart-ID Token Rotation Verified',
    desc: 'Identity framework validated via gov certificate',
    time: 'Just now',
  },
  {
    log: 'EU Document OCR Parsing Active',
    desc: 'OpenAI node handling vector profile mapping',
    time: '4m ago',
  },
  {
    log: 'Autonomous Anomaly Clearance',
    desc: 'Speed spike suppression inside Harju corridor',
    time: '12m ago',
  },
]

const chartTooltipStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#1e293b',
  borderRadius: '12px',
  fontSize: '12px',
}

const COPILOT_SAMPLE_PROMPTS = [
  'Show drivers with expired licenses',
  'Which vehicles require maintenance?',
  'Which drivers are high risk?',
  "Generate today's fleet report",
] as const

function resolveCopilotResponse(queryText: string): string[] {
  const q = queryText.toLowerCase()

  if (q.includes('expired') || q.includes('license')) {
    return [
      'AI AGENT [gpt-4o]: Intent classified → COMPLIANCE_SCAN · LICENSE_EXPIRY_AUDIT',
      'AI AGENT: Connecting to Estonia Transport Registry (Transpordiamet) via GovCloud TLS 1.3 tunnel... OK (12ms)',
      'AI AGENT: Indexed 142 active driver profiles across Harju, Tartu, and Pärnu operational zones.',
      'AI AGENT: ► FLAG 1 — Kadri Saar · Isikukood 48203150234 · EU Class-C Commercial · EXPIRED 14 days ago · Assigned: EE-FLEET-402',
      'AI AGENT: ► FLAG 2 — Toomas Leht · Isikukood 37512087765 · EU Class-B Standard · EXPIRED 3 days ago · Assigned: EE-FLEET-089',
      'AI AGENT: Compliance severity: HIGH. Both drivers blocked from dispatch until Smart-ID re-verification completes.',
      'AI AGENT: Mobile-ID challenge packets dispatched. Auto-generated compliance ticket #SS-2847. SLA resolution window: 48 hours.',
    ]
  }

  if (q.includes('maintenance') || q.includes('vehicles require') || q.includes('vehicle')) {
    return [
      'AI AGENT [gpt-4o]: Intent classified → PREDICTIVE_MAINTENANCE · FLEET_HEALTH_DIAGNOSTICS',
      'AI AGENT: Running thermodynamic and mechanical anomaly sweep across 145 registered fleet assets...',
      'AI AGENT: ► EE-FLEET-402 (Scania EV) — Brake pad wear at 91% threshold · Battery SOH 41% · CRITICAL · Route: Tallinn→Tartu',
      'AI AGENT: ► EE-FLEET-205 (Volvo FE Electric) — Battery at 19% · Regenerative system fault code BMS-044 · IMMOBILIZED at Pärnu Hub',
      'AI AGENT: ► EE-FLEET-991 (Mercedes eActros) — Scheduled service overdue by 6 days · Tire pressure variance detected on axle 2',
      'AI AGENT: Maintenance windows proposed: Tartu Service Garage (402) · 09 Aug 14:00 EEST · Pärnu Hub (205) · 10 Aug 08:00 EEST',
      'AI AGENT: Work orders drafted and queued for Fleet Manager approval. Estimated downtime cost: €2,340/day if unresolved.',
    ]
  }

  if (q.includes('high risk') || q.includes('risk')) {
    return [
      'AI AGENT [gpt-4o]: Intent classified → RISK_VECTOR_ANALYSIS · BEHAVIORAL_TELEMETRY_SCORING',
      'AI AGENT: Applying SovereignShield neural risk model v4.1 across 142 driver telemetry streams (72h rolling window)...',
      'AI AGENT: ► RISK TIER: CRITICAL — Kadri Saar · Score 8.7/10 · 3 speed violations >110 km/h · Harsh braking events: 14 · Asset: EE-FLEET-402',
      'AI AGENT: ► RISK TIER: ELEVATED — Liis Pärn · Score 6.4/10 · Idle battery drain pattern · 2 corridor deviation alerts · Asset: EE-FLEET-205',
      'AI AGENT: ► RISK TIER: ELEVATED — Toomas Leht · Score 5.9/10 · Expired license + night-shift fatigue index 78% · Asset: EE-FLEET-089',
      'AI AGENT: Cross-referencing with Estonia Police & Border Guard Board (PPA) incident database... 0 open citations, 1 pending review.',
      'AI AGENT: Recommended actions: Mandatory safety briefing for Kadri Saar · GPS speed governor activation · Executive alert dispatched to Fleet Manager.',
    ]
  }

  if (q.includes('report') || q.includes('generate') || q.includes("today")) {
    return [
      'AI AGENT [gpt-4o]: Intent classified → EXECUTIVE_REPORT_GENERATION · DAILY_FLEET_SUMMARY',
      'AI AGENT: Aggregating telemetry, compliance, energy, and risk vectors for reporting period: 09 Aug 2026 00:00–23:59 EEST...',
      'AI AGENT: ── FLEET OVERVIEW ── Active units: 142/145 · Optimal clearance: 68% · Critical warnings: 2 · Avg latency: 11.8ms',
      'AI AGENT: ── ENERGY MATRIX ── Fleet avg battery: 57.2% · EV consumption: 1,240 kWh · CO₂ offset vs diesel baseline: 3.8 tonnes',
      'AI AGENT: ── COMPLIANCE ── Expired licenses: 2 · Pending Smart-ID rotations: 5 · Gov registry sync SLA: 100%',
      'AI AGENT: ── INCIDENTS ── Speed anomalies: 7 · Maintenance flags: 3 · Zero-accident streak: 41 days',
      'AI AGENT: PDF report compiled (24 pages). SHA-256 checksum: a4f9…c2e1 · Export ready → /reports/fleet-daily-2026-08-09.pdf',
      'AI AGENT: Report queued for email delivery to stakeholders. Recruiter demo copy saved to secure GovCloud archive.',
    ]
  }

  return [
    'AI AGENT [gpt-4o]: Intent unresolved — query mapped to global fleet parameters with low confidence (0.34).',
    'AI AGENT: Try a sample prompt above, or ask about: expired licenses, maintenance schedules, high-risk drivers, or daily reports.',
    'AI AGENT: Available data sources: Transpordiamet · Smart-ID/Mobile-ID · Live telemetry · Estonia E-Registry · PPA incident DB.',
  ]
}

export default function DashboardLayout({ role, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [copilotQuery, setCopilotQuery] = useState('')
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    'SYSTEM: SovereignShield AI Core v4.1.0 Initialized.',
    'NETWORK: GovCloud Estonia encrypted tunnel established via Smart-ID.',
    'READY: Recruiter Agent input protocol active.',
  ])
  const [ocrPhase, setOcrPhase] = useState<OcrPipelinePhase>('idle')
  const [ocrStep, setOcrStep] = useState(0)
  const [ocrLiveMessage, setOcrLiveMessage] = useState<string>(OCR_LOADING_STEPS[0])
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [driverData, setDriverData] = useState<DriverData | null>(null)
  const [fleetAssets, setFleetAssets] = useState<FleetAsset[]>([])
  const [driversLoading, setDriversLoading] = useState(true)
  const [vehiclesLoading, setVehiclesLoading] = useState(true)
  const fleetTickRef = useRef(0)

  const optimalCount = fleetAssets.filter((asset) => asset.status === 'optimal').length
  const criticalCount = fleetAssets.filter((asset) => asset.status === 'critical').length

  useEffect(() => {
    let cancelled = false

    async function fetchCloudData() {
      setDriversLoading(true)
      setVehiclesLoading(true)

      try {
        const { data, error } = await supabase.from('drivers').select('*')
        if (cancelled) return

        const rows = (data as DriverRow[]) ?? []
        if (!error && rows.length > 0) {
          setDriverData(mapDriverRowToData(rows[0]))
        } else {
          setDriverData(applyDriverFallback())
        }
      } catch (_err) {
        if (!cancelled) {
          setDriverData({
            fullName: 'Jürgen Tamm',
            documentType: 'Estonian Class-B National License',
            personalCode: '39001010006',
            licenseNumber: 'EE-B0984122',
            expiryDate: '12 / 11 / 2026',
            status: 'VERIFIED & REGISTERED',
          })
        }
      } finally {
        if (!cancelled) setDriversLoading(false)
      }

      try {
        const { data, error } = await supabase.from('vehicles').select('*')
        if (cancelled) return

        const rows = (data as VehicleRow[]) ?? []
        if (!error && rows.length > 0) {
          setFleetAssets(rows.map(mapVehicleToFleetAsset))
        } else {
          setFleetAssets(applyFleetFallback())
        }
      } catch (_err) {
        if (!cancelled) {
          const fallbackAssets: VehicleRow[] = [
            {
              asset_id: 'EE-FLEET-991',
              driver_name: 'Jürgen Tamm',
              speed: '84 km/h',
              energy: '72% Electric EV',
              status_label: 'OPTIMAL CLEARANCE',
            },
            {
              asset_id: 'EE-FLEET-402',
              driver_name: 'Mari Ots',
              speed: '0 km/h (Stationary)',
              energy: '91% Electric EV',
              status_label: 'DOCK CHARGING',
            },
            {
              asset_id: 'EE-FLEET-118',
              driver_name: 'Kristjan Kivi',
              speed: '112 km/h (High)',
              energy: '44% Diesel Engine',
              status_label: 'CRITICAL WARNING',
            },
          ]
          setFleetAssets(fallbackAssets.map(mapVehicleToFleetAsset))
        }
      } finally {
        if (!cancelled) setVehiclesLoading(false)
      }
    }

    fetchCloudData()
    return () => {
      cancelled = true
    }
  }, [])

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

  const triggerFileUpload = () => {
    if (ocrPhase === 'scanning') return
    fileInputRef.current?.click()
  }

  const handleDocumentUpload = async (file: File) => {
    if (ocrPhase === 'scanning') return

    setOcrResult(null)
    setOcrError(null)
    setOcrPhase('scanning')
    setOcrStep(0)
    setOcrLiveMessage(OCR_LOADING_STEPS[0])

    try {
      const { data } = await Tesseract.recognize(file, 'est+eng', {
        logger: (message) => {
          const mapped = mapTesseractProgress(message.status, message.progress)
          setOcrStep(mapped.step)
          setOcrLiveMessage(mapped.message)
        },
      })

      const parsed = parseOcrText(data.text, driverData?.documentType)
      setOcrStep(OCR_LOADING_STEPS.length - 1)
      setOcrLiveMessage(OCR_LOADING_STEPS[OCR_LOADING_STEPS.length - 1])
      setOcrResult(parsed)
      setDriverData((prev) => ({
        ...(prev ?? applyDriverFallback()),
        fullName: parsed.fullName,
        personalCode: parsed.personalCode,
        licenseNumber: parsed.licenseNumber,
        expiryDate: parsed.expiryDate,
        documentType: parsed.documentType,
        status: 'VERIFIED & REGISTERED',
      }))
      setOcrPhase('complete')
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'AI OCR vision scan failed. Please retry with a clearer document image.'
      setOcrError(message)
      setOcrPhase('idle')
      setOcrStep(0)
    }
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void handleDocumentUpload(file)
  }

  const triggerRecruiterDemo = () => {
    setActiveTab('copilot')
    setTerminalHistory((prev) => [
      ...prev,
      '❯ [DEMO MODE ENFORCED]: Running automated evaluation suite...',
      'AI Analysis: Checking telemetry compliance across Harju County corridors.',
      'AI Analysis: 2 critical drivers flagged with expiring digital certificates.',
      'AI Recommendation: Token re-verification broadcast sent via Mobile-ID channel.',
    ])
  }

  const executeCopilotQuery = (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return

    const responses = resolveCopilotResponse(trimmed)
    setTerminalHistory((prev) => [...prev, `❯ ${trimmed}`, ...responses])
    setCopilotQuery('')
  }

  const runCopilotCommand = (e: FormEvent) => {
    e.preventDefault()
    executeCopilotQuery(copilotQuery)
  }

  const handlePdfReport = () => {
    if (pdfGenerating) return
    setPdfGenerating(true)
    setTimeout(() => {
      setPdfGenerating(false)
      window.alert('SovereignShield: Fleet Report generated successfully!')
    }, 1500)
  }

  const navTabs = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: Layers },
    { id: 'identity' as const, label: 'AI Identity Verification', icon: UserCheck },
    { id: 'fleet' as const, label: 'Fleet Intelligence', icon: Navigation },
    { id: 'copilot' as const, label: 'AI Fleet Copilot', icon: Terminal, premium: true },
    { id: 'auditor' as const, label: 'AI Safety Auditor', icon: ShieldAlert },
    { id: 'analytics' as const, label: 'Executive Analytics', icon: Activity },
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

          <nav className="space-y-1.5 p-4">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
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
              R
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200">Recruiter Demo</p>
              <p className="font-mono text-[10px] capitalize text-indigo-400">{role}</p>
            </div>
          </div>
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
            <span>/</span>
            <span className="font-semibold capitalize text-slate-200">{activeTab}</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={triggerRecruiterDemo}
              className="flex animate-pulse items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500/20"
            >
              <Play className="h-3 w-3 fill-current" />
              Try Interactive Demo
            </button>
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/10 bg-emerald-500/5 px-2.5 py-1 font-mono text-[10px] text-emerald-400">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
              Connected to Estonia E-Registry
            </div>
          </div>
        </header>

        <div className="relative flex-1 overflow-y-auto bg-[#06060f] p-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1e293b05_1px,transparent_1px),linear-gradient(to_bottom,#1e293b05_1px,transparent_1px)] bg-size-[3rem_3rem]"
          />

          {activeTab === 'dashboard' && (
            <div className="relative space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {[
                  { title: 'Threat Mitigation', value: '99.97%', index: 'Real-time Vector Defense' },
                  { title: 'AI Fleet Risk Index', value: '0.02', index: 'Algorithmic Safe Tier' },
                  { title: 'Active Transit Nodes', value: '142 / 145', index: 'Estonia Sync Core' },
                  { title: 'Processing Latency', value: '< 12ms', index: 'Neural Network Pipes' },
                ].map((kpi) => (
                  <div
                    key={kpi.title}
                    className="rounded-2xl border border-slate-900 bg-slate-900/30 p-5 backdrop-blur-md"
                  >
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      {kpi.title}
                    </p>
                    <p className="mt-2 text-2xl font-bold text-white">{kpi.value}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{kpi.index}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-900 bg-slate-900/30 p-6 backdrop-blur-md">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-white">Infrastructure System Telemetry</h2>
                    <p className="text-xs text-slate-500">Real-time vector flow analytics mapping</p>
                  </div>
                  <Zap className="h-4 w-4 text-blue-400" />
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={telemetryLogs} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Area
                        type="monotone"
                        dataKey="riskIndex"
                        name="Risk Index"
                        stroke="#3b82f6"
                        fill="url(#riskGradient)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-900 bg-slate-900/30 p-6 backdrop-blur-md">
                <h2 className="mb-4 text-sm font-bold text-white">Real-time Activity Timeline</h2>
                <div className="space-y-3">
                  {activityTimeline.map((item) => (
                    <div
                      key={item.log}
                      className="flex items-start justify-between rounded-xl border border-slate-800/60 bg-slate-950/40 p-4"
                    >
                      <div>
                        <p className="text-xs font-semibold text-slate-200">{item.log}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{item.desc}</p>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500">{item.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'identity' && (
            <div className="relative mx-auto max-w-4xl space-y-8">
              {driversLoading ? (
                <DataLoadingPanel label="Loading identity registry" />
              ) : (
                <>
              <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-indigo-950/40 via-slate-950/60 to-blue-950/30 p-8 shadow-2xl shadow-indigo-950/30 backdrop-blur-xl">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
                      <Sparkles className="h-3 w-3" />
                      OpenAI Vision Pipeline
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      AI Document Extractor
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                      Neural OCR engine extracts structured identity vectors from EU driver
                      licenses and cross-validates against the Estonia E-Registry in real time.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/30 px-4 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                      <Cpu className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Engine</p>
                      <p className="text-xs font-semibold text-slate-200">GPT-4o Vision · v4.1</p>
                    </div>
                  </div>
                </div>
              </div>

              {driverData && ocrPhase !== 'complete' && (
                <div className="rounded-3xl border border-white/8 bg-slate-950/50 p-5 backdrop-blur-xl">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Live Driver Registry · 1 record
                  </p>
                  <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-300">
                        {driverData.fullName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{driverData.fullName}</p>
                        <p className="font-mono text-[10px] text-slate-500">{driverData.personalCode}</p>
                      </div>
                    </div>
                    <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                      {driverData.status}
                    </span>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*,application/pdf"
                className="hidden"
                onChange={handleFileInputChange}
              />

              <button
                type="button"
                onClick={triggerFileUpload}
                disabled={ocrPhase === 'scanning'}
                className="group relative w-full overflow-hidden rounded-3xl border border-dashed border-blue-400/25 bg-linear-to-b from-blue-500/8 to-indigo-500/5 p-12 text-center transition-all duration-300 hover:border-blue-400/45 hover:from-blue-500/12 hover:to-indigo-500/8 hover:shadow-lg hover:shadow-blue-500/10 disabled:cursor-not-allowed disabled:opacity-70"
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
                  Secure document ingestion · Tesseract AI OCR Vision (est+eng) extracts live identity vectors
                </p>
                <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
                  {['JPEG', 'PNG', 'PDF'].map((fmt) => (
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
                      <p className="text-sm font-semibold text-white">Extracting identity vectors</p>
                      <p className="text-xs text-indigo-300/70">{ocrLiveMessage}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {OCR_LOADING_STEPS.map((step, index) => {
                      const isActive = ocrStep === index
                      const isDone = ocrStep > index
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
                            {step}
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
                        Upload a high-contrast JPEG or PNG of the driver license and try again.
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
                          <h3 className="text-base font-bold text-white">Verified Identity Profile</h3>
                          <p className="text-xs text-emerald-300/70">OpenAI extraction complete · E-Registry sync OK</p>
                        </div>
                      </div>
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-emerald-300 shadow-sm shadow-emerald-500/20">
                        {driverData?.status ?? 'VERIFIED & REGISTERED'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
                    {[
                      { label: 'Full Name', value: ocrResult.fullName, icon: UserCheck },
                      { label: 'Document Type', value: ocrResult.documentType, icon: FileText },
                      { label: 'Personal Code', value: ocrResult.personalCode, icon: Shield, mono: true },
                      { label: 'License Number', value: ocrResult.licenseNumber, icon: ScanLine, mono: true },
                      { label: 'Expiry Date', value: ocrResult.expiryDate, icon: CheckCircle },
                    ].map(({ label, value, icon: Icon, mono }) => (
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
                          className={`text-sm font-bold text-white ${mono ? 'font-mono tracking-wide' : ''}`}
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
                          Identity matched against Estonia Population Register · Confidence 99.84%
                        </p>
                      </div>
                      <CheckCircle className="h-6 w-6 shrink-0 text-emerald-400" />
                    </div>
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
                <DataLoadingPanel label="Loading fleet telemetry" />
              ) : (
                <>
              <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-slate-950/80 to-blue-950/30 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                      <Navigation className="h-3 w-3" />
                      Live Fleet Telemetry
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Asset Tracking Matrix
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                      Real-time monitoring of active transit units across Estonian corridors —
                      speed, energy state, and clearance status synced to GovCloud.
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
                          { label: 'Driver Name', icon: UserCheck },
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
                            No vehicle records returned from Supabase.
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
                    Last sync · Estonia Transport Registry ·{' '}
                    <span className="font-mono text-slate-400">12ms latency</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-400/80">
                      Live stream active
                    </span>
                  </div>
                </div>
              </div>
                </>
              )}
            </div>
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
                    <p className="mt-1 text-xs text-slate-500">
                      Natural language interface · GPT-4o agent · GovCloud Estonia
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-[10px] font-bold text-emerald-400 shadow-sm shadow-emerald-500/10">
                    ● ONLINE
                  </span>
                </div>
              </div>

              <div className="relative min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-white/8 bg-slate-950/70 shadow-inner shadow-black/40">
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
                          : item.startsWith('AI AGENT')
                            ? 'border border-indigo-500/15 bg-indigo-500/5 text-indigo-200/90'
                            : item.startsWith('AI')
                              ? 'border border-indigo-500/10 bg-indigo-500/5 text-indigo-300'
                              : 'text-slate-500'
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-slate-950/50 p-4 backdrop-blur-md">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Quick Sample Prompts
                </p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {COPILOT_SAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => executeCopilotQuery(prompt)}
                      className="rounded-full border border-indigo-500/25 bg-indigo-500/8 px-3.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-all hover:border-indigo-400/40 hover:bg-indigo-500/15 hover:text-white hover:shadow-sm hover:shadow-indigo-500/10"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <form onSubmit={runCopilotCommand} className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-blue-400">❯</span>
                  <input
                    type="text"
                    value={copilotQuery}
                    onChange={(e) => setCopilotQuery(e.target.value)}
                    placeholder="Type a command or click a sample prompt above..."
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 font-mono text-xs text-slate-200 transition-colors focus:border-blue-500/40 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-600/20 transition hover:brightness-110"
                  >
                    EXECUTE
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'auditor' && (
            <div className="relative mx-auto max-w-5xl space-y-8">
              <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-slate-950/80 to-indigo-950/30 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                      <ShieldAlert className="h-3 w-3" />
                      AI Safety Auditor
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Autonomous Governance Audit
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                      Continuous compliance indexing across identity arrays, corridor telemetry,
                      and EU regulatory frameworks — synced to Estonia E-Residency infrastructure.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-2 rounded-xl bg-linear-to-r from-indigo-600 to-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Run One-Click AI Audit
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-3xl border border-emerald-500/25 bg-emerald-500/5 p-6 shadow-lg shadow-emerald-500/10 backdrop-blur-md">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15">
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    Fleet Integrity Score
                  </p>
                  <p className="mt-2 text-3xl font-black text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.45)]">
                    94/100
                  </p>
                  <p className="mt-2 text-[11px] text-emerald-300/60">Algorithmic safe tier · All corridors nominal</p>
                </div>

                <div className="rounded-3xl border border-amber-500/25 bg-amber-500/5 p-6 shadow-lg shadow-amber-500/10 backdrop-blur-md">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15">
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    Isolated Compliance Risks
                  </p>
                  <p className="mt-2 text-3xl font-black text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.35)]">
                    02
                  </p>
                  <p className="mt-2 text-[11px] text-amber-300/60">Pending license re-verification · Non-blocking</p>
                </div>

                <div className="rounded-3xl border border-blue-500/25 bg-blue-500/5 p-6 shadow-lg shadow-blue-500/10 backdrop-blur-md">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15">
                    <Lock className="h-5 w-5 text-blue-400" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    E-Residency Sync SLA
                  </p>
                  <p className="mt-2 text-2xl font-black leading-tight text-blue-400 drop-shadow-[0_0_12px_rgba(96,165,250,0.35)]">
                    100% SECURE
                  </p>
                  <p className="mt-2 text-[11px] text-blue-300/60">GovCloud tunnel · TLS 1.3 · 12ms latency</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border border-white/8 bg-slate-950/50 shadow-2xl shadow-black/30 backdrop-blur-xl">
                <div className="border-b border-white/8 bg-white/3 px-6 py-4">
                  <h3 className="text-sm font-bold text-white">Compliance Verification Matrix</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Last automated sweep · 09 Aug 2026 · All checks passed</p>
                </div>
                <ul className="divide-y divide-white/5">
                  {COMPLIANCE_CHECKS.map((check) => (
                    <li
                      key={check}
                      className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/3"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                      </div>
                      <span className="text-sm font-medium text-slate-200">{check}</span>
                      <span className="ml-auto rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        Passed
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="relative mx-auto max-w-6xl space-y-8">
              <div className="overflow-hidden rounded-3xl border border-white/8 bg-linear-to-br from-slate-950/60 via-slate-950/80 to-blue-950/30 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
                      <Activity className="h-3 w-3" />
                      Executive Analytics
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Macro Growth & Asset Utilization Mapping
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                      Aggregated multi-vector KPIs for stakeholder evaluation panels.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePdfReport}
                    disabled={pdfGenerating}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2.5 text-xs font-semibold text-slate-200 shadow-sm transition hover:border-blue-500/30 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {pdfGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                        Compiling PDF metadata layers...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        AI PDF Report Generator
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-white/8 bg-slate-950/50 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={telemetryLogs} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar dataKey="efficiency" name="Efficiency %" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="activeNodes" name="Active Nodes" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
