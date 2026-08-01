import type { Migration } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * v7 adds `parentsNone`: true only when Flight Rising lists Parents as None
 * (true G1). Missing links in the project are not the same thing.
 */
export const v6ToV7: Migration = {
  from: 6,
  to: 7,
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
        parentsNone: raw.parentsNone === true,
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
