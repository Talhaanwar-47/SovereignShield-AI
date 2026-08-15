import { beforeEach, describe, expect, it, vi } from 'vitest'
import dashboardLayoutSource from '../DashboardLayout.tsx?raw'
import demoExperienceSource from '../data/demoExperience.ts?raw'
import geminiCopilotSource from './geminiCopilot.ts?raw'
import geminiCopilotHelpersSource from './geminiCopilotHelpers.ts?raw'
import ocrServiceSource from './ocrService.ts?raw'
import edgeIndexSource from '../../supabase/functions/gemini-copilot/index.ts?raw'
import {
  buildFleetCopilotContext,
  buildGeminiRequestBody,
  buildGeminiUpstreamHeaders,
  buildGeminiUpstreamUrl,
  buildSystemInstruction,
  COPILOT_QUICK_PROMPT_RULES,
  EXPIRED_LICENSES_PROMPT,
  HIGH_RISK_FAST_PATH_RESPONSE,
  HIGH_RISK_PROMPT,
  LICENSE_EXPIRY_UNAVAILABLE_RESPONSE,
  emptyUpstreamResponse,
  extractGeminiAssistantText,
  COPILOT_TRANSIENT_BUSY_MESSAGE,
  copilotFailureUserMessage,
  FLEET_SNAPSHOT_AUTHORITY_RULES,
  FLEET_TELEMETRY_HONESTY_RULES,
  GEMINI_API_KEY_HEADER,
  GEMINI_MODEL,
  mapEdgeFunctionResult,
  missingApiKeyResponse,
  parseCopilotRequest,
  resolveCopilotFastPath,
  successResponse,
  upstreamFailureResponse,
} from './geminiCopilotHelpers'
import edgeHelpersSource from '../../supabase/functions/gemini-copilot/helpers.ts?raw'
import fleetSnapshotSource from './fleetSnapshot.ts?raw'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}))

import {
  answerCopilotQuery,
  COPILOT_INVOKE_TIMEOUT_MS,
  fetchGeminiCopilotResponse,
  type GeminiCopilotError,
} from './geminiCopilot'

describe('parseCopilotRequest', () => {
  it('rejects malformed bodies', () => {
    expect(parseCopilotRequest(null).ok).toBe(false)
    expect(parseCopilotRequest([]).ok).toBe(false)
    expect(parseCopilotRequest({}).ok).toBe(false)
    expect(parseCopilotRequest({ prompt: '   ' }).ok).toBe(false)
  })

  it('accepts a valid prompt and ignores legacy factual context fields', () => {
    const result = parseCopilotRequest({
      prompt: '  Which vehicles need maintenance?  ',
      context: {
        assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        prompt: 'Which vehicles need maintenance?',
      },
    })
  })

  it('accepts client demo telemetry metadata only from legacy context', () => {
    const result = parseCopilotRequest({
      prompt: 'Which vehicles require maintenance?',
      context: {
        assignments: ['EE-FLEET-118 -> Unassigned'],
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
        telemetryMode: 'simulated',
        snapshotVersion: 184,
        snapshotCapturedAt: '2026-08-14T08:00:00.000Z',
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        prompt: 'Which vehicles require maintenance?',
        clientDemoTelemetry: {
          simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
          snapshotVersion: 184,
          snapshotCapturedAt: '2026-08-14T08:00:00.000Z',
        },
      },
    })
  })

  it('rejects invalid snapshotVersion values', () => {
    expect(parseCopilotRequest({ prompt: 'Hi', context: { snapshotVersion: 0 } }).ok).toBe(false)
    expect(parseCopilotRequest({ prompt: 'Hi', context: { snapshotVersion: '1' } }).ok).toBe(
      false,
    )
  })

  it('ignores legacy factual context fields such as assignments and inventory lists', () => {
    const result = parseCopilotRequest({
      prompt: 'Fleet status?',
      context: {
        assignments: ['EE-FLEET-991 -> Jürgen Tamm', 'EE-FLEET-402 -> Unassigned'],
        drivers: ['Jürgen Tamm'],
        vehicles: ['EE-FLEET-991', 'EE-FLEET-402', 'EE-FLEET-118'],
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        prompt: 'Fleet status?',
      },
    })
  })

  it('accepts a selectedAlert selector and rejects invalid selectors', () => {
    const result = parseCopilotRequest({
      prompt: 'Explain this single operational alert',
      selectedAlert: {
        id: 'compliance:demo-driver-blake:expired-license',
        category: 'compliance',
        subjectName: 'Demo Driver Blake',
        title: 'Expired License',
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        prompt: 'Explain this single operational alert',
        selectedAlert: {
          id: 'compliance:demo-driver-blake:expired-license',
          category: 'compliance',
          subjectName: 'Demo Driver Blake',
          title: 'Expired License',
        },
      },
    })

    expect(
      parseCopilotRequest({
        prompt: 'Explain this',
        selectedAlert: { id: 'x', category: 'superuser', subjectName: 'A', title: 'B' },
      }).ok,
    ).toBe(false)
  })
})

