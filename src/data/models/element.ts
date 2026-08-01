/**
 * Flight Rising flights / eye-type elements (UI order).
 * Card strip ids are not this order - see ELEMENT_CARD_INDEX.
 */
export const FR_ELEMENTS = [
  'earth',
  'fire',
  'wind',
  'water',
  'shadow',
  'ice',
  'lightning',
  'light',
  'nature',
  'plague',
  'arcane',
] as const

export type FrElement = (typeof FR_ELEMENTS)[number]

/** Empty string = unset (no element tint on the card). */
export type DragonElement = FrElement | ''

const ELEMENT_SET = new Set<string>(FR_ELEMENTS)

const ELEMENT_PATTERN =
  /\b(Earth|Fire|Wind|Water|Shadow|Dark|Ice|Lightning|Light|Nature|Plague|Arcane)\b/i

/**
 * FR dragoncards/element_N.jpg indices (1-based).
 * 1 Earth, 2 Plague, 3 Wind, 4 Water, 5 Lightning, 6 Ice,
 * 7 Dark/Shadow, 8 Light, 9 Arcane, 10 Nature, 11 Fire.
 */
const ELEMENT_CARD_INDEX: Record<FrElement, number> = {
  earth: 1,
  plague: 2,
  wind: 3,
  water: 4,
  lightning: 5,
  ice: 6,
  shadow: 7,
  light: 8,
  arcane: 9,
  nature: 10,
  fire: 11,
}

/** FR dragon-card footer strip index (1-based). */
export function elementCardIndex(element: FrElement): number {
  return ELEMENT_CARD_INDEX[element]
}

export function isFrElement(value: unknown): value is FrElement {
  return typeof value === 'string' && ELEMENT_SET.has(value)
}

export function isDragonElement(value: unknown): value is DragonElement {
  return value === '' || isFrElement(value)
}

export function displayElement(element: DragonElement): string {
  if (!element) return ''
  return element.charAt(0).toUpperCase() + element.slice(1)
}

/** FR dragon-card element strip (footer graphic under the name). */
export function elementBackgroundUrl(element: FrElement): string {
  const n = elementCardIndex(element)
  return `https://flightrising.com/images/layout/dragoncards/element_${n}.jpg`
}

/** Solid fallback tint when the remote strip cannot load. */
export function elementFallbackColor(element: FrElement): string {
  switch (element) {
    case 'earth':
      return '#6b5344'
    case 'fire':
      return '#a44a2a'
    case 'wind':
      return '#7aa86a'
    case 'water':
      return '#3d6e8c'
    case 'shadow':
      return '#3a2f4a'
    case 'ice':
      return '#8eb4c8'
    case 'lightning':
      return '#5a6a7a'
    case 'light':
      return '#c4b070'
    case 'nature':
      return '#3f6b3a'
    case 'plague':
      return '#6a3a3a'
    case 'arcane':
      return '#8a4a8a'
  }
}

/**
 * Pull the flight element from Eye Type copy.
 * Handles spaced ("Eye Type" / "Ice") and glued ("Normal Eye TypeIce") text.
 */
function normalizeElementToken(raw: string): DragonElement {
  const key = raw.toLowerCase()
  if (key === 'dark') return 'shadow'
  return isFrElement(key) ? key : ''
}

export function parseElementFromEyeTypeText(text: string): DragonElement {
  const nearEye = text.match(
    /Eye\s*Type\s*([A-Za-z][A-Za-z\s-]{0,24})/i,
  )
  if (nearEye) {
    const hit = nearEye[1]!.match(ELEMENT_PATTERN)
    if (hit) return normalizeElementToken(hit[1]!)
  }

  // "Normal Eye TypeIce" / "Primal Eye Type Fire"
  const glued = text.match(
    /(?:Normal|Unusual|Rare|Faceted|Primal|Multi-Gaze|Goat|Innocent|Bright|Dark|Glowing|Pastel|Swirl|Dark\s*Sclera|Light\s*Sclera)?\s*Eye\s*Type\s*(Earth|Fire|Wind|Water|Shadow|Dark|Ice|Lightning|Light|Nature|Plague|Arcane)\b/i,
  )
  if (glued) return normalizeElementToken(glued[1]!)

  return ''
}
