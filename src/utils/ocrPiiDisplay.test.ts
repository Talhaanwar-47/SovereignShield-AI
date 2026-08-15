import { describe, expect, it } from 'vitest'
import dashboardLayoutSource from '../DashboardLayout.tsx?raw'
import geminiCopilotSource from '../services/geminiCopilot.ts?raw'
import ocrServiceSource from '../services/ocrService.ts?raw'
import auditEventServiceSource from '../services/auditEventService.ts?raw'
import type { DriverMatchComparison } from './driverMatch'
import { compareOcrToRegistry } from './driverMatch'
import { getVerificationDecision } from './verificationDecision'
import type { DriverData, OcrResult } from '../types/driver'
import {
  formatOcrExtractedPiiForDisplay,
  PII_PROTECTED_DISPLAY,
  shouldDisplayOcrExtractedPiiField,
} from './ocrPiiDisplay'

const registry: DriverData = {
  fullName: 'Jürgen Tamm',
  personalCode: '39001010006',
  licenseNumber: 'EE-B0984122',
  expiryDate: '12 / 11 / 2026',
  documentType: 'B',
  status: 'REGISTRY RECORD',
}

const ocrExtract: OcrResult = {
  fullName: 'Jürgen Tamm',
  personalCode: '39001010006',
  licenseNumber: 'EE-B0984122',
  expiryDate: '12 / 11 / 2026',
  documentType: 'B',
}

const mismatchOcr: OcrResult = {
  ...ocrExtract,
  personalCode: '49001010000',
  licenseNumber: 'EE-B0000001',
}

function matchResultFor(ocr: OcrResult, driver: DriverData): DriverMatchComparison {
  return compareOcrToRegistry(ocr, driver)
}

describe('OCR PII display gate', () => {
  it('allows Admin to display authorized OCR personalCode and licenseNumber', () => {
    const match = matchResultFor(ocrExtract, registry)
    expect(shouldDisplayOcrExtractedPiiField('admin', 'personalCode', match)).toBe(true)
    expect(shouldDisplayOcrExtractedPiiField('admin', 'licenseNumber', match)).toBe(true)
    expect(formatOcrExtractedPiiForDisplay('39001010006', 'admin', 'personalCode', match)).toBe(
      '39001010006',
    )
    expect(
      formatOcrExtractedPiiForDisplay('EE-B0984122', 'admin', 'licenseNumber', match),
    ).toBe('EE-B0984122')
  })

  it('hides personalCode for Fleet Manager', () => {
    const match = matchResultFor(ocrExtract, registry)
    expect(shouldDisplayOcrExtractedPiiField('fleet-manager', 'personalCode', match)).toBe(false)
    expect(formatOcrExtractedPiiForDisplay('39001010006', 'fleet-manager', 'personalCode', match)).toBe(
      PII_PROTECTED_DISPLAY,
    )
  })

  it('hides licenseNumber for Fleet Manager', () => {
    const match = matchResultFor(ocrExtract, registry)
    expect(shouldDisplayOcrExtractedPiiField('fleet-manager', 'licenseNumber', match)).toBe(false)
    expect(
      formatOcrExtractedPiiForDisplay('EE-B0984122', 'fleet-manager', 'licenseNumber', match),
    ).toBe(PII_PROTECTED_DISPLAY)
  })

  it('allows Driver to display only own authorized PII when registry comparison MATCHes', () => {
    const match = matchResultFor(ocrExtract, registry)
    expect(shouldDisplayOcrExtractedPiiField('driver', 'personalCode', match)).toBe(true)
    expect(shouldDisplayOcrExtractedPiiField('driver', 'licenseNumber', match)).toBe(true)
    expect(formatOcrExtractedPiiForDisplay('39001010006', 'driver', 'personalCode', match)).toBe(
      '39001010006',
    )
  })

  it('hides Driver OCR PII when extracted values do not MATCH own registry record', () => {
    const match = matchResultFor(mismatchOcr, registry)
    expect(shouldDisplayOcrExtractedPiiField('driver', 'personalCode', match)).toBe(false)
    expect(shouldDisplayOcrExtractedPiiField('driver', 'licenseNumber', match)).toBe(false)
    expect(formatOcrExtractedPiiForDisplay('49001010000', 'driver', 'personalCode', match)).toBe(
      PII_PROTECTED_DISPLAY,
    )
  })

  it('hides raw PII for unauthorized users and renders protected label instead', () => {
    const match = matchResultFor(ocrExtract, registry)
    expect(formatOcrExtractedPiiForDisplay('39001010006', null, 'personalCode', match)).toBe(
      PII_PROTECTED_DISPLAY,
    )
    expect(formatOcrExtractedPiiForDisplay('EE-B0984122', null, 'licenseNumber', match)).toBe(
      PII_PROTECTED_DISPLAY,
    )
    expect(PII_PROTECTED_DISPLAY).toContain('Protected')
    expect(PII_PROTECTED_DISPLAY).toContain('hidden for this role')
  })

  it('does not change verification outcome when display gate masks values', () => {
    const match = matchResultFor(ocrExtract, registry)
    const decision = getVerificationDecision(match, 92)
    expect(decision.status).toBe('STRONG LOCAL MATCH')
    expect(decision.score).toBe(100)

    const maskedPersonal = formatOcrExtractedPiiForDisplay(
      ocrExtract.personalCode,
      'fleet-manager',
      'personalCode',
      match,
    )
    expect(maskedPersonal).toBe(PII_PROTECTED_DISPLAY)
    expect(match.fields.personalCode).toBe('MATCH')
    expect(decision.status).toBe('STRONG LOCAL MATCH')
  })

  it('wires OCR PII display gate in DashboardLayout without rendering raw values in DOM path', () => {
    expect(dashboardLayoutSource).toContain('formatOcrExtractedPiiForDisplay')
    expect(dashboardLayoutSource).toContain('shouldDisplayOcrExtractedPiiField')
    expect(dashboardLayoutSource).toContain('mayDisplayDriverPii(membershipRole)')
    expect(dashboardLayoutSource).not.toMatch(
      /label:\s*'Personal Code',\s*value:\s*ocrResult\.personalCode/,
    )
    expect(dashboardLayoutSource).not.toMatch(
      /label:\s*'License Number',\s*value:\s*ocrResult\.licenseNumber/,
    )
    expect(dashboardLayoutSource).toContain('protectedField')
  })

  it('does not serialize raw OCR PII into Copilot invoke path', () => {
    expect(geminiCopilotSource).not.toContain('ocrResult')
    expect(geminiCopilotSource).not.toMatch(/console\.(log|debug|info|warn|error)/)
  })

  it('does not store raw OCR PII in audit events or log OCR output', () => {
    expect(auditEventServiceSource).not.toContain('personalCode')
    expect(auditEventServiceSource).not.toContain('licenseNumber')
    expect(auditEventServiceSource).not.toMatch(/console\.(log|debug|info|warn|error)/)
    expect(ocrServiceSource).not.toMatch(/console\.(log|debug|info|warn|error)/)
    expect(dashboardLayoutSource).not.toMatch(/console\.(log|debug|info|warn|error)/)
  })
})
