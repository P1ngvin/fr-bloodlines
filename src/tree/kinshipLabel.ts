import type { Dragon, DragonSex, Project } from '../data/models'
import { buildChildrenIndex, type ChildrenIndex } from './graph'
import { areSiblings, shareBothParents } from './relations'

/**
 * How `otherId` relates to `activeId` (English kinship term).
 * Returns null for self or when no close relation is found.
 */
export function kinshipLabel(
  project: Project,
  activeId: string,
  otherId: string,
  childrenIndex: ChildrenIndex = buildChildrenIndex(project),
): string | null {
  if (activeId === otherId) return null

  const active = project.dragons[activeId]
  const other = project.dragons[otherId]
  if (!active || !other) return null

  if (active.motherId === otherId) return 'Mother'
  if (active.fatherId === otherId) return 'Father'

  if (other.motherId === activeId || other.fatherId === activeId) {
    return childLabel(other.sex)
  }

  if (shareAChild(activeId, otherId, childrenIndex)) return 'Mate'

  if (areSiblings(active, other)) {
    return shareBothParents(active, other) || sameSiblingGroup(active, other)
      ? 'Sibling'
      : 'Half-sibling'
  }

  const up = ancestorDepth(project, activeId, otherId)
  if (up !== null) return ancestorLabel(up, other.sex)

  const down = descendantDepth(activeId, otherId, childrenIndex)
  if (down !== null) return descendantLabel(down, other.sex)

  for (const parentId of [active.motherId, active.fatherId]) {
    if (!parentId) continue
    const parent = project.dragons[parentId]
    if (!parent) continue
    if (areSiblings(parent, other)) return auntUncleLabel(other.sex)
  }

  for (const parentId of [other.motherId, other.fatherId]) {
    if (!parentId) continue
    const parent = project.dragons[parentId]
    if (!parent) continue
    if (areSiblings(active, parent)) return nieceNephewLabel(other.sex)
  }

  for (const parentId of [active.motherId, active.fatherId]) {
    if (!parentId) continue
    const parent = project.dragons[parentId]
    if (!parent) continue
    for (const dragon of Object.values(project.dragons)) {
      if (dragon.id === parentId || dragon.id === activeId) continue
      if (!areSiblings(parent, dragon)) continue
      if (
        other.motherId === dragon.id ||
        other.fatherId === dragon.id
      ) {
        return 'Cousin'
      }
    }
  }

  return null
}

function sameSiblingGroup(a: Dragon, b: Dragon): boolean {
  return Boolean(a.siblingGroupId && a.siblingGroupId === b.siblingGroupId)
}

function shareAChild(
  aId: string,
  bId: string,
  childrenIndex: ChildrenIndex,
): boolean {
  const aKids = childrenIndex[aId] ?? []
  const bSet = new Set(childrenIndex[bId] ?? [])
  return aKids.some((id) => bSet.has(id))
}

/** Steps from `startId` up to `targetId` via mother/father (1 = parent). */
function ancestorDepth(
  project: Project,
  startId: string,
  targetId: string,
): number | null {
  const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }]
  const seen = new Set<string>([startId])

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    const dragon = project.dragons[id]
    if (!dragon) continue
    for (const parentId of [dragon.motherId, dragon.fatherId]) {
      if (!parentId || seen.has(parentId)) continue
      if (parentId === targetId) return depth + 1
      seen.add(parentId)
      queue.push({ id: parentId, depth: depth + 1 })
    }
  }
  return null
}

/** Steps from `startId` down to `targetId` via children (1 = child). */
function descendantDepth(
  startId: string,
  targetId: string,
  childrenIndex: ChildrenIndex,
): number | null {
  const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }]
  const seen = new Set<string>([startId])

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    for (const childId of childrenIndex[id] ?? []) {
      if (seen.has(childId)) continue
      if (childId === targetId) return depth + 1
      seen.add(childId)
      queue.push({ id: childId, depth: depth + 1 })
    }
  }
  return null
}

function childLabel(sex: DragonSex): string {
  if (sex === 'female') return 'Daughter'
  if (sex === 'male') return 'Son'
  return 'Child'
}

function ancestorLabel(depth: number, sex: DragonSex): string {
  if (depth === 1) {
    if (sex === 'female') return 'Mother'
    if (sex === 'male') return 'Father'
    return 'Parent'
  }
  const base =
    sex === 'female'
      ? 'grandmother'
      : sex === 'male'
        ? 'grandfather'
        : 'grandparent'
  return withGreats(depth, base)
}

function descendantLabel(depth: number, sex: DragonSex): string {
  if (depth === 1) return childLabel(sex)
  const base =
    sex === 'female'
      ? 'granddaughter'
      : sex === 'male'
        ? 'grandson'
        : 'grandchild'
  return withGreats(depth, base)
}

function auntUncleLabel(sex: DragonSex): string {
  if (sex === 'female') return 'Aunt'
  if (sex === 'male') return 'Uncle'
  return "Parent's sibling"
}

function nieceNephewLabel(sex: DragonSex): string {
  if (sex === 'female') return 'Niece'
  if (sex === 'male') return 'Nephew'
  return "Sibling's child"
}

/** depth 2 → Grandmother; depth 3 → Great-grandmother; … */
function withGreats(depth: number, base: string): string {
  let label = base
  for (let i = 0; i < depth - 2; i++) {
    label = `great-${label}`
  }
  return label.charAt(0).toUpperCase() + label.slice(1)
}
