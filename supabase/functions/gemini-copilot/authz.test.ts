import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  authorizeAuthenticatedMember,
  buildCorsHeaders,
  buildGeminiUpstreamHeaders,
  buildGeminiUpstreamUrl,
  computeGeminiBackoffMs,
  consumeRateLimit,
  COPILOT_RATE_LIMIT_MAX,
  COPILOT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_ALLOWED_ORIGINS,
  extractBearerToken,
  fetchGeminiUpstreamWithRetry,
  FLEET_SNAPSHOT_AUTHORITY_RULES,
  GEMINI_API_KEY_HEADER,
  GEMINI_ATTEMPT_BUDGET_MS,
  GEMINI_GENERATE_URL,
  GEMINI_MODEL,
  GEMINI_MAX_ATTEMPTS,
  GEMINI_MAX_TOTAL_BACKOFF_MS,
  GEMINI_MAX_TRANSIENT_RETRIES,
  GEMINI_RETRY_BASE_DELAY_MS,
  GEMINI_RETRY_JITTER_MS,
  GEMINI_RETRY_MAX_DELAY_MS,
  GEMINI_UPSTREAM_TIMEOUT_MS,
  isOriginAllowed,
  isTransientFetchError,
  isTransientGeminiHttpStatus,
  parseCopilotRequest,
  parseRetryAfterMs,
  rateLimitExceededResponse,
  resolveAllowedOrigins,
  resolveGeminiRetryDelayMs,
  safeCopilotErrorMessage,
  upstreamFailureResponse,
  type GeminiUpstreamFetchResult,
  type RateLimitStore,
} from './helpers'

const functionDir = dirname(fileURLToPath(import.meta.url))
const indexSource = readFileSync(join(functionDir, 'index.ts'), 'utf8')
const helpersSource = readFileSync(join(functionDir, 'helpers.ts'), 'utf8')

const FOUNDING_USER_ID = 'ca5316b3-8872-45f4-9617-06d758f19f49'

describe('extractBearerToken', () => {
  it('G1 — missing Authorization yields no token', () => {
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken(undefined)).toBeNull()
    expect(extractBearerToken('')).toBeNull()
    expect(extractBearerToken('Basic abc')).toBeNull()
  })

  it('extracts a Bearer token', () => {
    expect(extractBearerToken('Bearer user-access-token')).toBe('user-access-token')
    expect(extractBearerToken('  bearer   user-access-token  ')).toBe('user-access-token')
  })
})

