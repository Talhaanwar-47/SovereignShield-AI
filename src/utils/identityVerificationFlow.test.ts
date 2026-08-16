import { describe, expect, it } from 'vitest'
import dashboardLayoutSource from '../DashboardLayout.tsx?raw'
import { applyDriverFallback } from '../data/fallbacks'
import { mapDriverRowToData } from '../data/mappers'
import { isLowOcrConfidence } from '../services/ocrService'
import type { DriverData, OcrResult } from '../types/driver'
import { compareOcrToRegistry } from './driverMatch'
import { parseOcrText } from './ocrParser'
import { getVerificationDecision } from './verificationDecision'

const REGISTRY_RECORD: DriverData = {
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

function runIdentityPipeline(
  ocrResult: OcrResult,
  ocrConfidence: number | null,
  registry: DriverData = REGISTRY_RECORD,
) {
  const matchResult = compareOcrToRegistry(ocrResult, registry)
  const decision = getVerificationDecision(matchResult, ocrConfidence)
  return { ocrResult, matchResult, decision }
}

function runParsedIdentityPipeline(
  ocrText: string,
  ocrConfidence: number | null,
  registry: DriverData = REGISTRY_RECORD,
) {
  const parsed = parseOcrText(ocrText, registry.documentType)
  return {
    parsed,
    ...runIdentityPipeline(parsed, ocrConfidence, registry),
  }
}

function simulateDashboardOcrErrorHandling(err: unknown) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return {
      showErrorPanel: false,
      ocrPhase: 'scanning' as const,
      ocrResult: null,
      matchResult: null,
      verificationDecision: null,
    }
  }

  return {
    showErrorPanel: true,
    ocrPhase: 'idle' as const,
    ocrResult: null,
    matchResult: null,
    verificationDecision: null,
  }
}

