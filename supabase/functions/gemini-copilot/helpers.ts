/** Pinned stable model — never a floating `-latest` alias, so Copilot output cannot shift underneath the demo. */
export const GEMINI_MODEL = 'gemini-3.6-flash'

export const GEMINI_GENERATE_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

/** Google Generative Language API key header (never put the key in the URL). */
export const GEMINI_API_KEY_HEADER = 'x-goog-api-key'

/** Dev origin always allowed. Production origins come from COPILOT_ALLOWED_ORIGINS. */
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173'] as const

/**
 * V1 in-memory quota for a flagship demo/pilot.
 * Keyed only by verified auth user id (never body user/role/org).
 * Resets on isolate cold start — persistent counters would require a migration (not invented here).
 */
export const COPILOT_RATE_LIMIT_MAX = 20
export const COPILOT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

export type CopilotContext = {
  /** Per-vehicle mappings: "EE-FLEET-991 -> Jürgen Tamm" (includes Unassigned). */
  assignments?: string[]
  /** Non-PII expiry rows: "Driver Name -> expiryDate" or "Driver Name -> expired". */
  licenseExpiry?: string[]
  /** Simulated vehicle clearance: "EE-FLEET-118 -> CRITICAL WARNING". */
  simulatedClearance?: string[]
  /**
   * Fleet speed/battery/status are demo-only when 'simulated'.
   * Copilot must not claim live/real-time monitoring in that mode.
   */
  telemetryMode?: 'simulated'
  /** Monotonic snapshot identifier — diagnostic metadata, authoritative for this request. */
  snapshotVersion?: number
  /** ISO-8601 capture timestamp — diagnostic metadata only. */
  snapshotCapturedAt?: string
  /** Deterministic fleet health counters for Operations Command Center. */
  fleetHealthSummary?: string[]
  /** Deterministic priority rows — authoritative for ops summaries. */
  operationalPriorities?: string[]
  /** Suggested actions derived from the priority engine (not DB tickets). */
  recommendedActions?: string[]
  /** Selected-alert explain subject — identity only, after server match. */
  selectedAlertSubject?: string
  /** True when validated browser demo telemetry was merged for clearance labels. */
  clientDemoTelemetryApplied?: boolean
  /** Client diagnostic snapshot version — correlation only, not authoritative. */
  clientSnapshotVersion?: number
  /** Client diagnostic capture timestamp — correlation only, not authoritative. */
  clientSnapshotCapturedAt?: string
}

/** Optional browser-reported demo telemetry — only non-authoritative simulated clearance. */
export type ClientDemoTelemetry = {
  simulatedClearance?: string[]
  snapshotVersion?: number
  snapshotCapturedAt?: string
}

export type SelectedAlertRef = {
  id: string
  category: 'vehicle' | 'compliance'
  subjectName: string
  title: string
}

export type ParsedCopilotRequest = {
  prompt: string
  clientDemoTelemetry?: ClientDemoTelemetry
  selectedAlert?: SelectedAlertRef
}

export type ParseResult =
  | { ok: true; value: ParsedCopilotRequest }
  | { ok: false; status: number; message: string }

const BASE_SYSTEM_INSTRUCTION =
  "You are SovereignShield AI, a helpful and friendly virtual assistant. Speak naturally and politely in simple, clean human language (like ChatGPT). Do NOT include code blocks, backticks (```), brackets, or raw technical terminal symbols. Just answer the user's questions directly, friendly, and clearly in under 3 sentences."

/**
 * Injected when telemetryMode is simulated (or fleet vehicles are present under current demo architecture).
 * Keeps fleet summaries honest: inventory + assignments real; speed/battery/status simulated.
 */
export const FLEET_TELEMETRY_HONESTY_RULES =
  'Fleet data rules: Vehicle asset IDs are application-database inventory. Driver assignments come only from assigned_driver_id; if no assigned drivers are listed in context, no vehicles currently have an assigned driver. Speed, battery/energy, and clearance status are simulated demo telemetry — not live GPS, not real-time monitoring, and not live connected tracking. Do not claim real-time monitoring, live GPS, live connected status, or actual live tracking. Do not invent operational facts that are not present in the supplied context. When telemetry is discussed, describe it as simulated.'

export const COPILOT_QUICK_PROMPT_RULES =
  'No driver risk scores exist in this demo. If asked who is high risk, state that driver risk scores are not available. Never invent risk scores. Never treat simulated vehicle clearance as a driver risk ranking. For expired licenses, use only licenseExpiry context. For maintenance, simulatedClearance may be used only as simulated demo telemetry and must be labeled simulated; a CRITICAL WARNING may be described as requiring attention but never invent a real maintenance ticket or work order. For fleet reports, summarize total vehicles, assigned/unassigned state, simulated clearance/status, and license expiry from context only. Never claim all vehicles are optimal if any vehicle has CRITICAL WARNING. Never invent KPIs, live GPS, maintenance records, risk scores, or real operational events.'

