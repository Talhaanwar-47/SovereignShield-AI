import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  authorizeAuthenticatedMember,
  buildCorsHeaders,
  consumeRateLimit,
  emptyUpstreamResponse,
  errorResponse,
  extractBearerToken,
  extractGeminiAssistantText,
  extractGeminiEmptyResponseDiagnostics,
  fetchGeminiUpstreamWithRetry,
  logGeminiEmptyResponse,
  missingApiKeyResponse,
  parseCopilotRequest,
  rateLimitExceededResponse,
  scopeTrustedContextToSelectedAlert,
  resolveAllowedOrigins,
  successResponse,
  upstreamFailureResponse,
  type CopilotJsonResponse,
  type RateLimitStore,
} from './helpers.ts'
import { buildTrustedCopilotContextForUser } from './trustedContext.ts'

/** In-memory V1 counters — keyed by verified auth user id only. */
const rateLimitStore: RateLimitStore = new Map()

function allowedOriginsFromEnv(): string[] {
  return resolveAllowedOrigins(Deno.env.get('COPILOT_ALLOWED_ORIGINS'))
}

function jsonResponse(
  result: CopilotJsonResponse,
  corsHeaders: Record<string, string> | null,
): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      ...(corsHeaders ?? {}),
      'Content-Type': 'application/json',
    },
  })
}

function corsDeniedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  const allowedOrigins = allowedOriginsFromEnv()
  const origin = request.headers.get('Origin')
  const corsHeaders = buildCorsHeaders(origin, allowedOrigins)

  // Browser requests include Origin — reject untrusted origins (never ACAO: *).
  if (origin && !corsHeaders) {
    return corsDeniedResponse()
  }

  if (request.method === 'OPTIONS') {
    if (!corsHeaders) {
      return corsDeniedResponse()
    }
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse(errorResponse(405, 'Method not allowed.'), corsHeaders)
  }

  const bearer = extractBearerToken(request.headers.get('Authorization'))
  if (!bearer) {
    return jsonResponse(errorResponse(401, 'Unauthorized.'), corsHeaders)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(missingApiKeyResponse(), corsHeaders)
  }

  // User-scoped anon-key client only — membership authorization never uses the service role.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const authz = await authorizeAuthenticatedMember(
    request.headers.get('Authorization'),
    {
      getUser: async () => {
        const { data, error } = await userClient.auth.getUser(bearer)
        if (error || !data.user?.id) {
          return { userId: null }
        }
        return { userId: data.user.id }
      },
      hasOrganizationMembership: async (userId) => {
        const { data, error } = await userClient
          .from('organization_members')
          .select('organization_id')
          .eq('user_id', userId)
          .limit(1)

        if (error || !data || data.length === 0) {
          return false
        }
        return true
      },
    },
  )

  if (!authz.ok) {
    return jsonResponse(errorResponse(authz.status, authz.message), corsHeaders)
  }

  // Rate limit by verified JWT user id only — never body user_id / role / organization_id.
  const rate = consumeRateLimit(authz.userId, Date.now(), rateLimitStore)
  if (!rate.allowed) {
    return jsonResponse(rateLimitExceededResponse(), corsHeaders)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(errorResponse(400, 'Invalid JSON body.'), corsHeaders)
  }

  // Body fields (role / organization_id / driver_id / vehicle_id) are never used for authz.
  const parsed = parseCopilotRequest(body)
  if (!parsed.ok) {
    return jsonResponse(errorResponse(parsed.status, parsed.message), corsHeaders)
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return jsonResponse(missingApiKeyResponse(), corsHeaders)
  }

  const trustedContext = await buildTrustedCopilotContextForUser(
    userClient,
    authz.userId,
    parsed.value.clientDemoTelemetry,
  )

  if ('error' in trustedContext) {
    return jsonResponse(errorResponse(403, 'Forbidden.'), corsHeaders)
  }

  const geminiContext = parsed.value.selectedAlert
    ? scopeTrustedContextToSelectedAlert(trustedContext, parsed.value.selectedAlert)
    : trustedContext

  const upstream = await fetchGeminiUpstreamWithRetry(
    apiKey,
    parsed.value.prompt,
    geminiContext,
  )

  if (!upstream.ok) {
    return jsonResponse(upstreamFailureResponse(upstream.kind), corsHeaders)
  }

  const text = extractGeminiAssistantText(upstream.payload)
  if (!text) {
    logGeminiEmptyResponse(extractGeminiEmptyResponseDiagnostics(upstream.payload))
    return jsonResponse(emptyUpstreamResponse(), corsHeaders)
  }

  return jsonResponse(successResponse(text), corsHeaders)
})
