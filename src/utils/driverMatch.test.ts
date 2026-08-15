import { describe, expect, it } from 'vitest'
import type { DriverData, OcrResult } from '../types/driver'
import { compareOcrToRegistry } from './driverMatch'

const registryRecord: DriverData = {
  fullName: 'Jürgen Tamm',
  documentType: 'Estonian Class-B National License',
  personalCode: '39001010006',
  licenseNumber: 'EE-B0984122',
  expiryDate: '12 / 11 / 2026',
  status: 'DEMO RECORD',
}

function makeOcr(overrides: Partial<OcrResult> = {}): OcrResult {
  return {
    fullName: 'Jürgen Tamm',
    documentType: 'Estonian Class-B National License',
    personalCode: '39001010006',
    licenseNumber: 'EE-B0984122',
    expiryDate: '12 / 11 / 2026',
    ...overrides,
  }
}

describe('compareOcrToRegistry', () => {
  it('returns MATCH with score 100 when all 4 fields match', () => {
    const result = compareOcrToRegistry(makeOcr(), registryRecord)

    expect(result.overallStatus).toBe('MATCH')
    expect(result.matchScore).toBe(100)
    expect(result.fields.fullName).toBe('MATCH')
    expect(result.fields.personalCode).toBe('MATCH')
    expect(result.fields.licenseNumber).toBe('MATCH')
    expect(result.fields.expiryDate).toBe('MATCH')
  })

  it('returns PARTIAL MATCH with score 75 when 3 fields match and 1 mismatches', () => {
    const result = compareOcrToRegistry(
      makeOcr({ personalCode: '39001010000' }),
      registryRecord,
    )

    expect(result.overallStatus).toBe('PARTIAL MATCH')
    expect(result.matchScore).toBe(75)
    expect(result.fields.personalCode).toBe('MISMATCH')
  })

  it('returns PARTIAL MATCH with score 50 when 2 fields match and 2 mismatch', () => {
    const result = compareOcrToRegistry(
      makeOcr({
        personalCode: '39001010000',
        licenseNumber: 'EE-B0000000',
      }),
      registryRecord,
    )

    expect(result.overallStatus).toBe('PARTIAL MATCH')
    expect(result.matchScore).toBe(50)
  })

  it('returns MISMATCH with score 0 when all comparable fields mismatch', () => {
    const result = compareOcrToRegistry(
      makeOcr({
        fullName: 'Mari Ots',
        personalCode: '49001010000',
        licenseNumber: 'EE-B0000000',
        expiryDate: '01/01/2030',
      }),
      registryRecord,
    )

    expect(result.overallStatus).toBe('MISMATCH')
    expect(result.matchScore).toBe(0)
  })

  it('marks missing OCR values as UNAVAILABLE and ignores them in scoring', () => {
    const result = compareOcrToRegistry(
      makeOcr({
        personalCode: '—',
        licenseNumber: '—',
      }),
      registryRecord,
    )

    expect(result.fields.personalCode).toBe('UNAVAILABLE')
    expect(result.fields.licenseNumber).toBe('UNAVAILABLE')
    expect(result.overallStatus).toBe('MATCH')
    expect(result.matchScore).toBe(100)
  })

  it('marks missing registry values as UNAVAILABLE and ignores them in scoring', () => {
    const sparseRegistry: DriverData = {
      ...registryRecord,
      personalCode: '—',
      licenseNumber: '—',
    }

    const result = compareOcrToRegistry(makeOcr(), sparseRegistry)

    expect(result.fields.personalCode).toBe('UNAVAILABLE')
    expect(result.fields.licenseNumber).toBe('UNAVAILABLE')
    expect(result.overallStatus).toBe('MATCH')
    expect(result.matchScore).toBe(100)
  })

  it('returns INSUFFICIENT DATA when no fields are comparable', () => {
    const result = compareOcrToRegistry(
      makeOcr({
        fullName: 'Extracted from document',
        personalCode: '—',
        licenseNumber: '—',
        expiryDate: '—',
      }),
      {
        ...registryRecord,
        fullName: '—',
        personalCode: '—',
        licenseNumber: '—',
        expiryDate: '—',
      },
    )

    expect(result.overallStatus).toBe('INSUFFICIENT DATA')
    expect(result.matchScore).toBe(0)
    expect(result.fields.fullName).toBe('UNAVAILABLE')
  })

  it('compares names case-insensitively with collapsed whitespace', () => {
    const result = compareOcrToRegistry(
      makeOcr({ fullName: '  jürgen   tamm  ' }),
      registryRecord,
    )

    expect(result.fields.fullName).toBe('MATCH')
  })

  it('compares license numbers ignoring spaces and hyphens', () => {
    const result = compareOcrToRegistry(
      makeOcr({ licenseNumber: 'EE B 0984122' }),
      registryRecord,
    )

    expect(result.fields.licenseNumber).toBe('MATCH')
  })

  it('treats em dash values as unavailable', () => {
    const result = compareOcrToRegistry(
      makeOcr({ expiryDate: '—' }),
      registryRecord,
    )

    expect(result.fields.expiryDate).toBe('UNAVAILABLE')
  })

  it('treats placeholder OCR names as unavailable', () => {
    const result = compareOcrToRegistry(
      makeOcr({ fullName: 'Extracted from document' }),
      registryRecord,
    )

    expect(result.fields.fullName).toBe('UNAVAILABLE')
  })
})