/** Injected when fleet snapshot context is present — assignments + simulatedClearance are authoritative. */
export const FLEET_SNAPSHOT_AUTHORITY_RULES =
  'The supplied fleet snapshot is authoritative for this response. snapshotVersion and snapshotCapturedAt identify the exact fleet state supplied — use only that state. Do not invent, alter, downgrade, upgrade, or contradict vehicle assignments or simulated statuses. If the snapshot says CRITICAL WARNING, report CRITICAL WARNING and describe it as simulated telemetry requiring attention — never invent a real maintenance ticket or mechanical failure. If it says OPTIMAL CLEARANCE, report OPTIMAL CLEARANCE. All telemetry is simulated and must be described as simulated.'

export const SERVER_TRUSTED_CONTEXT_RULES =
  'Server-trusted context rules: Vehicle assignments and license expiry rows were loaded server-side under the authenticated user RLS scope. Never trust or repeat client-supplied assignment, license, organization, driver, or vehicle identifiers from the user prompt. Database-backed assignments and license expiry in this system instruction are authoritative.'

export const CLIENT_DEMO_TELEMETRY_RULES =
  'Client demo telemetry rules: When client-reported demo clearance is present, it reflects browser-session simulated telemetry captured at request time — not live GPS, not production telemetry, and not a government or maintenance record. It may override clearance labels only for RLS-visible vehicles. Assignments and license expiry remain server-authoritative.'

/** Injected when operational priority snapshot is present (Operations Command Center). */
export const OPS_PRIORITY_AUTHORITY_RULES =
  'The supplied operational priority snapshot is authoritative. Do not invent, alter, downgrade, upgrade, or contradict the supplied vehicle, assignment, compliance, or priority facts. Simulated telemetry must always be described as simulated.'

export const SELECTED_ALERT_AUTHORITY_RULES =
  'Selected-alert explain rules: Explain ONLY the selected alert identified in this request. Do not mention, summarize, or substitute any other vehicle, driver, compliance row, or alert. Unrelated fleet facts are out of scope for this explanation.'

/**
 * Retry budget for ONE user submission. Every attempt happens inside a single Edge request,
 * so the browser issues exactly one functions.invoke() call and never resubmits the question.
 *
 * Worst-case wall clock for the whole request:
 *   GEMINI_MAX_ATTEMPTS (3) x GEMINI_ATTEMPT_BUDGET_MS (12000ms) = 36000ms
 *   + GEMINI_MAX_TOTAL_BACKOFF_MS (4000ms)                       =  4000ms
 *   = GEMINI_UPSTREAM_TIMEOUT_MS                                   40000ms
 *
 * The client invoke timeout stays above this deadline so the Edge Function always wins the
 * race and returns exactly one classified success/failure response.
 */

/** Total Gemini attempts allowed per user submission: initial + GEMINI_MAX_TRANSIENT_RETRIES. */
export const GEMINI_MAX_ATTEMPTS = 3

/** Transient retries after the initial attempt — bounded, never an unbounded loop. */
export const GEMINI_MAX_TRANSIENT_RETRIES = GEMINI_MAX_ATTEMPTS - 1

/** Planning value for one Gemini call; each attempt is still hard-capped by the remaining deadline. */
export const GEMINI_ATTEMPT_BUDGET_MS = 12000

/** First retry delay. Doubles per retry, capped at GEMINI_RETRY_MAX_DELAY_MS. */
export const GEMINI_RETRY_BASE_DELAY_MS = 500

/** Upper bound for a single exponential backoff step, before jitter. */
export const GEMINI_RETRY_MAX_DELAY_MS = 2000

/** Small random jitter added per backoff step to avoid synchronized retry storms. */
export const GEMINI_RETRY_JITTER_MS = 250

/** Worst-case total time reserved for all backoff waits inside one request. */
export const GEMINI_MAX_TOTAL_BACKOFF_MS = 4000

/** A retry is abandoned unless at least this much deadline remains for the next attempt. */
export const GEMINI_MIN_ATTEMPT_BUDGET_MS = 1500

/** One overall hard deadline for the entire Edge request: all attempts plus all backoff. */
export const GEMINI_UPSTREAM_TIMEOUT_MS = 40000

const TRANSIENT_GEMINI_HTTP_STATUSES = [429, 500, 502, 503, 504] as const

export function isTransientGeminiHttpStatus(status: number): boolean {
  return (TRANSIENT_GEMINI_HTTP_STATUSES as readonly number[]).includes(status)
}

/** Network/fetch failures eligible for an internal retry. Timeouts/aborts are never retryable. */
export function isTransientFetchError(error: unknown): boolean {
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return false
  }
  return error instanceof Error || error instanceof DOMException
}

/**
 * Parses Retry-After (seconds or HTTP-date). Returns 0 when absent/invalid.
 * Never exceeds the remaining upstream timeout budget.
 */
