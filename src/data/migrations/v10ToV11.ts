import type { Migration } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ELEMENTS = new Set([
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
])

/** v11 adds `element` (flight / eye-type element for card backgrounds). */
export const v10ToV11: Migration = {
  from: 10,
  to: 11,
  migrate(document) {
    const project = document.project
    if (!isPlainObject(project)) return document

    const dragons = project.dragons
    if (!isPlainObject(dragons)) return document

    const nextDragons: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(dragons)) {
      if (!isPlainObject(raw)) {
        nextDragons[key] = raw
        continue
      }
      const element =
        typeof raw.element === 'string' && ELEMENTS.has(raw.element)
          ? raw.element
          : ''
      nextDragons[key] = {
        ...raw,
        element,
      }
    }

    return {
      ...document,
      project: {
        ...project,
        dragons: nextDragons,
      },
    }
  },
}
