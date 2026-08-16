const WEIGHTS_PRIMARY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1] as const
const WEIGHTS_SECONDARY = [3, 4, 5, 6, 7, 8, 9, 1, 2, 3] as const

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12 || day < 1 || year < 1) {
    return false
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
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

function decodeBirthYear(centuryDigit: number, yearSuffix: number): number | null {
  if (centuryDigit === 1 || centuryDigit === 2) return 1800 + yearSuffix
  if (centuryDigit === 3 || centuryDigit === 4) return 1900 + yearSuffix
  if (centuryDigit === 5 || centuryDigit === 6) return 2000 + yearSuffix
  if (centuryDigit === 7 || centuryDigit === 8) return 2100 + yearSuffix
  return null
}

function computeChecksumDigit(digits: number[]): number {
  let sum = 0
  for (let index = 0; index < 10; index += 1) {
    sum += digits[index]! * WEIGHTS_PRIMARY[index]!
  }

  let checksum = sum % 11
  if (checksum === 10) {
    sum = 0
    for (let index = 0; index < 10; index += 1) {
      sum += digits[index]! * WEIGHTS_SECONDARY[index]!
    }
    checksum = sum % 11
  }

  if (checksum === 10) {
    checksum = 0
  }

  return checksum
}

export function isValidEstonianIsikukood(code: string): boolean {
  if (!/^\d{11}$/.test(code)) {
    return false
  }

  const digits = code.split('').map((digit) => Number(digit))
  const centuryDigit = digits[0]!
  const yearSuffix = digits[1]! * 10 + digits[2]!
  const month = digits[3]! * 10 + digits[4]!
  const day = digits[5]! * 10 + digits[6]!

  const birthYear = decodeBirthYear(centuryDigit, yearSuffix)
  if (birthYear === null || !isValidCalendarDate(day, month, birthYear)) {
    return false
  }

  return digits[10] === computeChecksumDigit(digits)
}
