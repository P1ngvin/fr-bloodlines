import type { Migration } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** v9 adds optional `birthDate` (YYYY-MM-DD; empty string = unset). */
export const v8ToV9: Migration = {
  from: 8,
  to: 9,
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
      const birthDate =
        typeof raw.birthDate === 'string' ? raw.birthDate.trim() : ''
      nextDragons[key] = {
        ...raw,
        birthDate,
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
