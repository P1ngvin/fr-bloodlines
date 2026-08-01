import type { Project } from '../data/models'
import { buildChildrenIndex, type ChildrenIndex } from './graph'
import { areSiblings } from './relations'

/**
 * Close family around `focusId` for Local view:
 * self, parents, children, full siblings (or sibling group), and mates
 * (dragons who share at least one child).
 */
export function collectLocalRelativeIds(
  project: Project,
  focusId: string,
  childrenIndex: ChildrenIndex = buildChildrenIndex(project),
): Set<string> {
  const ids = new Set<string>()
  const focus = project.dragons[focusId]
  if (!focus) return ids

  ids.add(focusId)

  if (focus.motherId && project.dragons[focus.motherId]) {
    ids.add(focus.motherId)
  }
  if (focus.fatherId && project.dragons[focus.fatherId]) {
    ids.add(focus.fatherId)
  }

  for (const childId of childrenIndex[focusId] ?? []) {
    if (project.dragons[childId]) ids.add(childId)
  }

  for (const dragon of Object.values(project.dragons)) {
    if (dragon.id === focusId) continue
    if (areSiblings(focus, dragon)) ids.add(dragon.id)
  }

  const focusKids = new Set(childrenIndex[focusId] ?? [])
  for (const [otherId, otherKids] of Object.entries(childrenIndex)) {
    if (otherId === focusId || !project.dragons[otherId]) continue
    if (otherKids.some((id) => focusKids.has(id))) ids.add(otherId)
  }

  // Co-parents of focus's own parents' other children are not mates of focus;
  // mates of focus already covered. Also pull the other parent of each child
  // so couple forks stay complete in Local view.
  for (const childId of childrenIndex[focusId] ?? []) {
    const child = project.dragons[childId]
    if (!child) continue
    if (child.motherId && project.dragons[child.motherId]) {
      ids.add(child.motherId)
    }
    if (child.fatherId && project.dragons[child.fatherId]) {
      ids.add(child.fatherId)
    }
  }

  return ids
}
