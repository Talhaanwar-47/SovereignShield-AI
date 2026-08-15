import type { DriverMatchComparison, OverallMatchStatus } from './driverMatch'

export const OCR_REVIEW_CONFIDENCE_THRESHOLD = 70
export const OCR_STRONG_MATCH_CONFIDENCE_THRESHOLD = 85

export type VerificationDecisionStatus =
  | 'STRONG LOCAL MATCH'
  | 'LOCAL MATCH'
  | 'PARTIAL MATCH'
  | 'MISMATCH'
  | 'INSUFFICIENT DATA'
  | 'LOW OCR CONFIDENCE'

export interface VerificationDecision {
  status: VerificationDecisionStatus
  score: number
  reason: string
}

export const VERIFICATION_STATUS_DESCRIPTIONS: Record<VerificationDecisionStatus, string> = {
  'STRONG LOCAL MATCH':
    'All comparable fields match and OCR confidence is high.',
  'LOCAL MATCH':
    'All comparable fields match, but this is not government verification.',
  'PARTIAL MATCH': 'Some identity fields match and some do not.',
  MISMATCH: 'Comparable identity fields do not match the loaded registry record.',
  'INSUFFICIENT DATA': 'Not enough comparable fields were available.',
  'LOW OCR CONFIDENCE':
    'OCR confidence is low; manually verify the extracted document fields.',
}

function isLowOcrConfidenceForDecision(ocrConfidence: number | null): boolean {
  return ocrConfidence !== null && ocrConfidence < OCR_REVIEW_CONFIDENCE_THRESHOLD
}

function decisionForMatchStatus(
  matchStatus: Exclude<OverallMatchStatus, 'INSUFFICIENT DATA'>,
  score: number,
  ocrConfidence: number | null,
): VerificationDecision {
  switch (matchStatus) {
    case 'MISMATCH':
      return {
        status: 'MISMATCH',
        score,
        reason: 'Comparable identity fields do not match the loaded registry record.',
      }
    case 'PARTIAL MATCH':
      return {
        status: 'PARTIAL MATCH',
        score,
        reason: 'Some comparable identity fields match and others do not.',
      }
    case 'MATCH':
      if (ocrConfidence !== null && ocrConfidence >= OCR_STRONG_MATCH_CONFIDENCE_THRESHOLD) {
        return {
          status: 'STRONG LOCAL MATCH',
          score,
          reason: 'All comparable identity fields match and OCR confidence is high.',
        }
      }

      if (
        ocrConfidence === null ||
        (ocrConfidence >= OCR_REVIEW_CONFIDENCE_THRESHOLD &&
          ocrConfidence < OCR_STRONG_MATCH_CONFIDENCE_THRESHOLD)
      ) {
        return {
          status: 'LOCAL MATCH',
          score,
          reason:
            ocrConfidence === null
              ? 'All comparable identity fields match; OCR confidence is unavailable.'
              : 'All comparable identity fields match; OCR confidence is acceptable.',
        }
      }

      return {
        status: 'LOCAL MATCH',
        score,
        reason: 'All comparable identity fields match; OCR confidence is acceptable.',
      }
  }
}

export function getVerificationDecision(
  matchResult: DriverMatchComparison,
  ocrConfidence: number | null,
): VerificationDecision {
  const score = matchResult.matchScore

  if (matchResult.overallStatus === 'INSUFFICIENT DATA') {
    return {
      status: 'INSUFFICIENT DATA',
      score: 0,
      reason: 'Not enough comparable fields were available.',
    }
  }

  if (isLowOcrConfidenceForDecision(ocrConfidence)) {
    return {
      status: 'LOW OCR CONFIDENCE',
      score,
      reason: 'OCR confidence is below the review threshold.',
    }
  }

  return decisionForMatchStatus(matchResult.overallStatus, score, ocrConfidence)
}
