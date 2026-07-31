import type { Project } from '../data/models'

export class RelationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelationError'
  }
}

/** Walk parent links upward from `startId`. */
export function collectAncestors(
  project: Project,
  startId: string,
): Set<string> {
  const seen = new Set<string>()
  const stack = [startId]

  while (stack.length > 0) {
    const id = stack.pop()
    if (!id || seen.has(id)) continue
    seen.add(id)

    const dragon = project.dragons[id]
    if (!dragon) continue
    if (dragon.motherId) stack.push(dragon.motherId)
    if (dragon.fatherId) stack.push(dragon.fatherId)
  }

  seen.delete(startId)
  return seen
}

/**
 * True if making `parentId` a parent of `childId` would introduce a cycle
 * or self-parent link.
 */
export function wouldCreateCycle(
  project: Project,
  childId: string,
  parentId: string,
): boolean {
  if (childId === parentId) return true

  // Cycle if the child is already an ancestor of the proposed parent.
  return collectAncestors(project, parentId).has(childId)
}

export function assertCanSetParent(
  project: Project,
  childId: string,
  parentId: string | null,
): void {
  if (parentId === null) return

  if (!project.dragons[parentId]) {
    throw new RelationError('Parent dragon does not exist.')
  }
  if (wouldCreateCycle(project, childId, parentId)) {
    throw new RelationError(
      'That parent link would create a cycle in the family tree.',
    )
  }
}
