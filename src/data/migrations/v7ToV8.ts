import type { Migration } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** v8 adds optional `pronouns` (empty string = unset). */
export const v7ToV8: Migration = {
  from: 7,
  to: 8,
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
      const pronouns =
        typeof raw.pronouns === 'string' ? raw.pronouns.trim() : ''
      nextDragons[key] = {
        ...raw,
        pronouns,
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