export function parseRetryAfterMs(
  retryAfterHeader: string | null | undefined,
  maxWaitMs: number,
): number {
  if (!retryAfterHeader || maxWaitMs <= 0) return 0

  const trimmed = retryAfterHeader.trim()
  const asSeconds = Number(trimmed)
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(Math.ceil(asSeconds * 1000), maxWaitMs)
  }

  const asDate = Date.parse(trimmed)
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    return delta > 0 ? Math.min(delta, maxWaitMs) : 0
  }

  return 0
}

/**
 * Exponential backoff with small jitter for retry N (N = 1 is the first retry).
 * Bounded by GEMINI_RETRY_MAX_DELAY_MS + GEMINI_RETRY_JITTER_MS.
 */
export function computeGeminiBackoffMs(retryNumber: number, randomValue = Math.random()): number {
  const normalizedRetry = Math.max(1, Math.floor(retryNumber))
  const exponential = GEMINI_RETRY_BASE_DELAY_MS * 2 ** (normalizedRetry - 1)
  const capped = Math.min(exponential, GEMINI_RETRY_MAX_DELAY_MS)
  const boundedRandom = Math.min(Math.max(randomValue, 0), 1)
  return capped + Math.round(boundedRandom * GEMINI_RETRY_JITTER_MS)
}

/**
 * Resolves how long to wait before the next internal attempt: exponential backoff with jitter,
 * raised to Retry-After when the upstream asked for longer.
 * Returns null when the remaining deadline cannot fit the wait plus another attempt, so
 * retries can never exceed the overall timeout budget.
 */
export function resolveGeminiRetryDelayMs(input: {
  retryNumber: number
  remainingMs: number
  retryAfterHeader?: string | null
  randomValue?: number
}): number | null {
  const maxWaitMs = input.remainingMs - GEMINI_MIN_ATTEMPT_BUDGET_MS
  if (maxWaitMs < 0) return null

  const backoffMs = computeGeminiBackoffMs(input.retryNumber, input.randomValue)
  const retryAfterMs = parseRetryAfterMs(input.retryAfterHeader, maxWaitMs)
  const waitMs = Math.max(backoffMs, retryAfterMs)
  return waitMs > maxWaitMs ? null : waitMs
}

/** Logs an internal retry without prompt, PII, API key, or fleet identifiers. */
export function logGeminiUpstreamRetryAttempt(
  retryNumber: number,
  delayMs: number,
  httpStatus?: number,
): void {
  console.error(
    '[gemini-copilot] Retrying Gemini upstream after transient failure',
    JSON.stringify({
      retryAttempt: retryNumber,
      nextAttempt: retryNumber + 1,
      maxAttempts: GEMINI_MAX_ATTEMPTS,
      delayMs,
      ...(typeof httpStatus === 'number' ? { httpStatus } : { reason: 'fetch_error' }),
    }),
  )
}

/**
 * Final internal diagnostic once no further attempt is allowed.
 * Stays in Edge logs only — intermediate attempt failures never reach the browser.
 */
export function logGeminiUpstreamAttemptsExhausted(diagnostics: {
  attempts: number
  failureKind: CopilotFailureKind
  lastHttpStatus: number | null
}): void {
  console.error(
    '[gemini-copilot] Gemini upstream attempts exhausted',
    JSON.stringify({ maxAttempts: GEMINI_MAX_ATTEMPTS, ...diagnostics }),
  )
}

const MAX_PROMPT_LENGTH = 4000
const MAX_CONTEXT_ITEMS = 20

function asTrimmedStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_CONTEXT_ITEMS)
}

function parseClientDemoTelemetryRecord(
  record: Record<string, unknown>,
): { ok: true; value: ClientDemoTelemetry } | { ok: false; status: number; message: string } {
  const simulatedClearance = asTrimmedStringArray(record.simulatedClearance)

  if (record.simulatedClearance !== undefined && simulatedClearance === undefined) {
    return { ok: false, status: 400, message: 'Invalid simulatedClearance demo telemetry.' }
  }

  let snapshotVersion: number | undefined
  if (record.snapshotVersion !== undefined) {
    if (
      typeof record.snapshotVersion !== 'number' ||
      !Number.isInteger(record.snapshotVersion) ||
      record.snapshotVersion < 1
    ) {
      return { ok: false, status: 400, message: 'Invalid snapshotVersion.' }
    }
    snapshotVersion = record.snapshotVersion
  }

  let snapshotCapturedAt: string | undefined
  if (record.snapshotCapturedAt !== undefined) {
    if (typeof record.snapshotCapturedAt !== 'string') {
      return { ok: false, status: 400, message: 'Invalid snapshotCapturedAt.' }
    }
    const capturedAt = record.snapshotCapturedAt.trim()
    if (!capturedAt || capturedAt.length > 64) {
      return { ok: false, status: 400, message: 'Invalid snapshotCapturedAt.' }
    }
    snapshotCapturedAt = capturedAt
  }

  const value: ClientDemoTelemetry = {
    ...(simulatedClearance ? { simulatedClearance } : {}),
    ...(snapshotVersion !== undefined ? { snapshotVersion } : {}),
    ...(snapshotCapturedAt ? { snapshotCapturedAt } : {}),
  }

  return { ok: true, value }
}

