import type { DriverData, OcrResult } from '../types/driver'

export type FieldMatchResult = 'MATCH' | 'MISMATCH' | 'UNAVAILABLE'

export type OverallMatchStatus = 'MATCH' | 'PARTIAL MATCH' | 'MISMATCH' | 'INSUFFICIENT DATA'

export interface DriverMatchComparison {
  overallStatus: OverallMatchStatus
  matchScore: number
  fields: {
    fullName: FieldMatchResult
    personalCode: FieldMatchResult
    licenseNumber: FieldMatchResult
    expiryDate: FieldMatchResult
  }
}

const UNAVAILABLE_MARK = '—'
const PLACEHOLDER_NAME = 'extracted from document'

type ComparableField = keyof DriverMatchComparison['fields']

function isMeaningfulValue(value: string, field: ComparableField): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed === UNAVAILABLE_MARK) {
    return false
  }

  if (field === 'fullName' && trimmed.toLowerCase() === PLACEHOLDER_NAME) {
    return false
  }

  return true
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeLicense(value: string): string {
  return value.replace(/[\s-]/g, '').toLowerCase()
}

function compareField(
  ocrValue: string,
  registryValue: string,
  field: ComparableField,
): FieldMatchResult {
  const ocrMeaningful = isMeaningfulValue(ocrValue, field)
  const registryMeaningful = isMeaningfulValue(registryValue, field)

  if (!ocrMeaningful || !registryMeaningful) {
    return 'UNAVAILABLE'
  }

  const normalize =
    field === 'licenseNumber' ? normalizeLicense : normalizeText

  return normalize(ocrValue) === normalize(registryValue) ? 'MATCH' : 'MISMATCH'
}

export function formatFieldMatchLabel(result: FieldMatchResult): string {
  switch (result) {
    case 'MATCH':
      return 'Matches registry record'
    case 'MISMATCH':
      return 'Does not match registry record'
    case 'UNAVAILABLE':
      return 'Not available for comparison'
  }
}

export function compareOcrToRegistry(
  ocrResult: OcrResult,
  driverData: DriverData,
): DriverMatchComparison {
  const fields = {
    fullName: compareField(ocrResult.fullName, driverData.fullName, 'fullName'),
    personalCode: compareField(
      ocrResult.personalCode,
      driverData.personalCode,
      'personalCode',
    ),
    licenseNumber: compareField(
      ocrResult.licenseNumber,
      driverData.licenseNumber,
      'licenseNumber',
    ),
    expiryDate: compareField(ocrResult.expiryDate, driverData.expiryDate, 'expiryDate'),
  }

  const fieldResults = Object.values(fields)
  const comparableResults = fieldResults.filter((result) => result !== 'UNAVAILABLE')
  const matchCount = comparableResults.filter((result) => result === 'MATCH').length
  const mismatchCount = comparableResults.filter((result) => result === 'MISMATCH').length

  if (comparableResults.length === 0) {
    return {
      overallStatus: 'INSUFFICIENT DATA',
      matchScore: 0,
      fields,
    }
  }

  const matchScore = Math.round((matchCount / comparableResults.length) * 100)

  let overallStatus: OverallMatchStatus
  if (mismatchCount === 0) {
    overallStatus = 'MATCH'
  } else if (matchCount === 0) {
    overallStatus = 'MISMATCH'
  } else {
    overallStatus = 'PARTIAL MATCH'
  }

  return {
    overallStatus,
    matchScore,
    fields,
  }
}