describe('authorizeAuthenticatedMember', () => {
  it('G1 — missing Authorization → 401', async () => {
    const getUser = vi.fn()
    const hasOrganizationMembership = vi.fn()

    await expect(
      authorizeAuthenticatedMember(null, { getUser, hasOrganizationMembership }),
    ).resolves.toEqual({
      ok: false,
      status: 401,
      message: 'Unauthorized.',
    })

    expect(getUser).not.toHaveBeenCalled()
    expect(hasOrganizationMembership).not.toHaveBeenCalled()
  })

  it('G2 — invalid JWT (getUser fails) → 401', async () => {
    const result = await authorizeAuthenticatedMember('Bearer invalid-jwt', {
      getUser: async () => ({ userId: null }),
      hasOrganizationMembership: async () => true,
    })

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Unauthorized.',
    })
  })

  it('G3 — anon JWT (no authenticated user) → 401', async () => {
    const hasOrganizationMembership = vi.fn(async () => true)

    const result = await authorizeAuthenticatedMember('Bearer anon-jwt', {
      getUser: async () => ({ userId: null }),
      hasOrganizationMembership,
    })

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Unauthorized.',
    })
    expect(hasOrganizationMembership).not.toHaveBeenCalled()
  })

  it('G4 — authenticated user without organization membership → 403', async () => {
    const result = await authorizeAuthenticatedMember('Bearer user-jwt', {
      getUser: async () => ({ userId: 'user-without-org' }),
      hasOrganizationMembership: async () => false,
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      message: 'Forbidden.',
    })
  })

  it('G5 — founding authenticated member → Gemini authorization allowed', async () => {
    const hasOrganizationMembership = vi.fn(async (userId: string) => {
      return userId === FOUNDING_USER_ID
    })

    const result = await authorizeAuthenticatedMember('Bearer founding-user-jwt', {
      getUser: async () => ({ userId: FOUNDING_USER_ID }),
      hasOrganizationMembership,
    })

    expect(result).toEqual({
      ok: true,
      userId: FOUNDING_USER_ID,
    })
    expect(hasOrganizationMembership).toHaveBeenCalledWith(FOUNDING_USER_ID)
  })

  it('G6 — client-supplied fake organization_id cannot bypass membership', async () => {
    const body = {
      prompt: 'Fleet status?',
      organization_id: '00000000-0000-0000-0000-000000000099',
      context: { drivers: [], vehicles: [] },
    }

    // Authz path does not accept body fields — membership still false.
    const authz = await authorizeAuthenticatedMember('Bearer user-jwt', {
      getUser: async () => ({ userId: 'authenticated-non-member' }),
      hasOrganizationMembership: async () => false,
    })

    expect(authz).toEqual({
      ok: false,
      status: 403,
      message: 'Forbidden.',
    })
    // Body may parse for prompt/context, but org id is not part of CopilotContext auth.
    expect(parseCopilotRequest(body).ok).toBe(true)
    expect(helpersSource).not.toMatch(/body\.organization_id|record\.organization_id/)
    // Membership uses verified user_id only — never request-body organization_id.
    expect(indexSource).toContain(".eq('user_id', userId)")
    expect(indexSource).not.toContain('body.organization_id')
    expect(indexSource).not.toContain("record.organization_id")
  })

  it('G7 — client-supplied fake role cannot bypass membership', async () => {
    const authz = await authorizeAuthenticatedMember('Bearer user-jwt', {
      getUser: async () => ({ userId: 'authenticated-non-member' }),
      hasOrganizationMembership: async () => false,
    })

    expect(authz.ok).toBe(false)
    if (!authz.ok) {
      expect(authz.status).toBe(403)
    }
    expect(indexSource).not.toContain('body.role')
    expect(indexSource).not.toContain('record.role')
    expect(helpersSource).not.toMatch(/selectedRole|fleet-manager/)
  })

  it('G8 — client-supplied driver_id/vehicle_id cannot bypass membership', async () => {
    const body = {
      prompt: 'Where is the truck?',
      driver_id: 'ba05b0eb-6542-45a0-b350-9bf5ae2d35c7',
      vehicle_id: 'b6160f57-792b-4e27-8c5b-4693d141511a',
      context: {
        drivers: ['Forged Driver'],
        vehicles: ['FORGED-VEHICLE'],
      },
    }

    const authz = await authorizeAuthenticatedMember('Bearer user-jwt', {
      getUser: async () => ({ userId: 'authenticated-non-member' }),
      hasOrganizationMembership: async () => false,
    })

    expect(authz).toEqual({
      ok: false,
      status: 403,
      message: 'Forbidden.',
    })
    expect(parseCopilotRequest(body).ok).toBe(true)
    expect(indexSource).not.toContain('body.driver_id')
    expect(indexSource).not.toContain('body.vehicle_id')
    expect(indexSource).not.toContain('record.driver_id')
    expect(indexSource).not.toContain('record.vehicle_id')
  })
})