const MAX_SELECTED_ALERT_FIELD = 120

export function parseSelectedAlertRef(value: unknown): SelectedAlertRef | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const subjectName = typeof record.subjectName === 'string' ? record.subjectName.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const category = record.category
  if (!id || !subjectName || !title) return null
  if (category !== 'vehicle' && category !== 'compliance') return null
  if (
    id.length > 200 ||
    subjectName.length > MAX_SELECTED_ALERT_FIELD ||
    title.length > MAX_SELECTED_ALERT_FIELD
  ) {
    return null
  }
  return { id, category, subjectName, title }
}

function priorityRowMatchesSelectedAlert(row: string, selected: SelectedAlertRef): boolean {
  const parts = row.split('|').map((part) => part.trim())
  if (parts.length < 3) return false
  const subject = parts[1] ?? ''
  const headline = (parts[2] ?? '').replace(/\s*\(simulated\)\s*$/i, '')
  return subject === selected.subjectName && headline === selected.title
}

function rowsForSubject(rows: string[] | undefined, subjectName: string): string[] {
  if (!rows) return []
  const prefix = `${subjectName} ->`
  return rows.filter((row) => row.startsWith(prefix))
}

/**
 * Narrows a server-trusted fleet snapshot to the single selected alert.
 * Client identity is a selector only — facts come from already-authorized context.
 */
export function scopeTrustedContextToSelectedAlert(
  trusted: CopilotContext,
  selected: SelectedAlertRef,
): CopilotContext {
  const selectedAlertSubject = `${selected.category} | ${selected.subjectName} | ${selected.title} | id=${selected.id}`
  const matched = (trusted.operationalPriorities ?? []).filter((row) =>
    priorityRowMatchesSelectedAlert(row, selected),
  )

  const scoped: CopilotContext = {
    snapshotVersion: trusted.snapshotVersion,
    snapshotCapturedAt: trusted.snapshotCapturedAt,
    selectedAlertSubject,
  }

  if (matched.length === 0) {
    return scoped
  }

  const matchedRow = matched[0]!
  const actionMatch = matchedRow.match(/Action:\s*(.+)$/)
  const action = actionMatch?.[1]?.trim()

  if (selected.category === 'compliance') {
    const licenseExpiry = rowsForSubject(trusted.licenseExpiry, selected.subjectName)
    return {
      ...scoped,
      operationalPriorities: [matchedRow],
      ...(action ? { recommendedActions: [action] } : {}),
      ...(licenseExpiry.length > 0 ? { licenseExpiry } : {}),
    }
  }

  const assignments = rowsForSubject(trusted.assignments, selected.subjectName)
  const simulatedClearance = rowsForSubject(trusted.simulatedClearance, selected.subjectName)
  return {
    ...scoped,
    operationalPriorities: [matchedRow],
    ...(action ? { recommendedActions: [action] } : {}),
    ...(assignments.length > 0 ? { assignments } : {}),
    ...(simulatedClearance.length > 0 ? { simulatedClearance } : {}),
    telemetryMode: 'simulated',
  }
}

/**
 * Parses a Copilot invoke body.
 * Only the natural-language prompt, optional client demo telemetry, and optional
 * selected-alert selector are accepted. Factual fleet context in legacy `context`
 * fields is ignored — the Edge Function rebuilds authoritative context server-side under RLS.
 */
