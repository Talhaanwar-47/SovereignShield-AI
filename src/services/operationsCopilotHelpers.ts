import type { DriverData } from '../types/driver'
import type { FleetAsset } from '../types/fleet'
import type { OperationsSnapshot } from '../types/operations'
import { fetchGeminiCopilotResponse } from './geminiCopilot'
import type { CopilotContext } from './geminiCopilotHelpers'
import { createFleetSnapshot, mergeOpsSnapshotIntoContext } from './fleetSnapshot'
import {
  computeOperationsSnapshot,
  type OperationsDriverRecord,
  type OperationsFleetAsset,
} from './operationsPriorityEngine'

export const OPS_SUMMARY_PROMPT =
  'Summarize the current operational priority snapshot for the AI Operations Command Center. Be concise (2-3 sentences). Explain priorities naturally. Clearly label simulated vehicle telemetry as simulated. Do not invent facts beyond the supplied snapshot.'

export const OPS_PRIORITY_AUTHORITY_RULES =
  'The supplied operational priority snapshot is authoritative. Do not invent, alter, downgrade, upgrade, or contradict the supplied vehicle, assignment, compliance, or priority facts. Simulated telemetry must always be described as simulated.'

/** Builds request-time ops Copilot context from the current authorized fleet rows. */
export function buildOpsCopilotContext(
  assets: OperationsFleetAsset[],
  drivers: OperationsDriverRecord[],
  snapshot?: OperationsSnapshot,
): CopilotContext {
  const ops = snapshot ?? computeOperationsSnapshot(assets, drivers)
  const fleetSnapshot = createFleetSnapshot(
    assets.map((asset) => ({
      assetId: asset.assetId,
      driverName: asset.driverName?.trim() || 'Unassigned',
      speed: '',
      energy: '',
      batteryPercent: 0,
      status: asset.status,
      statusLabel: asset.statusLabel,
    })),
    drivers.map((driver) => ({
      fullName: driver.fullName,
      expiryDate: driver.expiryDate,
      personalCode: '—',
      licenseNumber: '—',
      documentType: '—',
      status: 'REGISTRY RECORD' as const,
    })),
  )
  return mergeOpsSnapshotIntoContext(fleetSnapshot, ops)
}

/** Request-time ops context from full fleet session state (preferred for AI actions). */
export function buildOpsCopilotContextAtRequestTime(
  fleetAssets: FleetAsset[],
  driverRecords: DriverData[],
  opsSnapshot?: OperationsSnapshot,
): CopilotContext {
  const ops =
    opsSnapshot ??
    computeOperationsSnapshot(
      fleetAssets.map((asset) => ({
        assetId: asset.assetId,
        status: asset.status,
        statusLabel: asset.statusLabel,
        driverName: asset.driverName,
      })),
      driverRecords.map((driver) => ({
        fullName: driver.fullName,
        expiryDate: driver.expiryDate,
      })),
    )
  const fleetSnapshot = createFleetSnapshot(fleetAssets, driverRecords)
  return mergeOpsSnapshotIntoContext(fleetSnapshot, ops)
}

export async function fetchOperationsSummary(context: CopilotContext): Promise<string> {
  return fetchGeminiCopilotResponse(OPS_SUMMARY_PROMPT, context)
}
