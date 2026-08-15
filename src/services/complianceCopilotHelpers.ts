import type { ComplianceSnapshot } from '../types/compliance'
import { fetchGeminiCopilotResponse } from './geminiCopilot'
import type { CopilotContext } from './geminiCopilotHelpers'

export const COMPLIANCE_EXPLAIN_PROMPT =
  'Explain the current compliance snapshot concisely in 2-3 sentences. Use only supplied compliance facts. Do not calculate or invent driver risk scores. Label simulated vehicle telemetry as simulated. Never use license numbers or personal codes.'

/** Builds Gemini context from deterministic compliance snapshot — no PII, no role. */
export function buildComplianceExplainContext(snapshot: ComplianceSnapshot): CopilotContext {
  const driverRows = snapshot.driverCompliance.map(
    (d) =>
      `${d.compliancePriority} | ${d.driverName} | License: ${d.licenseStatus} | Action: ${d.recommendedAction}`,
  )
  const vehicleRows = snapshot.vehicleCompliance
    .filter(
      (v) =>
        v.statusLabel.toUpperCase().includes('CRITICAL') || v.statusLabel.includes('CHARGE'),
    )
    .map(
      (v) =>
        `VEHICLE | ${v.assetId} | ${v.statusLabel} (simulated) | Action: ${v.recommendedAction}`,
    )

  return {
    fleetHealthSummary: [
      `totalDrivers: ${snapshot.totalDrivers}`,
      `expiredCount: ${snapshot.expiredCount}`,
      `expiringSoonCount: ${snapshot.expiringSoonCount}`,
      `validCount: ${snapshot.validCount}`,
      `unknownCount: ${snapshot.unknownCount}`,
      `compliancePercentage: ${snapshot.compliancePercentageLabel}`,
    ],
    operationalPriorities: [...driverRows, ...vehicleRows].slice(0, 20),
    telemetryMode: 'simulated',
  }
}

export async function fetchComplianceExplanation(snapshot: ComplianceSnapshot): Promise<string> {
  return fetchGeminiCopilotResponse(
    COMPLIANCE_EXPLAIN_PROMPT,
    buildComplianceExplainContext(snapshot),
  )
}
