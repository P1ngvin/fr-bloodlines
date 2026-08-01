import type { Migration } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** v10 adds `exalted` (FR memorial / exalted-to-deity page). */
export const v9ToV10: Migration = {
  from: 9,
  to: 10,
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
      nextDragons[key] = {
        ...raw,
        exalted: raw.exalted === true,
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