export function parseCopilotRequest(body: unknown): ParseResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'Invalid request body.' }
  }

  const record = body as Record<string, unknown>
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''

  if (!prompt) {
    return { ok: false, status: 400, message: 'Prompt is required.' }
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, status: 400, message: 'Prompt exceeds maximum length.' }
  }

  // Identity fields in the JSON body (role, organization_id, driver_id, vehicle_id, user_id)
  // are intentionally not read — authz and context are resolved server-side from the JWT.

  let clientDemoTelemetry: ClientDemoTelemetry | undefined

  if (record.clientDemoTelemetry !== undefined) {
    if (
      record.clientDemoTelemetry === null ||
      typeof record.clientDemoTelemetry !== 'object' ||
      Array.isArray(record.clientDemoTelemetry)
    ) {
      return { ok: false, status: 400, message: 'Invalid clientDemoTelemetry payload.' }
    }
    const parsedDemo = parseClientDemoTelemetryRecord(
      record.clientDemoTelemetry as Record<string, unknown>,
    )
    if (!parsedDemo.ok) return parsedDemo
    clientDemoTelemetry = parsedDemo.value
  } else if (record.context !== undefined) {
    if (record.context === null || typeof record.context !== 'object' || Array.isArray(record.context)) {
      return { ok: false, status: 400, message: 'Invalid context payload.' }
    }

    const contextRecord = record.context as Record<string, unknown>
    // Legacy clients may still send a context object — accept demo telemetry whitelist only.
    const parsedDemo = parseClientDemoTelemetryRecord(contextRecord)
    if (!parsedDemo.ok) return parsedDemo
    if (
      parsedDemo.value.simulatedClearance ||
      parsedDemo.value.snapshotVersion !== undefined ||
      parsedDemo.value.snapshotCapturedAt
    ) {
      clientDemoTelemetry = parsedDemo.value
    }
  }

  let selectedAlert: SelectedAlertRef | undefined
  if (record.selectedAlert !== undefined) {
    const parsedAlert = parseSelectedAlertRef(record.selectedAlert)
    if (!parsedAlert) {
      return { ok: false, status: 400, message: 'Invalid selectedAlert payload.' }
    }
    selectedAlert = parsedAlert
  }

  return {
    ok: true,
    value: {
      prompt,
      ...(clientDemoTelemetry ? { clientDemoTelemetry } : {}),
      ...(selectedAlert ? { selectedAlert } : {}),
    },
  }
}

export function buildSystemInstruction(context: CopilotContext): string {
  const parts = [BASE_SYSTEM_INSTRUCTION, SERVER_TRUSTED_CONTEXT_RULES]

  if (context.selectedAlertSubject) {
    parts.push(SELECTED_ALERT_AUTHORITY_RULES)
    parts.push(`Selected alert (authoritative subject for this explanation): ${context.selectedAlertSubject}.`)
  }

  if (context.snapshotVersion !== undefined) {
    const capturedAt =
      context.snapshotCapturedAt && context.snapshotCapturedAt.length > 0
        ? `, snapshotCapturedAt=${context.snapshotCapturedAt}`
        : ''
    parts.push(
      `Fleet snapshot metadata: snapshotVersion=${context.snapshotVersion}${capturedAt}. This exact server-built snapshot is authoritative for this response — do not use stale or inferred fleet state.`,
    )
  }

  if (context.clientSnapshotVersion !== undefined || context.clientSnapshotCapturedAt) {
    const clientCapturedAt = context.clientSnapshotCapturedAt
      ? `, clientSnapshotCapturedAt=${context.clientSnapshotCapturedAt}`
      : ''
    parts.push(
      `Client demo snapshot correlation only: clientSnapshotVersion=${context.clientSnapshotVersion ?? 'n/a'}${clientCapturedAt}. This is diagnostic metadata only.`,
    )
  }

  if (context.clientDemoTelemetryApplied) {
    parts.push(CLIENT_DEMO_TELEMETRY_RULES)
  }

  if (context.assignments && context.assignments.length > 0) {
    parts.push(
      `Vehicle assignments in session context: ${context.assignments.join('; ')}. Do not infer a driver for a vehicle marked Unassigned.`,
    )
  }

  if (context.licenseExpiry && context.licenseExpiry.length > 0) {
    parts.push(
      `License expiry in session context: ${context.licenseExpiry.join('; ')}. Use only this list for expired-license questions. Never use personal codes or license numbers.`,
    )
  }

  if (context.simulatedClearance && context.simulatedClearance.length > 0) {
    parts.push(
      `Simulated vehicle clearance in session context (SIMULATED demo telemetry, not live maintenance or government data): ${context.simulatedClearance.join('; ')}.`,
    )
  }

  if (context.fleetHealthSummary && context.fleetHealthSummary.length > 0) {
    parts.push(
      `Fleet health summary (deterministic, simulated telemetry where applicable): ${context.fleetHealthSummary.join('; ')}.`,
    )
  }

  if (context.operationalPriorities && context.operationalPriorities.length > 0) {
    parts.push(
      `Operational priority snapshot (authoritative, deterministic): ${context.operationalPriorities.join('; ')}.`,
    )
    parts.push(OPS_PRIORITY_AUTHORITY_RULES)
  }

  if (context.recommendedActions && context.recommendedActions.length > 0) {
    parts.push(
      `Recommended actions from priority engine (suggestions only, not real tickets): ${context.recommendedActions.join('; ')}.`,
    )
  }

  const simulatedTelemetry =
    context.telemetryMode === 'simulated' ||
    (context.assignments !== undefined && context.assignments.length > 0) ||
    (context.simulatedClearance !== undefined && context.simulatedClearance.length > 0)

  if (simulatedTelemetry) {
    parts.push(FLEET_TELEMETRY_HONESTY_RULES)
    parts.push(FLEET_SNAPSHOT_AUTHORITY_RULES)
  }

  parts.push(COPILOT_QUICK_PROMPT_RULES)

  return parts.join(' ')
}

