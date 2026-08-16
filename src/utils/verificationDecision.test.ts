import { describe, expect, it } from 'vitest'
import type { DriverMatchComparison } from './driverMatch'
import { getVerificationDecision } from './verificationDecision'

function makeMatchResult(
  overallStatus: DriverMatchComparison['overallStatus'],
  matchScore = 100,
): DriverMatchComparison {
  return {
    overallStatus,
    matchScore,
    fields: {
      fullName: 'MATCH',
      personalCode: 'MATCH',
      licenseNumber: 'MATCH',
      expiryDate: 'MATCH',
    },
  }
}

describe('getVerificationDecision', () => {
  it('returns STRONG LOCAL MATCH for MATCH with confidence 95', () => {
    const decision = getVerificationDecision(makeMatchResult('MATCH'), 95)

    expect(decision.status).toBe('STRONG LOCAL MATCH')
    expect(decision.score).toBe(100)
    expect(decision.reason).toBe(
      'All comparable identity fields match and OCR confidence is high.',
    )
  })

  it('returns STRONG LOCAL MATCH for MATCH with confidence 85', () => {
    const decision = getVerificationDecision(makeMatchResult('MATCH'), 85)

    expect(decision.status).toBe('STRONG LOCAL MATCH')
    expect(decision.score).toBe(100)
  })

  it('returns LOCAL MATCH for MATCH with confidence 84', () => {
    const decision = getVerificationDecision(makeMatchResult('MATCH'), 84)

    expect(decision.status).toBe('LOCAL MATCH')
    expect(decision.score).toBe(100)
    expect(decision.reason).toBe(
      'All comparable identity fields match; OCR confidence is acceptable.',
    )
  })

  it('returns LOCAL MATCH for MATCH with confidence 70', () => {
    const decision = getVerificationDecision(makeMatchResult('MATCH'), 70)

    expect(decision.status).toBe('LOCAL MATCH')
    expect(decision.score).toBe(100)
  })

  it('returns LOCAL MATCH for MATCH with confidence null', () => {
    const decision = getVerificationDecision(makeMatchResult('MATCH'), null)

    expect(decision.status).toBe('LOCAL MATCH')
    expect(decision.score).toBe(100)
    expect(decision.reason).toBe(
      'All comparable identity fields match; OCR confidence is unavailable.',
    )
  })

  it('returns PARTIAL MATCH for PARTIAL MATCH with confidence 95', () => {
    const decision = getVerificationDecision(makeMatchResult('PARTIAL MATCH', 75), 95)

    expect(decision.status).toBe('PARTIAL MATCH')
    expect(decision.score).toBe(75)
    expect(decision.reason).toBe(
      'Some comparable identity fields match and others do not.',
    )
  })

  it('returns MISMATCH for MISMATCH with confidence 95', () => {
    const decision = getVerificationDecision(makeMatchResult('MISMATCH', 0), 95)

    expect(decision.status).toBe('MISMATCH')
    expect(decision.score).toBe(0)
    expect(decision.reason).toBe(
      'Comparable identity fields do not match the loaded registry record.',
    )
  })

  it('returns INSUFFICIENT DATA for INSUFFICIENT DATA with confidence 95', () => {
    const decision = getVerificationDecision(makeMatchResult('INSUFFICIENT DATA', 0), 95)

    expect(decision.status).toBe('INSUFFICIENT DATA')
    expect(decision.score).toBe(0)
    expect(decision.reason).toBe('Not enough comparable fields were available.')
  })

  it('returns LOW OCR CONFIDENCE for MATCH with confidence 69', () => {
    const decision = getVerificationDecision(makeMatchResult('MATCH'), 69)

    expect(decision.status).toBe('LOW OCR CONFIDENCE')
    expect(decision.score).toBe(100)
    expect(decision.reason).toBe('OCR confidence is below the review threshold.')
  })

  it('returns LOW OCR CONFIDENCE for MATCH with confidence 0', () => {
    const decision = getVerificationDecision(makeMatchResult('MATCH'), 0)

    expect(decision.status).toBe('LOW OCR CONFIDENCE')
    expect(decision.score).toBe(100)
  })
})
