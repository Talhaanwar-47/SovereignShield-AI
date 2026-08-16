import { describe, expect, it } from 'vitest'
import { isValidEstonianIsikukood } from './isikukoodValidation'
import { parseOcrText } from './ocrParser'

describe('isValidEstonianIsikukood', () => {
  it('accepts a valid 11-digit Estonian isikukood', () => {
    expect(isValidEstonianIsikukood('39001010000')).toBe(true)
  })

  it('rejects an invalid checksum', () => {
    expect(isValidEstonianIsikukood('39001010001')).toBe(false)
  })

  it('rejects an impossible encoded birth date', () => {
    expect(isValidEstonianIsikukood('39000000000')).toBe(false)
  })
})

describe('parseOcrText', () => {
  it('accepts a valid Estonian isikukood from OCR text', () => {
    const result = parseOcrText('Personal code 39001010000')

    expect(result.personalCode).toBe('39001010000')
  })

  it('rejects an invalid checksum personal code', () => {
    const result = parseOcrText('Personal code 39001010001')

    expect(result.personalCode).toBe('—')
  })

  it('rejects an impossible encoded birth date in personal code', () => {
    const result = parseOcrText('Personal code 39000000000')

    expect(result.personalCode).toBe('—')
  })

  it('does not use an arbitrary second line as personalCode', () => {
    const result = parseOcrText(
      [
        'Jürgen Tamm',
        'Not a personal code',
        '39001010001',
      ].join('\n'),
    )

    expect(result.personalCode).toBe('—')
  })

  it('extracts a supported EE license format', () => {
    const result = parseOcrText('License EE-B0984122')

    expect(result.licenseNumber).toBe('EE-B0984122')
  })

  it('does not treat unrelated EE text as a license number', () => {
    const result = parseOcrText('SEE ESTONIA ROAD')

    expect(result.licenseNumber).toBe('—')
  })

  it('returns em dash when no structured license match exists', () => {
    const result = parseOcrText('No license data here')

    expect(result.licenseNumber).toBe('—')
  })

  it('prefers an expiry-labelled date when multiple dates exist', () => {
    const result = parseOcrText(
      [
        'Jürgen Tamm',
        'Born 01/01/1990',
        '4b kehtib 12/11/2026',
      ].join('\n'),
    )

    expect(result.expiryDate).toBe('12/11/2026')
  })

  it('rejects impossible expiry dates', () => {
    const result = parseOcrText('Expiry 31/02/2025')

    expect(result.expiryDate).toBe('—')
  })

  it('parses a representative clean OCR document', () => {
    const result = parseOcrText(
      [
        'Jürgen Tamm',
        '39001010000',
        'EE-B0984122',
        '4b kehtib 12 / 11 / 2026',
      ].join('\n'),
    )

    expect(result.fullName).toBe('Jürgen Tamm')
    expect(result.personalCode).toBe('39001010000')
    expect(result.licenseNumber).toBe('EE-B0984122')
    expect(result.expiryDate).toBe('12 / 11 / 2026')
    expect(result.documentType).toBe('Estonian Class-B National License')
  })
})
