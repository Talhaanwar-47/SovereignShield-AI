import type { OperationalAlert } from '../types/alerts'
import { fetchGeminiCopilotResponse } from './geminiCopilot'
import {
  buildSystemInstruction,
  scopeTrustedContextToSelectedAlert,
  type CopilotContext,
  type SelectedAlertRef,
} from './geminiCopilotHelpers'

export const ALERT_EXPLAIN_PROMPT =
  'Explain this single operational alert concisely in 1-2 sentences. Use only the supplied alert facts. Label simulated vehicle telemetry as simulated. Do not invent incident details, maintenance records, risk scores, or live GPS events.'

export function buildSelectedAlertRef(alert: OperationalAlert): SelectedAlertRef {
  return {
    id: alert.id,
    category: alert.category,
    subjectName: alert.subjectName,
    title: alert.title,
  }
}

export function buildAlertExplainPrompt(alert: OperationalAlert): string {
  return `${ALERT_EXPLAIN_PROMPT} Selected alert: ${alert.category} | ${alert.subjectName} | ${alert.title}.`
}

/** Gemini context for one already-authorized alert — no role, no PII. */
export function buildAlertExplainContext(alert: OperationalAlert): CopilotContext {
  const simLabel = alert.simulated ? ' (simulated)' : ''
  return {
    operationalPriorities: [
      `${alert.severity.toUpperCase()} | ${alert.subjectName} | ${alert.title}${simLabel} | ${alert.description} | Action: ${alert.recommendedAction} | State: ${alert.state.toUpperCase()}`,
    ],
    recommendedActions: [alert.recommendedAction],
    selectedAlertSubject: `${alert.category} | ${alert.subjectName} | ${alert.title} | id=${alert.id}`,
    ...(alert.simulated ? { telemetryMode: 'simulated' as const } : {}),
  }
}

export function buildScopedAlertExplainContext(
  trusted: CopilotContext,
  alert: OperationalAlert,
): CopilotContext {
  return scopeTrustedContextToSelectedAlert(trusted, buildSelectedAlertRef(alert))
}

export function buildAlertExplainInstruction(alert: OperationalAlert): string {
  return buildSystemInstruction(buildAlertExplainContext(alert))
}

export async function fetchAlertExplanation(alert: OperationalAlert): Promise<string> {
  return fetchGeminiCopilotResponse(
    buildAlertExplainPrompt(alert),
    buildAlertExplainContext(alert),
    { selectedAlert: buildSelectedAlertRef(alert) },
  )
}