describe('CORS allowlist', () => {
  it('allows http://localhost:5173 by default', () => {
    const allowed = resolveAllowedOrigins(undefined)
    expect(allowed).toContain('http://localhost:5173')
    expect(DEFAULT_ALLOWED_ORIGINS).toContain('http://localhost:5173')
    expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(true)

    const headers = buildCorsHeaders('http://localhost:5173', allowed)
    expect(headers).toEqual({
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    })
  })

  it('rejects disallowed origins and never emits *', () => {
    const allowed = resolveAllowedOrigins('https://app.sovereignshield.example')
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false)
    expect(buildCorsHeaders('https://evil.example', allowed)).toBeNull()
    expect(buildCorsHeaders('*', allowed)).toBeNull()
    expect(helpersSource).not.toContain("Access-Control-Allow-Origin': '*'")
    expect(indexSource).not.toContain("Access-Control-Allow-Origin': '*'")
    expect(indexSource).not.toContain('Access-Control-Allow-Origin: *')
  })

  it('merges explicit production origins from COPILOT_ALLOWED_ORIGINS', () => {
    const allowed = resolveAllowedOrigins(
      'https://app.sovereignshield.example, https://staging.sovereignshield.example',
    )
    expect(allowed).toEqual([
      'http://localhost:5173',
      'https://app.sovereignshield.example',
      'https://staging.sovereignshield.example',
    ])
    expect(buildCorsHeaders('https://app.sovereignshield.example', allowed)?.[
      'Access-Control-Allow-Origin'
    ]).toBe('https://app.sovereignshield.example')
  })
})

describe('per-user rate limiting', () => {
  it('returns 429 after the V1 limit for a verified user', () => {
    const store: RateLimitStore = new Map()
    const now = 1_700_000_000_000

    for (let i = 0; i < COPILOT_RATE_LIMIT_MAX; i += 1) {
      expect(consumeRateLimit(FOUNDING_USER_ID, now, store).allowed).toBe(true)
    }

    const blocked = consumeRateLimit(FOUNDING_USER_ID, now, store)
    expect(blocked).toEqual({
      allowed: false,
      status: 429,
      message: 'Rate limit exceeded. Please try again later.',
    })
    expect(rateLimitExceededResponse()).toEqual({
      status: 429,
      body: {
        error: 'Rate limit exceeded. Please try again later.',
        failureKind: 'edge_error',
      },
    })
    expect(safeCopilotErrorMessage(429)).toBe(
      'Rate limit exceeded. Please try again later.',
    )
  })

  it('keys rate limit by verified user id only (no client identity bypass)', () => {
    const store: RateLimitStore = new Map()
    const now = 1_700_000_000_000
    const forgedClientUserId = '00000000-0000-0000-0000-000000000099'

    for (let i = 0; i < COPILOT_RATE_LIMIT_MAX; i += 1) {
      expect(consumeRateLimit(FOUNDING_USER_ID, now, store).allowed).toBe(true)
    }

    expect(consumeRateLimit(FOUNDING_USER_ID, now, store).allowed).toBe(false)
    // A different verified user still has its own budget.
    expect(consumeRateLimit('other-verified-member', now, store).allowed).toBe(true)

    // Client-supplied identity fields are never consulted by the limiter helpers/index.
    expect(helpersSource).not.toMatch(/body\.user_id|record\.user_id/)
    expect(indexSource).not.toContain('body.user_id')
    expect(indexSource).not.toContain('record.user_id')
    expect(indexSource).toContain('consumeRateLimit(authz.userId')
    expect(indexSource).not.toContain(`consumeRateLimit(${forgedClientUserId}`)
    expect(indexSource).not.toContain('consumeRateLimit(body')
  })

  it('resets after the V1 window elapses', () => {
    const store: RateLimitStore = new Map()
    const now = 1_700_000_000_000

    for (let i = 0; i < COPILOT_RATE_LIMIT_MAX; i += 1) {
      consumeRateLimit(FOUNDING_USER_ID, now, store)
    }
    expect(consumeRateLimit(FOUNDING_USER_ID, now, store).allowed).toBe(false)
    expect(
      consumeRateLimit(
        FOUNDING_USER_ID,
        now + COPILOT_RATE_LIMIT_WINDOW_MS,
        store,
      ).allowed,
    ).toBe(true)
  })
})