describe('server-side Gemini boundary helpers', () => {
  it('handles a missing server-side Gemini key safely', () => {
    expect(missingApiKeyResponse()).toEqual({
      status: 503,
      body: {
        error: 'Copilot service is temporarily unavailable.',
        failureKind: 'edge_error',
      },
    })
  })

  it('maps a successful upstream payload to assistant text', () => {
    const text = extractGeminiAssistantText({
      candidates: [{ content: { parts: [{ text: '  Fleet looks healthy.  ' }] } }],
    })

    expect(text).toBe('Fleet looks healthy.')
    expect(successResponse(text!)).toEqual({
      status: 200,
      body: { text: 'Fleet looks healthy.' },
    })
  })

  it('produces safe errors for upstream failure and empty responses', () => {
    expect(upstreamFailureResponse()).toEqual({
      status: 502,
      body: {
        error: 'Copilot request failed. Please try again.',
        failureKind: 'upstream_gemini',
      },
    })
    expect(upstreamFailureResponse('upstream_timeout')).toEqual({
      status: 502,
      body: {
        error: 'Copilot request failed. Please try again.',
        failureKind: 'upstream_timeout',
      },
    })
    expect(emptyUpstreamResponse()).toEqual({
      status: 502,
      body: {
        error: 'Copilot returned an empty response.',
        failureKind: 'empty_gemini_response',
      },
    })
    expect(extractGeminiAssistantText({ candidates: [] })).toBeNull()
  })

  it('wires Edge observability logging for Gemini upstream failures', () => {
    expect(edgeHelpersSource).toContain('logGeminiUpstreamHttpError')
    expect(edgeIndexSource).toContain('logGeminiEmptyResponse')
    expect(edgeHelpersSource).toContain('logGeminiUpstreamFetchError')
    expect(edgeHelpersSource).toContain('logGeminiUpstreamRetryAttempt')
    expect(edgeHelpersSource).toContain('extractGeminiHttpErrorDiagnostics')
    expect(edgeHelpersSource).toContain('extractGeminiEmptyResponseDiagnostics')
    expect(edgeHelpersSource).toContain('redactSensitiveLogText')
    expect(dashboardLayoutSource).toContain('EXCEPTION [COPILOT]:')
    expect(dashboardLayoutSource).not.toContain('EXCEPTION [COPILOT${kindLabel}]')
    expect(dashboardLayoutSource).toContain('copilotFailureSupportLine')
  })

  it('sends only contents and systemInstruction in the Gemini request body', () => {
    const body = buildGeminiRequestBody('Which vehicle is assigned to Jürgen Tamm?', {
      assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
    })

    expect(Object.keys(body)).toEqual(['contents', 'systemInstruction'])
    expect(body).not.toHaveProperty('generationConfig')
    expect(JSON.stringify(body)).not.toContain('generationConfig')
    expect(JSON.stringify(body)).not.toContain('maxOutputTokens')
    expect(JSON.stringify(body)).not.toContain('thinkingConfig')
    expect(JSON.stringify(body)).not.toContain('thinkingBudget')
    expect(edgeHelpersSource).not.toContain('generationConfig')
    expect(edgeHelpersSource).not.toContain('maxOutputTokens')
    expect(edgeHelpersSource).not.toContain('thinkingConfig')
    expect(edgeHelpersSource).not.toContain('thinkingBudget')
    expect(edgeHelpersSource).toContain('GEMINI_UPSTREAM_TIMEOUT_MS = 40000')
    expect(edgeHelpersSource).toContain('AbortSignal.timeout(remainingMs)')
    expect(geminiCopilotSource).toContain('COPILOT_INVOKE_TIMEOUT_MS = 46000')
    expect(geminiCopilotSource).toContain('timeout: COPILOT_INVOKE_TIMEOUT_MS')
    expect(edgeIndexSource).toContain('fetchGeminiUpstreamWithRetry')
  })

  it('keeps the Gemini key in the x-goog-api-key header, never the URL', () => {
    const url = buildGeminiUpstreamUrl()
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(url).toContain('gemini-3.6-flash')
    expect(url).not.toContain('key=')
    expect(url).not.toContain('test-server-secret')

    const headers = buildGeminiUpstreamHeaders('test-server-secret')
    expect(headers[GEMINI_API_KEY_HEADER]).toBe('test-server-secret')
    expect(edgeHelpersSource).toContain('buildGeminiUpstreamHeaders(apiKey)')
    expect(edgeIndexSource).not.toMatch(/\?key=/)
    expect(edgeHelpersSource).not.toMatch(/\?key=/)
  })

  it('pins gemini-3.6-flash identically on the client mirror and the Edge Function', () => {
    expect(GEMINI_MODEL).toBe('gemini-3.6-flash')
    expect(buildGeminiUpstreamUrl()).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    )

    // Client mirror and Edge Function must never drift apart on the model.
    expect(edgeHelpersSource).toContain("GEMINI_MODEL = 'gemini-3.6-flash'")
    expect(geminiCopilotHelpersSource).toContain("GEMINI_MODEL = 'gemini-3.6-flash'")
    expect(geminiCopilotHelpersSource).not.toContain('gemini-flash-latest')
    expect(edgeHelpersSource).not.toContain('gemini-flash-latest')

    // The browser still never calls Gemini directly — only the Edge Function does.
    expect(geminiCopilotSource).not.toMatch(/generativelanguage\.googleapis\.com/)
    expect(dashboardLayoutSource).not.toContain('gemini-3.6-flash')
  })
})

