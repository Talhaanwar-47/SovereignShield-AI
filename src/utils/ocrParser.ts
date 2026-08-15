import type { OcrResult } from '../types/driver'
import { isValidEstonianIsikukood } from './isikukoodValidation'

const DATE_PATTERN = /\b(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4})\b/
const EXPIRY_LABEL_PATTERN = /4b|kehtib|expiry|expires|valid|validity|expiration/i
const LICENSE_PATTERN_EE = /\b(EE[-\s]?[A-Z0-9]{4,14})\b/i
const LICENSE_PATTERN_GENERIC = /\b([A-Z]{1,3}[-\s]?\d{5,12})\b/
const PERSONAL_CODE_PATTERN = /\b(\d{11})\b/g

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function normalizeYear(year: number): number {
  if (year >= 100) return year
  return 2000 + year
}

function isValidExpiryDate(day: number, month: number, year: number): boolean {
  const normalizedYear = normalizeYear(year)

  if (month < 1 || month > 12 || day < 1 || normalizedYear < 1) {
    return false
  }

  const daysInMonth = [
    31,
    isLeapYear(normalizedYear) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]

  return day <= daysInMonth[month - 1]!
}

function parseDateMatch(match: string): { day: number; month: number; year: number } | null {
  const parts = match.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})$/)
  if (!parts) return null

  const day = Number(parts[1])
  const month = Number(parts[2])
  const year = Number(parts[3])

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null
  }

  return { day, month, year }
}

function normalizeDateString(match: string): string {
  return match.replace(/\s+/g, ' ').trim()
}

function extractValidExpiryDate(rawText: string, lines: string[]): string {
  for (const line of lines) {
    if (!EXPIRY_LABEL_PATTERN.test(line)) continue

    const labelledMatch = line.match(DATE_PATTERN)
    if (!labelledMatch?.[1]) continue

    const parts = parseDateMatch(labelledMatch[1])
    if (parts && isValidExpiryDate(parts.day, parts.month, parts.year)) {
      return normalizeDateString(labelledMatch[1])
    }
  }

  const genericMatch = rawText.match(DATE_PATTERN)
  if (!genericMatch?.[1]) return '—'

  const parts = parseDateMatch(genericMatch[1])
  if (!parts || !isValidExpiryDate(parts.day, parts.month, parts.year)) {
    return '—'
  }

  return normalizeDateString(genericMatch[1])
}

function collectPersonalCodeCandidates(rawText: string, lines: string[]): string[] {
  const candidates: string[] = []

  for (const match of rawText.matchAll(PERSONAL_CODE_PATTERN)) {
    if (match[1]) candidates.push(match[1])
  }

  for (const line of lines) {
    const compactLine = line.replace(/\s/g, '')
    for (const match of compactLine.matchAll(/\d{11}/g)) {
      candidates.push(match[0]!)
    }
  }

  return candidates
}

function extractValidPersonalCode(rawText: string, lines: string[]): string {
  for (const candidate of collectPersonalCodeCandidates(rawText, lines)) {
    if (isValidEstonianIsikukood(candidate)) {
      return candidate
    }
  }

  return '—'
}

function extractLicenseNumber(rawText: string): string {
  const licenseMatch =
    rawText.match(LICENSE_PATTERN_EE) ?? rawText.match(LICENSE_PATTERN_GENERIC)

  if (!licenseMatch?.[1]) {
    return '—'
  }

  return licenseMatch[1].replace(/\s+/g, '')
}

export function parseOcrText(rawText: string, fallbackDocumentType?: string): OcrResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const personalCode = extractValidPersonalCode(rawText, lines)
  const licenseNumber = extractLicenseNumber(rawText)
  const expiryDate = extractValidExpiryDate(rawText, lines)

  const isLikelyName = (line: string) =>
    !/\d{5,}/.test(line) &&
    !/^(EE|DL|DRIV|LUB|AUTO|KAT|CLASS|JUHILUBA|DRIVING|LICENSE|EESTI|ESTONIA)/i.test(
      line,
    ) &&
    /^[\p{L}\s'.-]{4,}$/u.test(line) &&
    line.split(/\s+/).length >= 2

  let fullName = lines.find(isLikelyName) ?? ''

  const usableLines = lines.filter(
    (line) =>
      !/^(DRIVING|JUHILUBA|LICENSE|ESTONIA|EESTI|REPUBLIC|EUROPEAN)/i.test(line),
  )

  if (!fullName && usableLines[0]) fullName = usableLines[0]
  if (!fullName) fullName = usableLines[0] ?? 'Extracted from document'

  return {
    fullName,
    documentType: fallbackDocumentType ?? 'Estonian Class-B National License',
    personalCode,
    licenseNumber,
    expiryDate,
  }
}