describe('Gemini API key transport', () => {
  it('keeps the API key out of the upstream URL and uses x-goog-api-key', () => {
    const url = buildGeminiUpstreamUrl()
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    )
    expect(url).not.toContain('key=')
    expect(url).not.toContain('test-server-secret')

    const headers = buildGeminiUpstreamHeaders('test-server-secret')
    expect(headers[GEMINI_API_KEY_HEADER]).toBe('test-server-secret')
    expect(headers['Content-Type']).toBe('application/json')
    expect(helpersSource).not.toMatch(/\?key=/)
    expect(indexSource).not.toMatch(/\?key=/)
    expect(indexSource).toContain('fetchGeminiUpstreamWithRetry')
    expect(helpersSource).toContain('buildGeminiUpstreamHeaders(apiKey)')
    expect(helpersSource).toContain('buildGeminiUpstreamUrl()')
    expect(helpersSource).toContain('GEMINI_UPSTREAM_TIMEOUT_MS = 40000')
    expect(helpersSource).toContain('AbortSignal.timeout(remainingMs)')
    expect(helpersSource).not.toContain('generationConfig')
    expect(helpersSource).not.toContain('maxOutputTokens')
    expect(helpersSource).not.toContain('thinkingConfig')
    expect(helpersSource).not.toContain('thinkingBudget')
    expect(helpersSource).toContain("GEMINI_MODEL = 'gemini-3.6-flash'")
    expect(helpersSource).toContain('licenseExpiry?: string[]')
    expect(helpersSource).toContain('simulatedClearance?: string[]')
    expect(helpersSource).toContain('COPILOT_QUICK_PROMPT_RULES')
    expect(helpersSource).not.toContain('personalCode')
    expect(helpersSource).not.toContain('licenseNumber')
  })
})

describe('pinned Gemini model', () => {
  it('targets the stable gemini-3.6-flash model on the only Gemini request path', () => {
    expect(GEMINI_MODEL).toBe('gemini-3.6-flash')
    expect(GEMINI_GENERATE_URL).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    )
    expect(buildGeminiUpstreamUrl()).toBe(GEMINI_GENERATE_URL)
  })

  it('leaves no floating model alias in the Edge sources', () => {
    expect(helpersSource).not.toContain('gemini-flash-latest')
    expect(helpersSource).not.toMatch(/gemini-[a-z0-9.]*-latest/)
    expect(indexSource).not.toMatch(/gemini-[a-z0-9.]*-latest/)

    // Declared once; every request derives its URL from that single constant.
    expect(helpersSource.match(/'gemini-3\.6-flash'/g)).toHaveLength(1)
    expect(helpersSource).toContain('models/${GEMINI_MODEL}:generateContent')
  })

  it('keeps the retry policy and request-time snapshot unchanged under the pinned model', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Fleet is stable.' }] } }] }),
          { status: 200 },
        ),
      )
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const result = await fetchGeminiUpstreamWithRetry(
      'test-key',
      'Fleet report?',
      {
        assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
        simulatedClearance: ['EE-FLEET-118 -> CRITICAL WARNING'],
        telemetryMode: 'simulated',
        snapshotVersion: 7,
        snapshotCapturedAt: '2026-02-01T10:00:00.000Z',
      },
      { fetchFn, sleepFn, randomFn: () => 0 },
    )

    // Retry policy is untouched by the model pin.
    expect(result.ok).toBe(true)
    expect(GEMINI_MAX_ATTEMPTS).toBe(3)
    expect(GEMINI_MAX_TRANSIENT_RETRIES).toBe(2)
    expect(GEMINI_UPSTREAM_TIMEOUT_MS).toBe(40000)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledWith(GEMINI_RETRY_BASE_DELAY_MS)

    // Every attempt — initial and retry — goes to the pinned model.
    for (const [requestUrl] of fetchFn.mock.calls) {
      expect(requestUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      )
    }

    // The request-time snapshot still reaches Gemini and is reused verbatim on the retry.
    const firstBody = String(fetchFn.mock.calls[0][1]?.body)
    const retryBody = String(fetchFn.mock.calls[1][1]?.body)
    expect(firstBody).toContain(
      'Fleet snapshot metadata: snapshotVersion=7, snapshotCapturedAt=2026-02-01T10:00:00.000Z',
    )
    expect(firstBody).toContain('EE-FLEET-991 -> Jürgen Tamm')
    expect(firstBody).toContain('EE-FLEET-118 -> CRITICAL WARNING')
    expect(firstBody).toContain('simulated')
    expect(retryBody).toBe(firstBody)

    // Model pin adds no generation/thinking knobs to the payload.
    expect(Object.keys(JSON.parse(firstBody))).toEqual(['contents', 'systemInstruction'])
  })
})