describe('mapEdgeFunctionResult', () => {
  it('maps successful edge payloads to text', async () => {
    await expect(mapEdgeFunctionResult({ text: 'All clear' }, null)).resolves.toEqual({
      ok: true,
      text: 'All clear',
    })
  })

  it('classifies edge error payloads by failureKind without exposing raw Gemini errors', async () => {
    await expect(
      mapEdgeFunctionResult(
        {
          error: 'Copilot service is temporarily unavailable.',
          failureKind: 'edge_error',
        },
        null,
      ),
    ).resolves.toEqual({
      ok: false,
      message: copilotFailureUserMessage('edge_error'),
      kind: 'edge_error',
    })

    await expect(
      mapEdgeFunctionResult(
        {
          error: 'Unauthorized.',
          failureKind: 'edge_error',
        },
        null,
      ),
    ).resolves.toEqual({
      ok: false,
      message: 'Unauthorized.',
      kind: 'edge_error',
    })

    await expect(
      mapEdgeFunctionResult(
        {
          error: 'Copilot returned an empty response.',
          failureKind: 'empty_gemini_response',
        },
        null,
      ),
    ).resolves.toEqual({
      ok: false,
      message: copilotFailureUserMessage('empty_gemini_response'),
      kind: 'empty_gemini_response',
    })

    await expect(
      mapEdgeFunctionResult(
        {
          error: 'Copilot request failed. Please try again.',
          failureKind: 'upstream_timeout',
        },
        null,
      ),
    ).resolves.toEqual({
      ok: false,
      message: copilotFailureUserMessage('upstream_timeout'),
      kind: 'upstream_timeout',
    })
  })

  it('parses FunctionsHttpError bodies and classifies invoke transport failures', async () => {
    const httpResponse = new Response(
      JSON.stringify({
        error: 'Copilot returned an empty response.',
        failureKind: 'empty_gemini_response',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
    const httpError = new Error('Edge Function returned a non-2xx status code')
    httpError.name = 'FunctionsHttpError'
    Object.assign(httpError, { context: httpResponse })

    await expect(mapEdgeFunctionResult(null, httpError)).resolves.toEqual({
      ok: false,
      message: copilotFailureUserMessage('empty_gemini_response'),
      kind: 'empty_gemini_response',
    })

    const fetchError = new Error('Failed to send a request to the Edge Function')
    fetchError.name = 'FunctionsFetchError'
    Object.assign(fetchError, { context: { name: 'AbortError' } })

    await expect(mapEdgeFunctionResult(null, fetchError)).resolves.toEqual({
      ok: false,
      message: copilotFailureUserMessage('invoke_timeout'),
      kind: 'invoke_timeout',
    })
  })
})

describe('fetchGeminiCopilotResponse client boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes the Edge Function and returns assistant text', async () => {
    invokeMock.mockResolvedValue({
      data: { text: 'Two vehicles need maintenance.' },
      error: null,
    })

    await expect(
      fetchGeminiCopilotResponse('Which vehicles require maintenance?', {
        assignments: ['EE-FLEET-118 -> Unassigned'],
      }),
    ).resolves.toBe('Two vehicles need maintenance.')

    expect(invokeMock).toHaveBeenCalledWith('gemini-copilot', {
      body: {
        prompt: 'Which vehicles require maintenance?',
      },
      timeout: COPILOT_INVOKE_TIMEOUT_MS,
    })
    expect(COPILOT_INVOKE_TIMEOUT_MS).toBeGreaterThan(40000)
  })

  it('forwards selectedAlert as a selector without sending factual fleet context', async () => {
    invokeMock.mockResolvedValue({
      data: { text: 'Blake has an expired license.' },
      error: null,
    })

    await expect(
      fetchGeminiCopilotResponse(
        'Explain this single operational alert',
        { assignments: ['EE-DEMO-118 -> Unassigned'] },
        {
          selectedAlert: {
            id: 'compliance:demo-driver-blake:expired-license',
            category: 'compliance',
            subjectName: 'Demo Driver Blake',
            title: 'Expired License',
          },
        },
      ),
    ).resolves.toBe('Blake has an expired license.')

    expect(invokeMock).toHaveBeenCalledWith('gemini-copilot', {
      body: {
        prompt: 'Explain this single operational alert',
        selectedAlert: {
          id: 'compliance:demo-driver-blake:expired-license',
          category: 'compliance',
          subjectName: 'Demo Driver Blake',
          title: 'Expired License',
        },
      },
      timeout: COPILOT_INVOKE_TIMEOUT_MS,
    })
  })

  it('throws a classified client error when the Edge Function fails', async () => {
    invokeMock.mockResolvedValue({
      data: {
        error: 'Copilot service is temporarily unavailable.',
        failureKind: 'edge_error',
      },
      error: null,
    })

    await expect(fetchGeminiCopilotResponse('status check')).rejects.toMatchObject({
      message: COPILOT_TRANSIENT_BUSY_MESSAGE,
      kind: 'edge_error',
    })
  })

  it('R6 — one user submission makes exactly one browser invoke on success', async () => {
    invokeMock.mockResolvedValue({
      data: { text: 'Fleet is stable.' },
      error: null,
    })

    await expect(answerCopilotQuery('Give me a fleet report', {
      assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
      telemetryMode: 'simulated',
      snapshotVersion: 7,
      snapshotCapturedAt: '2026-02-01T10:00:00.000Z',
    })).resolves.toBe('Fleet is stable.')

    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('R6 — one user submission makes exactly one browser invoke on final failure', async () => {
    invokeMock.mockResolvedValue({
      data: {
        error: 'Copilot request failed. Please try again.',
        failureKind: 'upstream_gemini',
      },
      error: null,
    })

    await expect(answerCopilotQuery('Give me a fleet report')).rejects.toMatchObject({
      message: COPILOT_TRANSIENT_BUSY_MESSAGE,
      kind: 'upstream_gemini',
    })

    // Retries live entirely inside the Edge Function — the client never resubmits.
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(geminiCopilotSource.match(/functions\.invoke\(/g)).toHaveLength(1)
    expect(geminiCopilotSource).not.toMatch(/while \(|for \(|retryCount|attempt/i)
  })

  it('R7 — no intermediate Gemini failure reaches the client for a recovered submission', async () => {
    // The Edge Function retried 429 then 503 internally and resolved to success:
    // the browser only ever observes the single success payload.
    invokeMock.mockResolvedValue({
      data: { text: 'Recovered after internal retries.' },
      error: null,
    })

    await expect(
      answerCopilotQuery('Which vehicles require maintenance?', {
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
        telemetryMode: 'simulated',
      }),
    ).resolves.toBe('Recovered after internal retries.')

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const [, options] = invokeMock.mock.calls[0]
    expect(options.timeout).toBe(COPILOT_INVOKE_TIMEOUT_MS)

    for (const call of invokeMock.mock.results) {
      const payload = await call.value
      expect(payload.data).not.toHaveProperty('failureKind')
      expect(JSON.stringify(payload)).not.toMatch(/429|503|upstream_gemini/)
    }
  })

  it('R8 — failureKind stays available to the client for internal diagnostics only', async () => {
    invokeMock.mockResolvedValue({
      data: {
        error: 'Copilot request failed. Please try again.',
        failureKind: 'upstream_timeout',
      },
      error: null,
    })

    const failure = await fetchGeminiCopilotResponse('status check').then(
      () => null,
      (error: GeminiCopilotError) => error,
    )

    expect(failure).not.toBeNull()
    expect(failure?.kind).toBe('upstream_timeout')
    // The user-facing message never leaks status codes, Gemini errors, or Edge terminology.
    expect(failure?.message).toBe(COPILOT_TRANSIENT_BUSY_MESSAGE)
    expect(failure?.message).not.toMatch(/429|500|502|503|504|Gemini|Edge|upstream|retry/i)
  })
})

describe('buildFleetCopilotContext', () => {
  it('pairs every vehicle to its resolved driver, including Unassigned', () => {
    const context = buildFleetCopilotContext([
      { assetId: 'EE-FLEET-991', driverName: 'Jürgen Tamm' },
      { assetId: 'EE-FLEET-402', driverName: 'Unassigned' },
      { assetId: 'EE-FLEET-118', driverName: 'Unassigned' },
    ])

    expect(context.assignments).toEqual([
      'EE-FLEET-991 -> Jürgen Tamm',
      'EE-FLEET-402 -> Unassigned',
      'EE-FLEET-118 -> Unassigned',
    ])
    expect(context).not.toHaveProperty('drivers')
    expect(context.telemetryMode).toBe('simulated')

    const instruction = buildSystemInstruction(context)
    expect(instruction).toContain(
      'Vehicle assignments in session context: EE-FLEET-991 -> Jürgen Tamm; EE-FLEET-402 -> Unassigned; EE-FLEET-118 -> Unassigned.',
    )
    expect(instruction).toContain('Do not infer a driver for a vehicle marked Unassigned.')
    expect(instruction).not.toContain('Assigned drivers in session context')
    expect(instruction).not.toContain('Vehicle inventory in session context')
    expect(instruction).toContain(FLEET_TELEMETRY_HONESTY_RULES)
  })

  it('keeps Unassigned vehicles Unassigned when another vehicle has a driver', () => {
    const context = buildFleetCopilotContext([
      { assetId: 'EE-FLEET-991', driverName: 'Unassigned' },
      { assetId: 'EE-FLEET-402', driverName: 'Mari Ots' },
      { assetId: 'EE-FLEET-118', driverName: 'Unassigned' },
    ])

    expect(context.assignments).toEqual([
      'EE-FLEET-991 -> Unassigned',
      'EE-FLEET-402 -> Mari Ots',
      'EE-FLEET-118 -> Unassigned',
    ])
    expect(context).not.toHaveProperty('drivers')
    expect(context.telemetryMode).toBe('simulated')

    const instruction = buildSystemInstruction(context)
    expect(instruction).toContain('EE-FLEET-991 -> Unassigned')
    expect(instruction).toContain('EE-FLEET-402 -> Mari Ots')
    expect(instruction).toContain('EE-FLEET-118 -> Unassigned')
    expect(instruction).not.toContain('Assigned drivers in session context: Mari Ots.')
  })

  it('does not invent Identity-panel names into fleet context', () => {
    const context = buildFleetCopilotContext([
      { assetId: 'EE-FLEET-991', driverName: 'Unassigned' },
    ])
    expect(context.assignments).toEqual(['EE-FLEET-991 -> Unassigned'])
    expect(context.assignments).not.toContain('Jürgen Tamm')
    expect(buildSystemInstruction(context)).not.toContain('Jürgen Tamm')
    expect(context).not.toHaveProperty('drivers')
  })

  it('uses an ASCII assignment separator in the Gemini payload', () => {
    const context = buildFleetCopilotContext([
      { assetId: 'EE-FLEET-991', driverName: 'Jürgen Tamm' },
      { assetId: 'EE-FLEET-402', driverName: 'Unassigned' },
    ])

    for (const assignment of context.assignments ?? []) {
      expect(assignment).toContain(' -> ')
      expect(assignment).not.toContain('→')
    }
    expect(buildSystemInstruction(context)).not.toContain('→')
    expect(geminiCopilotHelpersSource).toContain('${assetId} -> ${driverName}')
    expect(geminiCopilotHelpersSource).not.toContain('${assetId} → ${driverName}')
  })
})

describe('fleet telemetry honesty instructions', () => {
  it('explicitly marks telemetry as simulated and forbids live/real-time claims', () => {
    const context = buildFleetCopilotContext([
      { assetId: 'EE-FLEET-991', driverName: 'Unassigned' },
      { assetId: 'EE-FLEET-402', driverName: 'Unassigned' },
      { assetId: 'EE-FLEET-118', driverName: 'Unassigned' },
    ])
    const instruction = buildSystemInstruction(context)

    expect(context.telemetryMode).toBe('simulated')
    expect(instruction).toContain('simulated demo telemetry')
    expect(instruction).toContain('Do not claim real-time monitoring')
    expect(instruction).toContain('live GPS')
    expect(instruction).toContain('live connected status')
    expect(instruction).toContain('actual live tracking')
    expect(instruction).not.toMatch(/real-time virtual assistant/i)
    expect(instruction).toContain('EE-FLEET-991 -> Unassigned')
    expect(instruction).toContain('EE-FLEET-402 -> Unassigned')
    expect(instruction).toContain('EE-FLEET-118 -> Unassigned')
    expect(instruction).toContain('Vehicle assignments in session context:')
    expect(instruction).not.toContain('No drivers currently assigned to vehicles.')
    expect(instruction).not.toContain('Vehicle inventory in session context:')
  })

  it('ignores legacy telemetryMode and assignments in invoke bodies', () => {
    const result = parseCopilotRequest({
      prompt: 'Give me a summary of the current fleet.',
      context: {
        assignments: [
          'EE-FLEET-991 -> Unassigned',
          'EE-FLEET-402 -> Unassigned',
          'EE-FLEET-118 -> Unassigned',
        ],
        telemetryMode: 'simulated',
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        prompt: 'Give me a summary of the current fleet.',
      },
    })
  })

  it('keeps Edge helper honesty rules aligned with the client helper', () => {
    expect(edgeHelpersSource).toContain('FLEET_TELEMETRY_HONESTY_RULES')
    expect(edgeHelpersSource).toContain('simulated demo telemetry')
    expect(edgeHelpersSource).toContain('Do not claim real-time monitoring')
    expect(edgeHelpersSource).toContain("telemetryMode?: 'simulated'")
    expect(edgeHelpersSource).toContain('assignments?: string[]')
    expect(edgeHelpersSource).toContain('licenseExpiry?: string[]')
    expect(edgeHelpersSource).toContain('simulatedClearance?: string[]')
    expect(edgeHelpersSource).not.toContain('drivers?: string[]')
    expect(edgeHelpersSource).not.toMatch(/real-time virtual assistant/i)
  })
})

describe('server-trusted client invoke payload', () => {
  it('sends prompt plus demo telemetry only — never factual context', () => {
    expect(geminiCopilotSource).toContain('extractClientDemoTelemetry')
    expect(geminiCopilotSource).toContain('clientDemoTelemetry')
    expect(geminiCopilotSource).toContain('selectedAlert')
    expect(geminiCopilotSource).not.toMatch(/body:\s*\{[\s\S]*context:/)
    expect(edgeIndexSource).toContain('buildTrustedCopilotContextForUser')
    expect(edgeIndexSource).toContain('scopeTrustedContextToSelectedAlert')
    expect(edgeIndexSource).not.toContain('parsed.value.context')
  })
})

describe('client source exposure guards', () => {
  it('G9 — Gemini API key never appears in client bundle sources', () => {
    expect(dashboardLayoutSource).not.toMatch(/generativelanguage\.googleapis\.com.*\?key=/)
    expect(dashboardLayoutSource).not.toContain('VITE_GEMINI_API_KEY')
    expect(dashboardLayoutSource).not.toContain('GEMINI_API_KEY')
    expect(geminiCopilotSource).not.toMatch(/generativelanguage\.googleapis\.com/)
    expect(geminiCopilotSource).not.toContain('VITE_GEMINI_API_KEY')
    expect(geminiCopilotSource).not.toContain('GEMINI_API_KEY')
    expect(geminiCopilotHelpersSource).not.toContain('VITE_GEMINI_API_KEY')
    expect(geminiCopilotSource).toContain("functions.invoke('gemini-copilot'")
    // Edge keeps the key server-side only; client must not embed it.
    expect(edgeIndexSource).toContain("Deno.env.get('GEMINI_API_KEY')")
    expect(edgeIndexSource).not.toMatch(/console\.(log|info|debug|error).*GEMINI/)
    expect(edgeIndexSource).not.toMatch(/console\.(log|info|debug|error).*Authorization/)
  })

  it('G10 — existing OCR functionality module remains intact', () => {
    expect(ocrServiceSource).toContain('recognizeDocumentText')
    expect(ocrServiceSource).toContain('tesseract.js')
    expect(ocrServiceSource).toContain('normalizeOcrConfidence')
  })

  it('does not send Identity-panel driverData.fullName as fleet driver context', () => {
    expect(dashboardLayoutSource).toContain('createFleetSnapshot(currentAssets, currentDrivers)')
    expect(dashboardLayoutSource).toContain('fleetAssetsRef.current')
    expect(dashboardLayoutSource).not.toContain(
      'buildFleetCopilotContext(fleetAssets, driverRecords)',
    )
    expect(dashboardLayoutSource).not.toContain(
      'drivers: driverData?.fullName ? [driverData.fullName] : []',
    )
    expect(dashboardLayoutSource).not.toMatch(
      /fetchGeminiCopilotResponse\([\s\S]{0,200}driverData\.fullName/,
    )
    expect(fleetSnapshotSource).toContain('buildFleetCopilotContext')
    expect(fleetSnapshotSource).toContain('fullName: driver.fullName')
    expect(fleetSnapshotSource).toContain('expiryDate: driver.expiryDate')
    expect(fleetSnapshotSource).not.toContain('personalCode')
    expect(dashboardLayoutSource).not.toMatch(
      /answerCopilotQuery\([\s\S]{0,400}membershipRole/,
    )
    expect(geminiCopilotHelpersSource).toContain('buildFleetCopilotContext')
    expect(geminiCopilotHelpersSource).toContain('UNASSIGNED_DRIVER_LABEL')
    expect(geminiCopilotHelpersSource).toContain("telemetryMode: 'simulated'")
    expect(geminiCopilotHelpersSource).not.toContain('Assigned drivers in session context')
    expect(geminiCopilotHelpersSource).toContain('Vehicle assignments in session context')
    expect(edgeHelpersSource).toContain('Vehicle assignments in session context')
    expect(edgeHelpersSource).not.toContain('Assigned drivers in session context')
  })

  it('keeps vehicle asset IDs and Copilot invoke wiring intact', () => {
    expect(geminiCopilotSource).toContain("functions.invoke('gemini-copilot'")
    expect(dashboardLayoutSource).toContain('answerCopilotQuery')
    expect(geminiCopilotSource).toContain('resolveCopilotFastPath')
    expect(geminiCopilotHelpersSource).toContain('asset.assetId.trim()')
    expect(edgeIndexSource).toContain('fetchGeminiUpstreamWithRetry')
  })
})

describe('Copilot quick-prompt grounding', () => {
  const orgAssets = [
    {
      assetId: 'EE-FLEET-991',
      driverName: 'Jürgen Tamm',
      statusLabel: 'OPTIMAL CLEARANCE',
    },
    {
      assetId: 'EE-FLEET-118',
      driverName: 'Unassigned',
      statusLabel: 'CRITICAL WARNING',
    },
  ]

  const adminOrFmDrivers = [
    {
      fullName: 'Jürgen Tamm',
      expiryDate: '12 / 11 / 2026',
      personalCode: '39001010006',
      licenseNumber: 'EE-B0984122',
    },
    {
      fullName: 'Mari Ots',
      expiryDate: '01/01/2020',
      personalCode: '49001010007',
      licenseNumber: 'EE-B0000001',
    },
  ]

  it('Admin/Fleet Manager expiry uses RLS-visible names and expiry_date only — never PII', () => {
    const context = buildFleetCopilotContext(orgAssets, adminOrFmDrivers)

    expect(context.licenseExpiry).toEqual([
      'Jürgen Tamm -> 12 / 11 / 2026',
      'Mari Ots -> expired',
    ])
    expect(JSON.stringify(context)).not.toContain('39001010006')
    expect(JSON.stringify(context)).not.toContain('EE-B0984122')
    expect(JSON.stringify(context)).not.toContain('49001010007')
    expect(JSON.stringify(context)).not.toContain('EE-B0000001')
    expect(context).not.toHaveProperty('personalCode')
    expect(context).not.toHaveProperty('licenseNumber')
    expect(context).not.toHaveProperty('role')
  })

  it('Driver Copilot expiry includes only the already-scoped own registry row', () => {
    const ownVehicle = [
      {
        assetId: 'EE-FLEET-991',
        driverName: 'Jürgen Tamm',
        statusLabel: 'OPTIMAL CLEARANCE',
      },
    ]
    const ownDriver = [
      {
        fullName: 'Jürgen Tamm',
        expiryDate: '12 / 11 / 2026',
        personalCode: '39001010006',
        licenseNumber: 'EE-B0984122',
      },
    ]

    const context = buildFleetCopilotContext(ownVehicle, ownDriver)
    expect(context.licenseExpiry).toEqual(['Jürgen Tamm -> 12 / 11 / 2026'])
    expect(context.assignments).toEqual(['EE-FLEET-991 -> Jürgen Tamm'])
    expect(context.simulatedClearance).toEqual(['EE-FLEET-991 -> OPTIMAL CLEARANCE'])
    expect(JSON.stringify(context)).not.toContain('Mari Ots')
    expect(JSON.stringify(context)).not.toContain('EE-FLEET-118')
    expect(JSON.stringify(context)).not.toContain('39001010006')
    expect(JSON.stringify(context)).not.toContain('EE-B0984122')
  })

  it('unassigned Driver session does not invent other drivers or vehicles', () => {
    const context = buildFleetCopilotContext([], [])
    expect(context.assignments).toEqual([])
    expect(context.licenseExpiry).toBeUndefined()
    expect(context.simulatedClearance).toBeUndefined()
    expect(buildSystemInstruction(context)).not.toContain('Jürgen Tamm')
    expect(buildSystemInstruction(context)).not.toContain('EE-FLEET-118')
  })

  it('does not invent expiry rows when expiry_date is unavailable', () => {
    const context = buildFleetCopilotContext(orgAssets, [
      { fullName: 'Jürgen Tamm', expiryDate: '—' },
      { fullName: '  ', expiryDate: '01/01/2020' },
    ])
    expect(context.licenseExpiry).toBeUndefined()
  })

  it('labels simulatedClearance as SIMULATED and never as live maintenance', () => {
    const context = buildFleetCopilotContext(orgAssets, [])
    expect(context.simulatedClearance).toEqual([
      'EE-FLEET-991 -> OPTIMAL CLEARANCE',
      'EE-FLEET-118 -> CRITICAL WARNING',
    ])
    const instruction = buildSystemInstruction(context)
    expect(instruction).toContain('SIMULATED demo telemetry, not live maintenance or government data')
    expect(instruction).toContain('EE-FLEET-118 -> CRITICAL WARNING')
    expect(instruction).toContain(COPILOT_QUICK_PROMPT_RULES)
  })

  it('accepts only demo telemetry whitelist while ignoring PII and role fields', () => {
    const result = parseCopilotRequest({
      prompt: 'Show drivers with expired licenses',
      role: 'admin',
      organization_id: 'org-1',
      context: {
        assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
        licenseExpiry: ['Jürgen Tamm -> 12 / 11 / 2026', 'Mari Ots -> expired'],
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
        telemetryMode: 'simulated',
        personalCode: '39001010006',
        licenseNumber: 'EE-B0984122',
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        prompt: 'Show drivers with expired licenses',
        clientDemoTelemetry: {
          simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
        },
      },
    })
  })

  it('grounds all four Quick Sample Prompts in system instructions', () => {
    const context = buildFleetCopilotContext(orgAssets, adminOrFmDrivers)
    const instruction = buildSystemInstruction(context)

    expect(instruction).toContain('License expiry in session context:')
    expect(instruction).toContain('Use only this list for expired-license questions')
    expect(instruction).toContain('For expired licenses, use only licenseExpiry context')
    expect(instruction).toContain(
      'simulatedClearance may be used only as simulated demo telemetry and must be labeled simulated',
    )
    expect(instruction).toContain(FLEET_SNAPSHOT_AUTHORITY_RULES)
    expect(instruction).toContain('The supplied fleet snapshot is authoritative for this response')
    expect(instruction).toContain('If the snapshot says CRITICAL WARNING, report CRITICAL WARNING')
    expect(instruction).toContain('If it says OPTIMAL CLEARANCE, report OPTIMAL CLEARANCE')
    expect(instruction).toContain('If asked who is high risk, state that driver risk scores are not available')
    expect(instruction).toContain('Never invent risk scores')
    expect(instruction).toContain(
      'Never treat simulated vehicle clearance as a driver risk ranking',
    )
    expect(instruction).toContain('Vehicle assignments in session context:')
    expect(instruction).toContain('SIMULATED demo telemetry')

    expect(dashboardLayoutSource).toContain('COPILOT_SUGGESTED_PROMPTS')
    expect(dashboardLayoutSource).toContain('DemoGuidePanel')
    expect(demoExperienceSource).toContain('Which vehicle is assigned to Jürgen?')
    expect(demoExperienceSource).toContain('Explain the current fleet health.')
  })

  it('keeps Edge parse/instruction semantics aligned for trusted context', () => {
    expect(edgeHelpersSource).toContain('COPILOT_QUICK_PROMPT_RULES')
    expect(edgeHelpersSource).toContain('No driver risk scores exist in this demo')
    expect(edgeHelpersSource).toContain('License expiry in session context:')
    expect(edgeHelpersSource).toContain('Simulated vehicle clearance in session context')
    expect(edgeHelpersSource).toContain('Invalid simulatedClearance demo telemetry.')
    expect(edgeHelpersSource).toContain('SERVER_TRUSTED_CONTEXT_RULES')
    expect(edgeHelpersSource).toContain('CLIENT_DEMO_TELEMETRY_RULES')
    expect(edgeHelpersSource).toContain('FLEET_SNAPSHOT_AUTHORITY_RULES')
    expect(edgeIndexSource).toContain('buildTrustedCopilotContextForUser')
    expect(edgeIndexSource).not.toContain('parsed.value.context')
    expect(edgeIndexSource).toContain('fetchGeminiUpstreamWithRetry')
  })
})

describe('authoritative fleet snapshot context', () => {
  const fleetSnapshotAssets = [
    { assetId: 'EE-FLEET-402', driverName: 'Unassigned', statusLabel: 'OPTIMAL CLEARANCE' },
    { assetId: 'EE-FLEET-118', driverName: 'Unassigned', statusLabel: 'CRITICAL WARNING' },
    { assetId: 'EE-FLEET-991', driverName: 'Jürgen Tamm', statusLabel: 'OPTIMAL CLEARANCE' },
  ]

  it('preserves exact assignments and simulated statuses from fleetAssets', () => {
    const context = buildFleetCopilotContext(fleetSnapshotAssets, [])

    expect(context.assignments).toEqual([
      'EE-FLEET-402 -> Unassigned',
      'EE-FLEET-118 -> Unassigned',
      'EE-FLEET-991 -> Jürgen Tamm',
    ])
    expect(context.simulatedClearance).toEqual([
      'EE-FLEET-402 -> OPTIMAL CLEARANCE',
      'EE-FLEET-118 -> CRITICAL WARNING',
      'EE-FLEET-991 -> OPTIMAL CLEARANCE',
    ])
    expect(context.telemetryMode).toBe('simulated')
  })

  it('keeps CRITICAL WARNING in generated system instruction for fleet reports', () => {
    const context = buildFleetCopilotContext(fleetSnapshotAssets, [])
    const instruction = buildSystemInstruction(context)

    expect(instruction).toContain('EE-FLEET-118 -> CRITICAL WARNING')
    expect(instruction).toContain('EE-FLEET-402 -> Unassigned')
    expect(instruction).toContain('EE-FLEET-991 -> Jürgen Tamm')
    expect(instruction).toContain(FLEET_SNAPSHOT_AUTHORITY_RULES)
    expect(instruction).toContain('Never claim all vehicles are optimal if any vehicle has CRITICAL WARNING')
  })

  it('fleet report context includes total vehicles via assignments and clearance rows', () => {
    const context = buildFleetCopilotContext(fleetSnapshotAssets, [
      { fullName: 'Jürgen Tamm', expiryDate: '12 / 11 / 2026' },
    ])
    const body = buildGeminiRequestBody("Generate today's fleet report", context)

    expect(context.assignments).toHaveLength(3)
    expect(context.simulatedClearance).toHaveLength(3)
    expect(context.licenseExpiry).toEqual(['Jürgen Tamm -> 12 / 11 / 2026'])
    expect(JSON.stringify(body)).toContain('EE-FLEET-118 -> CRITICAL WARNING')
    expect(JSON.stringify(body)).not.toContain('personalCode')
    expect(JSON.stringify(body)).not.toContain('licenseNumber')
  })

  it('DashboardLayout builds context from request-time fleet refs', () => {
    expect(dashboardLayoutSource).toContain('createFleetSnapshot(currentAssets, currentDrivers)')
    expect(dashboardLayoutSource).toContain('fleetAssetsRef.current')
    expect(dashboardLayoutSource).not.toMatch(
      /buildFleetCopilotContext\(\s*\[/,
    )
  })
})

describe('Copilot quick-prompt local fast paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the fixed high-risk response without calling Gemini', async () => {
    expect(resolveCopilotFastPath(HIGH_RISK_PROMPT, {})).toBe(
      HIGH_RISK_FAST_PATH_RESPONSE,
    )

    await expect(
      answerCopilotQuery('Which drivers are high risk?', {
        assignments: ['EE-FLEET-118 -> CRITICAL WARNING'],
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
      }),
    ).resolves.toBe('Driver risk scores are not available in this demo.')

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('builds expired-license answers only from licenseExpiry and never PII', async () => {
    const driversWithPii = [
      {
        fullName: 'Jürgen Tamm',
        expiryDate: '12 / 11 / 2026',
        personalCode: '39001010006',
        licenseNumber: 'EE-B0984122',
      },
      {
        fullName: 'Mari Ots',
        expiryDate: '01/01/2020',
        personalCode: '49001010007',
        licenseNumber: 'EE-B0000001',
      },
    ]
    const context = buildFleetCopilotContext(
      [{ assetId: 'EE-FLEET-991', driverName: 'Jürgen Tamm', statusLabel: 'OPTIMAL CLEARANCE' }],
      driversWithPii,
    )

    const response = await answerCopilotQuery(EXPIRED_LICENSES_PROMPT, context)
    expect(response).toBe('Mari Ots has an expired license.')
    expect(response).not.toContain('39001010006')
    expect(response).not.toContain('EE-B0984122')
    expect(response).not.toContain('49001010007')
    expect(response).not.toContain('EE-B0000001')
    expect(JSON.stringify(context)).not.toContain('39001010006')
    expect(JSON.stringify(context)).not.toContain('EE-B0984122')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('returns the unavailable expiry message when licenseExpiry is missing', async () => {
    await expect(
      answerCopilotQuery(EXPIRED_LICENSES_PROMPT, {
        assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
      }),
    ).resolves.toBe(LICENSE_EXPIRY_UNAVAILABLE_RESPONSE)

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('still sends the maintenance prompt to Gemini', async () => {
    invokeMock.mockResolvedValue({
      data: { text: 'Simulated clearance shows EE-FLEET-118 as CRITICAL WARNING.' },
      error: null,
    })

    await expect(
      answerCopilotQuery('Which vehicles require maintenance?', {
        assignments: ['EE-FLEET-118 -> Unassigned'],
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
        telemetryMode: 'simulated',
      }),
    ).resolves.toBe('Simulated clearance shows EE-FLEET-118 as CRITICAL WARNING.')

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('gemini-copilot', {
      body: {
        prompt: 'Which vehicles require maintenance?',
        clientDemoTelemetry: {
          simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
        },
      },
      timeout: COPILOT_INVOKE_TIMEOUT_MS,
    })
  })

  it('does not invent risk from simulated vehicle clearance on the high-risk path', () => {
    const response = resolveCopilotFastPath(HIGH_RISK_PROMPT, {
      simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
    })
    expect(response).toBe(HIGH_RISK_FAST_PATH_RESPONSE)
    expect(response).not.toContain('CRITICAL WARNING')
    expect(response).not.toContain('EE-FLEET-118')
  })
})

