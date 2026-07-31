import { extractFrIdFromRenderUrl } from '../../utils/frRender'
import type { Migration } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * v1 stored a freeform `image` URL.
 * v2 stores `frId` and derives the render URL in the UI.
 */
export const v1ToV2: Migration = {
  from: 1,
  to: 2,
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

      const image = typeof raw.image === 'string' ? raw.image : ''
      const next = { ...raw }
      delete next.image
      next.frId = extractFrIdFromRenderUrl(image)
      nextDragons[key] = next
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