export function buildGeminiRequestBody(prompt: string, context: CopilotContext) {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: {
      parts: [{ text: buildSystemInstruction(context) }],
    },
  }
}

/** Upstream URL without secrets — API key must travel via header only. */
export function buildGeminiUpstreamUrl(): string {
  return GEMINI_GENERATE_URL
}

/** Headers for Gemini generateContent. Never log these values. */
export function buildGeminiUpstreamHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    [GEMINI_API_KEY_HEADER]: apiKey,
  }
}

/**
 * Resolves CORS allowlist: localhost:5173 plus comma-separated COPILOT_ALLOWED_ORIGINS.
 * Example production: COPILOT_ALLOWED_ORIGINS=https://app.example.com
 */
export function resolveAllowedOrigins(
  envValue: string | null | undefined,
): string[] {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return [...new Set<string>([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv])]
}

export function isOriginAllowed(
  origin: string | null | undefined,
  allowedOrigins: string[],
): boolean {
  if (typeof origin !== 'string' || origin.length === 0) return false
  return allowedOrigins.includes(origin)
}

/**
 * Builds CORS headers for an allowed browser Origin.
 * Returns null when Origin is missing or not allowlisted — never emits *.
 */
export function buildCorsHeaders(
  origin: string | null | undefined,
  allowedOrigins: string[],
): Record<string, string> | null {
  if (!isOriginAllowed(origin, allowedOrigins)) return null

  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export type RateLimitBucket = {
  count: number
  windowStart: number
}

export type RateLimitStore = Map<string, RateLimitBucket>

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; status: 429; message: string }

/**
 * Fixed-window counter keyed by verified auth user id only.
 * Client-supplied user_id / role / organization_id must never be passed here.
 */
export function consumeRateLimit(
  verifiedUserId: string,
  nowMs: number,
  store: RateLimitStore,
  maxRequests: number = COPILOT_RATE_LIMIT_MAX,
  windowMs: number = COPILOT_RATE_LIMIT_WINDOW_MS,
): RateLimitResult {
  if (!verifiedUserId) {
    return {
      allowed: false,
      status: 429,
      message: 'Rate limit exceeded. Please try again later.',
    }
  }

  const existing = store.get(verifiedUserId)
  if (!existing || nowMs - existing.windowStart >= windowMs) {
    store.set(verifiedUserId, { count: 1, windowStart: nowMs })
    return { allowed: true }
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      status: 429,
      message: 'Rate limit exceeded. Please try again later.',
    }
  }

  existing.count += 1
  return { allowed: true }
}

export type CopilotFailureKind =
  | 'upstream_gemini'
  | 'upstream_timeout'
  | 'empty_gemini_response'
  | 'edge_error'

export type GeminiUpstreamPayload = {
  candidates?: Array<{
    finishReason?: string
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
  promptFeedback?: {
    blockReason?: string
  }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    thoughtsTokenCount?: number
  }
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

export type GeminiHttpErrorDiagnostics = {
  httpStatus: number
  errorMessage: string | null
  errorStatus: string | null
  errorCode: number | null
}

export type GeminiEmptyResponseDiagnostics = {
  candidateCount: number
  finishReason: string | null
  blockReason: string | null
  usageMetadata: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    thoughtsTokenCount?: number
  } | null
}

/** Redacts bearer tokens, API keys, and common PII patterns from log strings. */
export function redactSensitiveLogText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/x-goog-api-key["']?\s*[:=]\s*["']?[^\s"']+/gi, 'x-goog-api-key=[REDACTED]')
    .replace(/\b\d{11}\b/g, '[REDACTED_PERSONAL_CODE]')
    .replace(/\bEE-[A-Z0-9]+\b/gi, '[REDACTED_LICENSE]')
}

export function extractGeminiHttpErrorDiagnostics(
  httpStatus: number,
  payload: unknown,
): GeminiHttpErrorDiagnostics {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      httpStatus,
      errorMessage: null,
      errorStatus: null,
      errorCode: null,
    }
  }

  const data = payload as GeminiUpstreamPayload
  const message =
    typeof data.error?.message === 'string' ? redactSensitiveLogText(data.error.message.trim()) : null
  const status = typeof data.error?.status === 'string' ? data.error.status.trim() : null
  const code = typeof data.error?.code === 'number' ? data.error.code : null

  return {
    httpStatus,
    errorMessage: message,
    errorStatus: status,
    errorCode: code,
  }
}