describe('Edge Function authorization wiring', () => {
  it('requires getUser + organization_members before Gemini', () => {
    expect(indexSource).toContain('auth.getUser(bearer)')
    expect(indexSource).toContain(".from('organization_members')")
    expect(indexSource).toContain(".eq('user_id', userId)")
    expect(indexSource).toContain('authorizeAuthenticatedMember')
    expect(indexSource).toContain('GEMINI_API_KEY')

    const authzCallPos = indexSource.indexOf('await authorizeAuthenticatedMember(')
    const rateLimitPos = indexSource.indexOf('consumeRateLimit(authz.userId')
    const geminiKeyPos = indexSource.indexOf("Deno.env.get('GEMINI_API_KEY')")
    const upstreamCallPos = indexSource.indexOf('await fetchGeminiUpstreamWithRetry(')
    expect(authzCallPos).toBeGreaterThan(-1)
    expect(rateLimitPos).toBeGreaterThan(authzCallPos)
    expect(geminiKeyPos).toBeGreaterThan(rateLimitPos)
    expect(upstreamCallPos).toBeGreaterThan(geminiKeyPos)
  })

  it('does not use service_role for membership authorization', () => {
    expect(indexSource).not.toMatch(/SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE/)
    expect(helpersSource).not.toMatch(/SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE/)
    expect(indexSource).toContain('SUPABASE_ANON_KEY')
    expect(indexSource).not.toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")
  })

  it('wires strict CORS allowlist headers (no wildcard)', () => {
    expect(indexSource).toContain('buildCorsHeaders')
    expect(indexSource).toContain('COPILOT_ALLOWED_ORIGINS')
    expect(helpersSource).toContain('authorization, x-client-info, apikey, content-type')
    expect(indexSource).not.toContain("Access-Control-Allow-Origin': '*'")
    expect(helpersSource).not.toContain("Access-Control-Allow-Origin': '*'")
  })

  it('uses generic auth error messages', () => {
    expect(safeCopilotErrorMessage(401)).toBe('Unauthorized.')
    expect(safeCopilotErrorMessage(403)).toBe('Forbidden.')
  })

  it('preserves authenticated Copilot success path wiring', () => {
    expect(indexSource).toContain('successResponse(text)')
    expect(indexSource).toContain('extractGeminiAssistantText')
    expect(indexSource).toContain('parseCopilotRequest(body)')
    expect(indexSource).toContain('fetchGeminiUpstreamWithRetry')
  })
})

