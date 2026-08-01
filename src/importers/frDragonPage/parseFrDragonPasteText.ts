import {
  parseElementFromEyeTypeText,
  parseFrHatchday,
} from '../../data/models'
import { FrDragonPageParseError } from './parseFrDragonPage'
import type { FrDragonPage, FrDragonRef } from './types'

/**
 * Section / chrome labels that are not dragon names when they appear alone.
 * Copied FR profiles include many button labels between real fields.
 */
const STOP_LINES = new Set(
  [
    'parents',
    'offspring',
    'hatchday',
    'genetics',
    'measurements',
    'apparel',
    'personal style',
    'familiar',
    'familiar name this familiar',
    'skin',
    'effect',
    'scene',
    'breed',
    'eye type',
    'sell',
    'exalt',
    'customize',
    'feed',
    'bond',
    'energy',
    'length',
    'wingspan',
    'weight',
    'primary gene',
    'secondary gene',
    'tertiary gene',
    'coliseum team icon',
    'breeding cooldown icon',
    'lineage',
    'this dragon is unlocked for breeding',
    'adult',
    'common',
    'unusual',
    'unusual eye type',
    'normal eye type',
    'companion',
    'friendly',
    'respected',
    'trusted',
    'awakened',
  ].map((s) => s.toLowerCase()),
)

/**
 * Parse a copy-paste of a Flight Rising dragon profile (not HTML).
 * Example first line: `Jotham (#22389889)`
 */
export function parseFrDragonPasteText(text: string): FrDragonPage {
  const raw = text.replace(/\r\n/g, '\n').trim()
  if (!raw) {
    throw new FrDragonPageParseError('Paste is empty.')
  }

  const header = raw.match(/^(.+?)\s*\(#(\d+)\)\s*$/m)
  if (!header) {
    throw new FrDragonPageParseError(
      'Could not find a dragon header like Name (#12345678).',
    )
  }

  const name = header[1]!.trim()
  const frId = header[2]!
  if (!name) {
    throw new FrDragonPageParseError('Dragon name is missing from the header.')
  }

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const birthDate = readHatchday(raw)
  const sex = readSex(raw)
  const exalted = /was exalted to the ranks/i.test(raw)
  const element = parseElementFromEyeTypeText(raw)
  const { father, mother, parentsNone } = readParents(lines)
  const offspring = readOffspring(lines)

  return {
    frId,
    name,
    sex,
    birthDate,
    father,
    mother,
    parentsNone,
    exalted,
    element,
    offspring,
  }
}

function readHatchday(text: string): string {
  // Copied pages often glue the label: "HatchdayMar 29, 2016"
  const glued = text.match(
    /Hatchday\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4})/i,
  )
  if (glued) return parseFrHatchday(glued[1]!)

  const spaced = text.match(
    /Hatchday[\s\n]+([A-Za-z]{3}\s+\d{1,2},\s*\d{4})/i,
  )
  if (spaced) return parseFrHatchday(spaced[1]!)

  return ''
}

function readSex(text: string): FrDragonPage['sex'] {
  // "Ice iconMale Skydancer" or "Male Skydancer"
  if (/(?:^|[^a-z])Male(?:\s+[A-Z]|Skydancer|Guardian|Fae|Tundra|Mirror|Nocturne|Ridgeback|Snapper|Spiral|Imperial|Wildclaw|Coatl|Pearlcatcher|Bogsneak|Obelisk|Undertide|Aether|Sandsurge|Auraboa|Dusthide|Everlux|Cirrus)/i.test(
    text,
  ) || /iconMale/i.test(text)) {
    return 'male'
  }
  if (/(?:^|[^a-z])Female(?:\s+[A-Z]|Skydancer|Guardian|Fae|Tundra|Mirror|Nocturne|Ridgeback|Snapper|Spiral|Imperial|Wildclaw|Coatl|Pearlcatcher|Bogsneak|Obelisk|Undertide|Aether|Sandsurge|Auraboa|Dusthide|Everlux|Cirrus)/i.test(
    text,
  ) || /iconFemale/i.test(text)) {
    return 'female'
  }
  const loose = text.match(/\b(Male|Female)\b/i)
  if (loose) {
    return loose[1]!.toLowerCase() === 'male' ? 'male' : 'female'
  }
  return 'unknown'
}

function readParents(lines: string[]): {
  father: FrDragonRef | null
  mother: FrDragonRef | null
  parentsNone: boolean
} {
  const start = lines.findIndex((line) => /^parents$/i.test(line))
  if (start < 0) {
    return { father: null, mother: null, parentsNone: false }
  }

  const names = collectNameBlock(lines, start + 1, /^offspring$/i)
  if (names.length === 0) {
    return { father: null, mother: null, parentsNone: false }
  }
  if (names.length === 1 && /^none$/i.test(names[0]!)) {
    return { father: null, mother: null, parentsNone: true }
  }

  // FR order: first = father, second = mother.
  const father = names[0] ? nameRef(names[0]) : null
  const mother = names[1] ? nameRef(names[1]) : null
  return { father, mother, parentsNone: false }
}

function readOffspring(lines: string[]): FrDragonRef[] {
  const start = lines.findIndex((line) => /^offspring$/i.test(line))
  if (start < 0) return []
  const names = collectNameBlock(lines, start + 1, null)
  const seen = new Set<string>()
  const out: FrDragonRef[] = []
  for (const name of names) {
    if (/^none$/i.test(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(nameRef(name))
  }
  return out
}

function collectNameBlock(
  lines: string[],
  from: number,
  until: RegExp | null,
): string[] {
  const names: string[] = []
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!
    if (until && until.test(line)) break
    if (isStopLine(line)) {
      // Trailing chrome after the list - stop. Embedded stop words before any
      // name would yield an empty list (acceptable).
      if (names.length > 0) break
      continue
    }
    if (looksLikeDragonName(line)) names.push(line)
  }
  return names
}

function isStopLine(line: string): boolean {
  const lower = line.toLowerCase()
  if (STOP_LINES.has(lower)) return true
  if (/^level\s+\d+/i.test(line)) return true
  if (/^energy:/i.test(line)) return true
  if (/^familiar bonding/i.test(line)) return true
  if (/^lineage/i.test(line)) return true
  if (/^primary gene/i.test(line)) return true
  if (/^secondary gene/i.test(line)) return true
  if (/^tertiary gene/i.test(line)) return true
  if (/^length\d/i.test(line) || /^wingspan\d/i.test(line)) return true
  if (/^hatchday/i.test(line)) return true
  if (/^\(\d+\s+years?\)$/i.test(line)) return true
  return false
}

function looksLikeDragonName(line: string): boolean {
  if (line.length > 40) return false
  if (/\d{5,}/.test(line)) return false
  if (/[#:/]/.test(line)) return false
  // Apparel rows often look like "Contrast Rogue Footpads"
  if (/^(Contrast|Scene|Skin|Accent)\s/i.test(line)) return false
  return true
}

function nameRef(name: string): FrDragonRef {
  return { frId: '', name: name.trim() }
}