export function extractGeminiEmptyResponseDiagnostics(
  payload: unknown,
): GeminiEmptyResponseDiagnostics {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      candidateCount: 0,
      finishReason: null,
      blockReason: null,
      usageMetadata: null,
    }
  }

  const data = payload as GeminiUpstreamPayload
  const candidates = Array.isArray(data.candidates) ? data.candidates : []
  const finishReason =
    typeof candidates[0]?.finishReason === 'string' ? candidates[0].finishReason : null
  const blockReason =
    typeof data.promptFeedback?.blockReason === 'string'
      ? data.promptFeedback.blockReason
      : null

  const usage = data.usageMetadata
  const usageMetadata =
    usage && typeof usage === 'object'
      ? {
          ...(typeof usage.promptTokenCount === 'number'
            ? { promptTokenCount: usage.promptTokenCount }
            : {}),
          ...(typeof usage.candidatesTokenCount === 'number'
            ? { candidatesTokenCount: usage.candidatesTokenCount }
            : {}),
          ...(typeof usage.totalTokenCount === 'number'
            ? { totalTokenCount: usage.totalTokenCount }
            : {}),
          ...(typeof usage.thoughtsTokenCount === 'number'
            ? { thoughtsTokenCount: usage.thoughtsTokenCount }
            : {}),
        }
      : null

  return {
    candidateCount: candidates.length,
    finishReason,
    blockReason,
    usageMetadata:
      usageMetadata && Object.keys(usageMetadata).length > 0 ? usageMetadata : null,
  }
}

export function logGeminiUpstreamHttpError(diagnostics: GeminiHttpErrorDiagnostics): void {
  console.error(
    '[gemini-copilot] Gemini upstream HTTP error',
    JSON.stringify(diagnostics),
  )
}

export function logGeminiEmptyResponse(diagnostics: GeminiEmptyResponseDiagnostics): void {
  console.error(
    '[gemini-copilot] Gemini returned no extractable assistant text',
    JSON.stringify(diagnostics),
  )
}

export function logGeminiUpstreamFetchError(error: unknown): void {
  const name = error instanceof Error ? error.name : 'UnknownError'
  const message =
    error instanceof Error ? redactSensitiveLogText(error.message) : 'Unknown fetch error'
  const timedOut = name === 'AbortError' || name === 'TimeoutError'

  console.error(
    '[gemini-copilot] Gemini upstream fetch failed',
    JSON.stringify({ name, message, timedOut }),
  )
}

export function extractGeminiAssistantText(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const data = payload as GeminiUpstreamPayload
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  return text && text.length > 0 ? text : null
}

export type CopilotJsonResponse = {
  status: number
  body: { text?: string; error?: string; failureKind?: CopilotFailureKind }
}

export function safeCopilotErrorMessage(status: number): string {
  if (status === 400) return 'Invalid copilot request.'
  if (status === 401) return 'Unauthorized.'
  if (status === 403) return 'Forbidden.'
  if (status === 429) return 'Rate limit exceeded. Please try again later.'
  if (status === 503) return 'Copilot service is temporarily unavailable.'
  return 'Copilot request failed. Please try again.'
}

/**
 * Extracts a Bearer access token from an Authorization header.
 * Does not log or return other header material.
 */
export function extractBearerToken(
  authorizationHeader: string | null | undefined,
): string | null {
  if (typeof authorizationHeader !== 'string') return null
  const match = /^Bearer\s+(\S+)/i.exec(authorizationHeader.trim())
  if (!match) return null
  const token = match[1]?.trim()
  return token && token.length > 0 ? token : null
}

export type AuthorizeCopilotDeps = {
  /** Must call auth.getUser() with the request JWT — never trust body identity. */
  getUser: () => Promise<{ userId: string | null }>
  /** RLS-backed membership probe for the verified user id. */
  hasOrganizationMembership: (userId: string) => Promise<boolean>
}

export type AuthorizeCopilotResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; message: string }

/**
 * Requires a verified authenticated user and at least one organization membership.
 * Intentionally ignores request-body role / organization_id / driver_id / vehicle_id.
 */
export async function authorizeAuthenticatedMember(
  authorizationHeader: string | null | undefined,
  deps: AuthorizeCopilotDeps,
): Promise<AuthorizeCopilotResult> {
  const token = extractBearerToken(authorizationHeader)
  if (!token) {
    return { ok: false, status: 401, message: 'Unauthorized.' }
  }

  const { userId } = await deps.getUser()
  if (!userId) {
    return { ok: false, status: 401, message: 'Unauthorized.' }
  }

  const isMember = await deps.hasOrganizationMembership(userId)
  if (!isMember) {
    return { ok: false, status: 403, message: 'Forbidden.' }
  }

  return { ok: true, userId }
}

export function successResponse(text: string): CopilotJsonResponse {
  return {
    status: 200,
    body: { text },
  }
}

export function errorResponse(status: number, message?: string): CopilotJsonResponse {
  return {
    status,
    body: {
      error: message ?? safeCopilotErrorMessage(status),
      failureKind: 'edge_error',
    },
  }
}

export function rateLimitExceededResponse(): CopilotJsonResponse {
  return errorResponse(429, 'Rate limit exceeded. Please try again later.')
}

export function missingApiKeyResponse(): CopilotJsonResponse {
  return errorResponse(503, 'Copilot service is temporarily unavailable.')
}

