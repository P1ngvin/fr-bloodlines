import type { Dragon, Project } from '../data/models'
import { listDragons } from '../tree'

function scoreMatch(dragon: Dragon, query: string, digits: string): number {
  const name = dragon.name.trim().toLowerCase() || 'unnamed'
  const frId = dragon.frId
  let score = 0

  if (name === query) score += 100
  else if (name.startsWith(query)) score += 80
  else if (name.includes(query)) score += 40

  if (frId) {
    if (frId === query || (digits && frId === digits)) score += 100
    else if (frId.startsWith(query) || (digits && frId.startsWith(digits))) score += 70
    else if (frId.includes(query) || (digits && frId.includes(digits))) score += 35
  }

  if (dragon.id.toLowerCase() === query) score += 50
  else if (dragon.id.toLowerCase().includes(query)) score += 10

  return score
}

/** Match dragons by display name or Flight Rising id (and internal id as fallback). */
export function searchDragons(project: Project, rawQuery: string): Dragon[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []

  const digits = query.replace(/\D/g, '')

  return listDragons(project)
    .map((dragon) => ({
      dragon,
      score: scoreMatch(dragon, query, digits),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.dragon.name.localeCompare(b.dragon.name) ||
        a.dragon.id.localeCompare(b.dragon.id),
    )
    .map((entry) => entry.dragon)
}
