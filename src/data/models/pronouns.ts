/** Common pronoun sets offered in the editor dropdown. */
export const PRONOUN_PRESETS = [
  'she/her',
  'he/him',
  'they/them',
  'she/they',
  'he/they',
  'any/all',
] as const

export type PronounPreset = (typeof PRONOUN_PRESETS)[number]

export function isPronounPreset(value: string): value is PronounPreset {
  return (PRONOUN_PRESETS as readonly string[]).includes(value)
}

/** Trimmed pronouns for display, or null when unset. */
export function displayPronouns(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizePronouns(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