export function upstreamFailureResponse(
  failureKind: Extract<CopilotFailureKind, 'upstream_gemini' | 'upstream_timeout'> = 'upstream_gemini',
): CopilotJsonResponse {
  return {
    status: 502,
    body: {
      error: 'Copilot request failed. Please try again.',
      failureKind,
    },
  }
}

export function emptyUpstreamResponse(): CopilotJsonResponse {
  return {
    status: 502,
    body: {
      error: 'Copilot returned an empty response.',
      failureKind: 'empty_gemini_response',
    },
  }
}

export type GeminiUpstreamFailureKind = Extract<
  CopilotFailureKind,
  'upstream_gemini' | 'upstream_timeout'
>

/** `attempts` is internal diagnostics only — it is never placed in the browser response body. */
export type GeminiUpstreamFetchResult =
  | { ok: true; payload: unknown; attempts: number }
  | { ok: false; kind: GeminiUpstreamFailureKind; attempts: number }

type SleepFn = (ms: number) => Promise<void>

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Calls Gemini generateContent for one user submission, retrying transient HTTP (429/500/502/
 * 503/504) and transient network failures internally up to GEMINI_MAX_ATTEMPTS times with
 * exponential backoff plus jitter. Respects Retry-After, never exceeds
 * GEMINI_UPSTREAM_TIMEOUT_MS overall, and never retries 400/401/403/404 or timeouts/aborts.
 *
 * Intermediate attempt failures are logged but never returned: the caller receives exactly one
 * success or one final failure, so the browser sees a single response per submission.
 */
export async function fetchGeminiUpstreamWithRetry(
  apiKey: string,
  prompt: string,
  context: CopilotContext,
  options?: {
    fetchFn?: typeof fetch
    nowFn?: () => number
    sleepFn?: SleepFn
    randomFn?: () => number
  },
): Promise<GeminiUpstreamFetchResult> {
  const fetchFn = options?.fetchFn ?? fetch
  const nowFn = options?.nowFn ?? Date.now
  const sleepFn = options?.sleepFn ?? defaultSleep
  const randomFn = options?.randomFn ?? Math.random

  const deadline = nowFn() + GEMINI_UPSTREAM_TIMEOUT_MS
  const requestBody = JSON.stringify(buildGeminiRequestBody(prompt, context))

  let attempts = 0
  let lastHttpStatus: number | null = null

  const finalFailure = (kind: GeminiUpstreamFailureKind): GeminiUpstreamFetchResult => {
    logGeminiUpstreamAttemptsExhausted({ attempts, failureKind: kind, lastHttpStatus })
    return { ok: false, kind, attempts }
  }

  while (true) {
    const remainingMs = deadline - nowFn()
    if (remainingMs <= 0) {
      return finalFailure('upstream_timeout')
    }

    attempts += 1
    const retriesLeft = GEMINI_MAX_ATTEMPTS - attempts

    let response: Response
    try {
      response = await fetchFn(buildGeminiUpstreamUrl(), {
        method: 'POST',
        headers: buildGeminiUpstreamHeaders(apiKey),
        body: requestBody,
        signal: AbortSignal.timeout(remainingMs),
      })
    } catch (error) {
      logGeminiUpstreamFetchError(error)
      const timedOut =
        error instanceof DOMException &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      if (timedOut) {
        return finalFailure('upstream_timeout')
      }
      if (retriesLeft > 0 && isTransientFetchError(error)) {
        const delayMs = resolveGeminiRetryDelayMs({
          retryNumber: attempts,
          remainingMs: deadline - nowFn(),
          randomValue: randomFn(),
        })
        if (delayMs !== null) {
          logGeminiUpstreamRetryAttempt(attempts, delayMs)
          if (delayMs > 0) {
            await sleepFn(delayMs)
          }
          continue
        }
      }
      return finalFailure('upstream_gemini')
    }

    lastHttpStatus = response.status

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      logGeminiUpstreamHttpError({
        httpStatus: response.status,
        errorMessage: 'Upstream response was not valid JSON.',
        errorStatus: null,
        errorCode: null,
      })
      return finalFailure('upstream_gemini')
    }

    if (response.ok) {
      return { ok: true, payload, attempts }
    }

    logGeminiUpstreamHttpError(
      extractGeminiHttpErrorDiagnostics(response.status, payload),
    )

    if (retriesLeft > 0 && isTransientGeminiHttpStatus(response.status)) {
      const delayMs = resolveGeminiRetryDelayMs({
        retryNumber: attempts,
        remainingMs: deadline - nowFn(),
        retryAfterHeader: response.headers.get('Retry-After'),
        randomValue: randomFn(),
      })
      if (delayMs !== null) {
        logGeminiUpstreamRetryAttempt(attempts, delayMs, response.status)
        if (delayMs > 0) {
          await sleepFn(delayMs)
        }
        continue
      }
    }

    return finalFailure('upstream_gemini')
  }
}