describe('Gemini upstream transient retry', () => {
  it('classifies transient HTTP statuses for retry eligibility', () => {
    expect(isTransientGeminiHttpStatus(429)).toBe(true)
    expect(isTransientGeminiHttpStatus(500)).toBe(true)
    expect(isTransientGeminiHttpStatus(502)).toBe(true)
    expect(isTransientGeminiHttpStatus(503)).toBe(true)
    expect(isTransientGeminiHttpStatus(504)).toBe(true)
    expect(isTransientGeminiHttpStatus(400)).toBe(false)
    expect(isTransientGeminiHttpStatus(401)).toBe(false)
    expect(isTransientGeminiHttpStatus(403)).toBe(false)
    expect(isTransientGeminiHttpStatus(404)).toBe(false)
  })

  it('treats network fetch errors as transient but not timeouts', () => {
    expect(isTransientFetchError(new TypeError('Failed to fetch'))).toBe(true)
    const abort = new DOMException('Aborted', 'AbortError')
    expect(isTransientFetchError(abort)).toBe(false)
    const timeout = new DOMException('Timed out', 'TimeoutError')
    expect(isTransientFetchError(timeout)).toBe(false)
  })

  it('parses Retry-After seconds and caps to remaining budget', () => {
    expect(parseRetryAfterMs('2', 5000)).toBe(2000)
    expect(parseRetryAfterMs('60', 3000)).toBe(3000)
    expect(parseRetryAfterMs(null, 5000)).toBe(0)
    expect(parseRetryAfterMs('invalid', 5000)).toBe(0)
  })

  it('computes bounded exponential backoff with jitter', () => {
    expect(computeGeminiBackoffMs(1, 0)).toBe(500)
    expect(computeGeminiBackoffMs(2, 0)).toBe(1000)
    expect(computeGeminiBackoffMs(1, 1)).toBe(750)
    expect(computeGeminiBackoffMs(2, 1)).toBe(1250)

    // Jitter must actually vary the delay, and every step stays bounded.
    expect(computeGeminiBackoffMs(1, 0.5)).toBeGreaterThan(computeGeminiBackoffMs(1, 0))
    for (const retryNumber of [1, 2, 3, 9]) {
      const delay = computeGeminiBackoffMs(retryNumber, 1)
      expect(delay).toBeGreaterThanOrEqual(GEMINI_RETRY_BASE_DELAY_MS)
      expect(delay).toBeLessThanOrEqual(GEMINI_RETRY_MAX_DELAY_MS + GEMINI_RETRY_JITTER_MS)
    }
  })

  it('never lets backoff plus Retry-After exceed the overall deadline budget', () => {
    // Retry-After longer than the backoff wins, but stays inside the remaining budget.
    expect(
      resolveGeminiRetryDelayMs({
        retryNumber: 1,
        remainingMs: 30000,
        retryAfterHeader: '3',
        randomValue: 0,
      }),
    ).toBe(3000)

    // Backoff alone when Retry-After is absent or unusable.
    expect(
      resolveGeminiRetryDelayMs({ retryNumber: 1, remainingMs: 30000, randomValue: 0 }),
    ).toBe(500)

    // No budget left for the wait plus another attempt → abandon retries instead of overrunning.
    expect(
      resolveGeminiRetryDelayMs({ retryNumber: 1, remainingMs: 1600, randomValue: 0 }),
    ).toBeNull()
    expect(
      resolveGeminiRetryDelayMs({ retryNumber: 1, remainingMs: 0, randomValue: 0 }),
    ).toBeNull()

    // Worst-case reserved backoff covers both retries of one submission.
    expect(computeGeminiBackoffMs(1, 1) + computeGeminiBackoffMs(2, 1)).toBeLessThanOrEqual(
      GEMINI_MAX_TOTAL_BACKOFF_MS,
    )
    expect(
      GEMINI_MAX_ATTEMPTS * GEMINI_ATTEMPT_BUDGET_MS + GEMINI_MAX_TOTAL_BACKOFF_MS,
    ).toBeLessThanOrEqual(GEMINI_UPSTREAM_TIMEOUT_MS)
  })

  it('R1 — attempt 1 fails 429, attempt 2 succeeds → single successful result', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limited' } }), {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Fleet summary ready.' }] } }],
          }),
          { status: 200 },
        ),
      )
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const result = await fetchGeminiUpstreamWithRetry('test-key', 'Fleet report?', {
      assignments: ['EE-FLEET-991 -> Jürgen Tamm'],
      telemetryMode: 'simulated',
    }, { fetchFn, sleepFn, randomFn: () => 0 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload).toMatchObject({
        candidates: [{ content: { parts: [{ text: 'Fleet summary ready.' }] } }],
      })
      expect(result.attempts).toBe(2)
    }
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).toHaveBeenCalledWith(GEMINI_RETRY_BASE_DELAY_MS)
  })

  it('R2 — attempts 1 and 2 fail transiently, attempt 3 succeeds → single successful result', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Two vehicles need attention.' }] } }],
          }),
          { status: 200 },
        ),
      )
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const result = await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
      fetchFn,
      sleepFn,
      randomFn: () => 0,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.attempts).toBe(3)
    }
    expect(fetchFn).toHaveBeenCalledTimes(3)
    // Exponential backoff between the three attempts.
    expect(sleepFn.mock.calls).toEqual([[500], [1000]])
  })

  it('R2b — transient network failures are retried internally until one attempt succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Recovered.' }] } }] }),
          { status: 200 },
        ),
      )
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const result = await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
      fetchFn,
      sleepFn,
      randomFn: () => 0,
    })

    expect(result.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('R3 — all 3 attempts fail transiently → one final classified failure', async () => {
    const transient = () =>
      new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(transient())
      .mockResolvedValueOnce(transient())
      .mockResolvedValueOnce(transient())
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const result = await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
      fetchFn,
      sleepFn,
      randomFn: () => 0,
    })

    expect(result).toEqual({ ok: false, kind: 'upstream_gemini', attempts: GEMINI_MAX_ATTEMPTS })
    expect(fetchFn).toHaveBeenCalledTimes(GEMINI_MAX_ATTEMPTS)
    // Never a fourth attempt — the retry sequence is bounded.
    expect(fetchFn).not.toHaveBeenCalledTimes(4)

    // One browser-facing body: a friendly message plus the internal failureKind classifier only.
    const response = upstreamFailureResponse(result.ok ? 'upstream_gemini' : result.kind)
    expect(response).toEqual({
      status: 502,
      body: { error: 'Copilot request failed. Please try again.', failureKind: 'upstream_gemini' },
    })
    expect(Object.keys(response.body)).toEqual(['error', 'failureKind'])
    expect(JSON.stringify(response.body)).not.toContain('attempts')
    // The user-visible message leaks no status code, Gemini error, or Edge terminology.
    expect(response.body.error).not.toMatch(/429|500|502|503|504|Gemini|Edge|upstream|retry/i)
    expect(response.body.error).not.toContain('Rate limited')
  })

  it('R4 — 400 → no retry', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
    )
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const result = await fetchGeminiUpstreamWithRetry('test-key', 'Bad prompt?', {}, {
      fetchFn,
      sleepFn,
    })

    expect(result).toEqual({ ok: false, kind: 'upstream_gemini', attempts: 1 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('R5 — 401/403/404 → no retry', async () => {
    for (const status of [401, 403, 404]) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Denied' } }), { status }),
      )
      const sleepFn = vi.fn().mockResolvedValue(undefined)

      const result = await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
        fetchFn,
        sleepFn,
      })

      expect(result).toEqual({ ok: false, kind: 'upstream_gemini', attempts: 1 })
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(sleepFn).not.toHaveBeenCalled()
    }
  })

  it('R5b — explicit timeout/AbortError → no retry', async () => {
    for (const abortName of ['AbortError', 'TimeoutError']) {
      const fetchFn = vi.fn().mockRejectedValue(new DOMException('Aborted', abortName))
      const sleepFn = vi.fn().mockResolvedValue(undefined)

      const result = await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
        fetchFn,
        sleepFn,
      })

      expect(result).toEqual({ ok: false, kind: 'upstream_timeout', attempts: 1 })
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(sleepFn).not.toHaveBeenCalled()
    }
  })

  it('R7 — intermediate attempt failures never surface as a result, only the final outcome', async () => {
    const results: GeminiUpstreamFetchResult[] = []
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Bad gateway' } }), { status: 502 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'All clear.' }] } }] }),
          { status: 200 },
        ),
      )

    results.push(
      await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
        fetchFn,
        sleepFn: vi.fn().mockResolvedValue(undefined),
        randomFn: () => 0,
      }),
    )

    // Three upstream attempts, exactly one resolved outcome, and it is the success.
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(true)
    expect(results.filter((entry) => !entry.ok)).toHaveLength(0)
  })

  it('R8 — internal failureKind and attempt diagnostics stay available to the Edge caller', async () => {
    // Fresh Response per attempt — a body may only be read once.
    const fetchFn = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), {
          status: 503,
        }),
      ),
    )

    const result = await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
      fetchFn,
      sleepFn: vi.fn().mockResolvedValue(undefined),
      randomFn: () => 0,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('upstream_gemini')
      expect(result.attempts).toBe(GEMINI_MAX_ATTEMPTS)
      expect(upstreamFailureResponse(result.kind).body.failureKind).toBe('upstream_gemini')
    }

    // Retry and exhaustion diagnostics are logged internally, never returned to the browser.
    expect(helpersSource).toContain('logGeminiUpstreamRetryAttempt')
    expect(helpersSource).toContain('logGeminiUpstreamAttemptsExhausted')
    expect(helpersSource).toContain('failureKind: kind, lastHttpStatus')
  })

  it('stops retrying when the overall deadline is exhausted', async () => {
    let now = 0
    const nowFn = () => now
    const fetchFn = vi.fn().mockImplementation(() => {
      // Each attempt burns most of the request budget before failing transiently.
      now += 19000
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 }),
      )
    })
    const sleepFn = vi.fn().mockImplementation((ms: number) => {
      now += ms
      return Promise.resolve()
    })

    const result = await fetchGeminiUpstreamWithRetry('test-key', 'Status?', {}, {
      fetchFn,
      nowFn,
      sleepFn,
      randomFn: () => 0,
    })

    expect(result.ok).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(now).toBeLessThanOrEqual(GEMINI_UPSTREAM_TIMEOUT_MS)
  })

  it('wires retry constants and authority rules in Edge sources', () => {
    expect(GEMINI_MAX_ATTEMPTS).toBe(3)
    expect(GEMINI_MAX_TRANSIENT_RETRIES).toBe(2)
    expect(GEMINI_UPSTREAM_TIMEOUT_MS).toBe(40000)
    expect(helpersSource).toContain('GEMINI_MAX_ATTEMPTS = 3')
    expect(helpersSource).toContain('GEMINI_UPSTREAM_TIMEOUT_MS = 40000')
    expect(helpersSource).toContain('fetchGeminiUpstreamWithRetry')
    expect(helpersSource).toContain('logGeminiUpstreamRetryAttempt')
    expect(helpersSource).toContain('FLEET_SNAPSHOT_AUTHORITY_RULES')
    expect(helpersSource).toContain(FLEET_SNAPSHOT_AUTHORITY_RULES)
    expect(indexSource).toContain('fetchGeminiUpstreamWithRetry')
    expect(indexSource).not.toContain('while (true)')
    expect(helpersSource).not.toMatch(/console\.(log|info|debug|error).*prompt/)
  })

  it('keeps the Edge Function to a single upstream call site and a single response per request', () => {
    // One retry-owning call site: the browser cannot observe per-attempt outcomes.
    expect(indexSource.match(/fetchGeminiUpstreamWithRetry\(/g)).toHaveLength(1)
    expect(indexSource.match(/upstreamFailureResponse\(/g)).toHaveLength(1)
    expect(indexSource).not.toMatch(/for \(|\.retry\(|retryCount/)

    const upstreamCallPos = indexSource.indexOf('await fetchGeminiUpstreamWithRetry(')
    const failureResponsePos = indexSource.indexOf('upstreamFailureResponse(upstream.kind)')
    expect(upstreamCallPos).toBeGreaterThan(-1)
    expect(failureResponsePos).toBeGreaterThan(upstreamCallPos)
  })
})