describe('identity verification flow validation', () => {
  describe('scenario 1 — full match', () => {
    it('matches all four comparable fields and yields STRONG LOCAL MATCH at high confidence', () => {
      const { matchResult, decision } = runIdentityPipeline(makeOcr(), 90)

      expect(Object.values(matchResult.fields).every((field) => field === 'MATCH')).toBe(true)
      expect(matchResult.overallStatus).toBe('MATCH')
      expect(matchResult.matchScore).toBe(100)
      expect(decision.status).toBe('STRONG LOCAL MATCH')
      expect(isLowOcrConfidence(90)).toBe(false)
    })

    it('chains OCR parsing, comparison, and decision for representative OCR text', () => {
      const { parsed, matchResult, decision } = runParsedIdentityPipeline(
        [
          'Jürgen Tamm',
          '39001010006',
          'EE-B0984122',
          '4b kehtib 12 / 11 / 2026',
        ].join('\n'),
        88,
      )

      expect(parsed.fullName).toBe('Jürgen Tamm')
      expect(matchResult.overallStatus).toBe('MATCH')
      expect(matchResult.matchScore).toBe(100)
      expect(decision.status).toBe('STRONG LOCAL MATCH')
    })
  })

  describe('scenario 2 — partial match', () => {
    it('reports PARTIAL MATCH with score 75 when only expiry mismatches', () => {
      const { matchResult, decision } = runIdentityPipeline(
        makeOcr({ expiryDate: '01/01/2030' }),
        95,
      )

      expect(matchResult.overallStatus).toBe('PARTIAL MATCH')
      expect(matchResult.matchScore).toBe(75)
      expect(matchResult.fields.fullName).toBe('MATCH')
      expect(matchResult.fields.personalCode).toBe('MATCH')
      expect(matchResult.fields.licenseNumber).toBe('MATCH')
      expect(matchResult.fields.expiryDate).toBe('MISMATCH')
      expect(decision.status).toBe('PARTIAL MATCH')
    })
  })

  describe('scenario 3 — complete mismatch', () => {
    it('reports MISMATCH with score 0 and no field marked MATCH', () => {
      const { matchResult, decision } = runIdentityPipeline(
        makeOcr({
          fullName: 'Mari Ots',
          personalCode: '49001010000',
          licenseNumber: 'EE-B0000000',
          expiryDate: '01/01/2030',
        }),
        95,
      )

      expect(matchResult.overallStatus).toBe('MISMATCH')
      expect(matchResult.matchScore).toBe(0)
      expect(Object.values(matchResult.fields).every((field) => field === 'MISMATCH')).toBe(true)
      expect(decision.status).toBe('MISMATCH')
    })
  })

  describe('scenario 4 — low OCR confidence', () => {
    it('keeps extracted fields and MATCH score while decision becomes LOW OCR CONFIDENCE', () => {
      const ocrResult = makeOcr()
      const { matchResult, decision } = runIdentityPipeline(ocrResult, 69)

      expect(matchResult.overallStatus).toBe('MATCH')
      expect(matchResult.matchScore).toBe(100)
      expect(decision.status).toBe('LOW OCR CONFIDENCE')
      expect(decision.score).toBe(100)
      expect(isLowOcrConfidence(69)).toBe(true)
      expect(ocrResult.fullName).toBe('Jürgen Tamm')
      expect(ocrResult.personalCode).toBe('39001010006')
    })
  })

  describe('scenario 5 — insufficient data', () => {
    it('returns INSUFFICIENT DATA without false mismatch claims', () => {
      const { matchResult, decision } = runIdentityPipeline(
        makeOcr({
          fullName: 'Extracted from document',
          personalCode: '—',
          licenseNumber: '—',
          expiryDate: '—',
        }),
        95,
        {
          ...REGISTRY_RECORD,
          fullName: '—',
          personalCode: '—',
          licenseNumber: '—',
          expiryDate: '—',
        },
      )

      expect(matchResult.overallStatus).toBe('INSUFFICIENT DATA')
      expect(matchResult.matchScore).toBe(0)
      expect(decision.status).toBe('INSUFFICIENT DATA')
      expect(decision.score).toBe(0)
      expect(Object.values(matchResult.fields).every((field) => field === 'UNAVAILABLE')).toBe(
        true,
      )
    })
  })

  describe('scenario 6 — mixed available fields', () => {
    it('scores only the comparable name field', () => {
      const { matchResult, decision } = runIdentityPipeline(
        makeOcr({
          fullName: 'Jürgen Tamm',
          personalCode: '—',
          licenseNumber: '—',
          expiryDate: '—',
        }),
        90,
      )

      expect(matchResult.fields.fullName).toBe('MATCH')
      expect(matchResult.fields.personalCode).toBe('UNAVAILABLE')
      expect(matchResult.fields.licenseNumber).toBe('UNAVAILABLE')
      expect(matchResult.fields.expiryDate).toBe('UNAVAILABLE')
      expect(matchResult.overallStatus).toBe('MATCH')
      expect(matchResult.matchScore).toBe(100)
      expect(decision.status).toBe('STRONG LOCAL MATCH')
    })
  })

  describe('scenario 7 — placeholder handling', () => {
    it('never treats em dash, empty string, or placeholder name as comparable identity values', () => {
      const result = compareOcrToRegistry(
        makeOcr({
          fullName: 'Extracted from document',
          personalCode: '',
          licenseNumber: '—',
          expiryDate: '   ',
        }),
        REGISTRY_RECORD,
      )

      expect(result.fields.fullName).toBe('UNAVAILABLE')
      expect(result.fields.personalCode).toBe('UNAVAILABLE')
      expect(result.fields.licenseNumber).toBe('UNAVAILABLE')
      expect(result.fields.expiryDate).toBe('UNAVAILABLE')
      expect(Object.values(result.fields).every((field) => field !== 'MISMATCH')).toBe(true)
    })
  })

  describe('scenario 8 — normalization', () => {
    it('matches names with collapsed whitespace and case differences', () => {
      const result = compareOcrToRegistry(
        makeOcr({ fullName: 'Jürgen   Tamm' }),
        { ...REGISTRY_RECORD, fullName: 'jürgen tamm' },
      )

      expect(result.fields.fullName).toBe('MATCH')
    })

    it('matches license numbers ignoring spaces and hyphens', () => {
      const result = compareOcrToRegistry(
        makeOcr({ licenseNumber: 'EE B0984122' }),
        REGISTRY_RECORD,
      )

      expect(result.fields.licenseNumber).toBe('MATCH')
    })
  })

  describe('scenario 9 — OCR abort contract', () => {
    it('does not surface an error panel for AbortError', () => {
      const outcome = simulateDashboardOcrErrorHandling(
        new DOMException('OCR operation was aborted.', 'AbortError'),
      )

      expect(outcome.showErrorPanel).toBe(false)
      expect(outcome.ocrResult).toBeNull()
      expect(outcome.matchResult).toBeNull()
      expect(outcome.verificationDecision).toBeNull()
    })
  })

  describe('scenario 10 — invalid upload contract', () => {
    it('clears OCR comparison and decision state when validation fails', () => {
      const resetState = {
        ocrResult: null,
        ocrConfidence: null,
        driverMatchResult: null,
        verificationDecision: null,
      }

      expect(resetState).toEqual({
        ocrResult: null,
        ocrConfidence: null,
        driverMatchResult: null,
        verificationDecision: null,
      })
    })
  })

  describe('scenario 11 — OCR error contract', () => {
    it('surfaces an error panel and clears OCR-derived state for genuine failures', () => {
      const outcome = simulateDashboardOcrErrorHandling(new Error('Tesseract worker failed'))

      expect(outcome.showErrorPanel).toBe(true)
      expect(outcome.ocrPhase).toBe('idle')
      expect(outcome.ocrResult).toBeNull()
      expect(outcome.matchResult).toBeNull()
      expect(outcome.verificationDecision).toBeNull()
    })
  })

  describe('scenario 14 — registry data integrity', () => {
    it('does not mutate registry data during comparison', () => {
      const registry = structuredClone(REGISTRY_RECORD)
      const before = structuredClone(registry)

      compareOcrToRegistry(makeOcr(), registry)

      expect(registry).toEqual(before)
    })

    it('does not mutate registry data during parsed pipeline execution', () => {
      const registry = structuredClone(REGISTRY_RECORD)
      const before = structuredClone(registry)

      runParsedIdentityPipeline(
        ['Jürgen Tamm', '39001010006', 'EE-B0984122', '4b kehtib 12 / 11 / 2026'].join('\n'),
        90,
        registry,
      )

      expect(registry).toEqual(before)
    })
  })

  describe('scenario 15 — status integrity', () => {
    it('uses REGISTRY RECORD for mapped Supabase rows and DEMO RECORD for fallback data', () => {
      expect(
        mapDriverRowToData(
          { name: 'Mari Ots' },
          { personal_code: '49001010000' },
        ).status,
      ).toBe('REGISTRY RECORD')
      expect(applyDriverFallback().status).toBe('DEMO RECORD')
    })

    it('keeps OCR EXTRACTED in the dashboard OCR flow and excludes VERIFIED & REGISTERED', () => {
      expect(dashboardLayoutSource).toContain('OCR EXTRACTED')
      expect(dashboardLayoutSource).not.toMatch(/VERIFIED\s*&\s*REGISTERED/i)
      expect(dashboardLayoutSource).not.toMatch(/99\.84/)
      expect(dashboardLayoutSource).toContain('compareAgainstSelectedRegistry(parsed, selectedDriver, confidence)')
      expect(dashboardLayoutSource).toContain('compareAgainstSelectedRegistry(ocrResult, registry, ocrConfidence)')
      expect(dashboardLayoutSource).toContain('handleSelectRegistryRecord')
      expect(dashboardLayoutSource).toContain('formatOcrExtractedPiiForDisplay')
      expect(dashboardLayoutSource).toContain('stripDriverPii(registry)')
    })
  })
})
