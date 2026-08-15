import type { ExecutiveAnalyticsSnapshot } from '../types/executiveAnalytics'
import { fetchGeminiCopilotResponse } from './geminiCopilot'
import type { CopilotContext } from './geminiCopilotHelpers'

export const EXECUTIVE_SUMMARY_PROMPT =
  'Summarize the current executive analytics snapshot for leadership review. Be concise (2-4 sentences). Describe fleet health, compliance, alerts, and assignment coverage using only supplied facts. Clearly label simulated telemetry as simulated.'

export const EXECUTIVE_AUTHORITY_RULES =
  'The supplied executive snapshot is authoritative. Summarize only the supplied facts. Do not invent metrics, historical trends, incidents, risk scores, maintenance records, GPS information, or financial information. Clearly describe simulated telemetry as simulated.'

/** Builds compact Gemini context from deterministic executive snapshot — no PII, no role. */
export function buildExecutiveCopilotContext(
  snapshot: ExecutiveAnalyticsSnapshot,
): CopilotContext {
  const { kpis, fleetHealth, compliance, alertSummary, assignment, priorityActions } = snapshot

  const priorityRows =
    priorityActions.length > 0
      ? priorityActions.map(
          (item) =>
            `${item.level} | ${item.subject} | ${item.headline}${item.simulated ? ' (simulated)' : ''} | Action: ${item.action}`,
        )
      : ['NORMAL | Fleet operations | No critical or high-priority items | Action: Continue routine monitoring']

  return {
    fleetHealthSummary: [
      `totalVehicles: ${kpis.totalVehicles}`,
      `assignedVehicles: ${kpis.assignedVehicles}`,
      `unassignedVehicles: ${kpis.unassignedVehicles}`,
      `assignmentCoverage: ${assignment.assignmentCoverageLabel}`,
      `optimal: ${fleetHealth.optimal}`,
      `critical: ${fleetHealth.critical}`,
      `chargingDocking: ${fleetHealth.chargingDocking}`,
      `totalDrivers: ${kpis.totalDrivers}`,
      `compliancePercentage: ${kpis.compliancePercentageLabel}`,
      `expiredLicenses: ${kpis.expiredLicenses}`,
      `expiringSoon: ${kpis.expiringSoon}`,
      `validLicenses: ${compliance.validCount}`,
      `unknownLicenses: ${compliance.unknownCount}`,
      `totalAlerts: ${alertSummary.total}`,
      `criticalAlerts: ${alertSummary.critical}`,
      `highAlerts: ${alertSummary.high}`,
      `openAlerts: ${alertSummary.open}`,
      `openCriticalAlerts: ${kpis.openCriticalAlerts}`,
      'telemetryMode: simulated',
    ],
    operationalPriorities: priorityRows.slice(0, 20),
    telemetryMode: 'simulated',
  }
}

export async function fetchExecutiveSummary(snapshot: ExecutiveAnalyticsSnapshot): Promise<string> {
  const context = buildExecutiveCopilotContext(snapshot)
  const prompt = `${EXECUTIVE_AUTHORITY_RULES}\n\n${EXECUTIVE_SUMMARY_PROMPT}`
  return fetchGeminiCopilotResponse(prompt, context)
}
