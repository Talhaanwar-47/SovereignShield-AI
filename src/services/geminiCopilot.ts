import { supabase } from '../supabaseClient'
import {
  mapEdgeFunctionResult,
  resolveCopilotFastPath,
  extractClientDemoTelemetry,
  type CopilotContext,
  type CopilotFailureKind,
  type SelectedAlertRef,
} from './geminiCopilotHelpers'

export type { CopilotContext, CopilotFailureKind }

export class GeminiCopilotError extends Error {
  readonly status?: number
  readonly kind?: CopilotFailureKind

  constructor(message: string, status?: number, kind?: CopilotFailureKind) {
    super(message)
    this.name = 'GeminiCopilotError'
    this.status = status
    this.kind = kind
  }
}

/**
 * Answers a Copilot prompt via local fast path when available, otherwise Gemini.
 */
export async function answerCopilotQuery(
  prompt: string,
  context: CopilotContext = {},
): Promise<string> {
  const trimmed = prompt.trim()
  if (!trimmed) {
    throw new GeminiCopilotError('Prompt is required.', 400)
  }

  const fastPath = resolveCopilotFastPath(trimmed, context)
  if (fastPath !== null) {
    return fastPath
  }

  return fetchGeminiCopilotResponse(trimmed, context)
}

/**
 * Client timeout for the single Copilot invoke.
 * Must stay above the Edge deadline (GEMINI_UPSTREAM_TIMEOUT_MS = 40000ms) so the Edge Function
 * wins the race and returns one classified response instead of the browser aborting mid-retry.
 */
export const COPILOT_INVOKE_TIMEOUT_MS = 46000

/**
 * Invokes the server-side Gemini Copilot Edge Function exactly once per user submission.
 * All transient Gemini retries happen inside the Edge Function, so a single submission never
 * requires the user to resubmit. The Gemini API key never leaves the server environment.
 */
export async function fetchGeminiCopilotResponse(
  prompt: string,
  context: CopilotContext = {},
  options: { selectedAlert?: SelectedAlertRef } = {},
): Promise<string> {
  const trimmed = prompt.trim()
  if (!trimmed) {
    throw new GeminiCopilotError('Prompt is required.', 400)
  }

  const clientDemoTelemetry = extractClientDemoTelemetry(context)

  const { data, error } = await supabase.functions.invoke('gemini-copilot', {
    body: {
      prompt: trimmed,
      ...(clientDemoTelemetry ? { clientDemoTelemetry } : {}),
      ...(options.selectedAlert ? { selectedAlert: options.selectedAlert } : {}),
    },
    timeout: COPILOT_INVOKE_TIMEOUT_MS,
  })

  const mapped = await mapEdgeFunctionResult(data, error)
  if (!mapped.ok) {
    throw new GeminiCopilotError(mapped.message, 502, mapped.kind)
  }

  return mapped.text
}
