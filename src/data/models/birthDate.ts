/** Empty string = unset (not shown on the card). Stored as YYYY-MM-DD. */

export const DATE_FORMATS = ['european', 'american'] as const

export type DateFormat = (typeof DATE_FORMATS)[number]

export function isDateFormat(value: unknown): value is DateFormat {
  return value === 'european' || value === 'american'
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(year, month - 1, day))
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  )
}

/** True when value is a real calendar day in YYYY-MM-DD form. */
export function isIsoBirthDate(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  return isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]))
}

/**
 * Parse Flight Rising hatchday text ("Sep 08, 2025") to YYYY-MM-DD.
 * Returns '' when the text is not a recognizable date.
 */
export function parseFrHatchday(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  const m = cleaned.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/)
  if (!m) return ''
  const month = MONTH_INDEX[m[1]!.toLowerCase()]
  if (!month) return ''
  const day = Number(m[2])
  const year = Number(m[3])
  if (!isValidYmd(year, month, day)) return ''
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** Accept ISO or FR hatchday text; return YYYY-MM-DD or ''. */
export function normalizeBirthDate(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  if (isIsoBirthDate(trimmed)) return trimmed
  return parseFrHatchday(trimmed)
}

/**
 * Card / tooltip label, or null when unset.
 * European: DD.MM.YYYY · American: MM/DD/YYYY
 */
export function displayBirthDate(
  value: string,
  format: DateFormat = 'european',
): string | null {
  const iso = normalizeBirthDate(value)
  if (!iso) return null
  const [, y, mo, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)!
  if (format === 'american') {
    return `${mo}/${d}/${y}`
  }
  return `${d}.${mo}.${y}`
}
