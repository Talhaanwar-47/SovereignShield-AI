import type { MembershipRole } from '../services/authProfile'
import { mayDisplayDriverPii, PII_PROTECTED_DISPLAY } from '../services/fleetService'
import type { DriverMatchComparison } from './driverMatch'

export { PII_PROTECTED_DISPLAY }

const UNAVAILABLE_MARK = '—'

function formatRawPiiValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === UNAVAILABLE_MARK) return UNAVAILABLE_MARK
  return trimmed
}

/**
 * UI gate for OCR-extracted personalCode / licenseNumber.
 * Admin: authorized display. Fleet Manager: never. Driver: own registry MATCH only.
 */
export function shouldDisplayOcrExtractedPiiField(
  role: MembershipRole | null,
  field: 'personalCode' | 'licenseNumber',
  matchResult: DriverMatchComparison | null,
): boolean {
  if (role === 'admin') return true
  if (!mayDisplayDriverPii(role)) return false
  if (role === 'driver') {
    return matchResult?.fields[field] === 'MATCH'
  }
  return false
}

export function formatOcrExtractedPiiForDisplay(
  value: string,
  role: MembershipRole | null,
  field: 'personalCode' | 'licenseNumber',
  matchResult: DriverMatchComparison | null,
): string {
  if (!shouldDisplayOcrExtractedPiiField(role, field, matchResult)) {
    return PII_PROTECTED_DISPLAY
  }
  return formatRawPiiValue(value)
}
