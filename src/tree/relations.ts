import {
  createDragon,
  type Dragon,
  type DragonDraft,
  type Project,
} from '../data/models'
import { createId } from '../utils/id'
import { assertCanSetParent, RelationError } from './validation'

export type RelationResult =
  | { ok: true; project: Project; dragonId?: string }
  | { ok: false; error: string }

function withDragon(project: Project, dragon: Dragon): Project {
  return {
    ...project,
    dragons: { ...project.dragons, [dragon.id]: dragon },
  }
}

function clearCanvasPos(dragon: Dragon): Dragon {
  if (dragon.posX === null && dragon.posY === null) return dragon
  return { ...dragon, posX: null, posY: null }
}

export function addDragon(
  project: Project,
  draft: DragonDraft = {},
): RelationResult {
  const dragon = createDragon(draft)

  if (dragon.motherId !== null) {
    try {
      assertCanSetParent(project, dragon.id, dragon.motherId)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof RelationError ? error.message : 'Invalid mother.',
      }
    }
    if (!(dragon.motherId in project.dragons)) {
      return { ok: false, error: 'Mother does not exist.' }
    }
  }

  if (dragon.fatherId !== null) {
    try {
      // Temporary project including the new dragon for cycle checks against father
      // after mother is already on the draft — check against existing graph + self.
      assertCanSetParent(project, dragon.id, dragon.fatherId)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof RelationError ? error.message : 'Invalid father.',
      }
    }
    if (!(dragon.fatherId in project.dragons)) {
      return { ok: false, error: 'Father does not exist.' }
    }
  }

  if (dragon.motherId && dragon.fatherId && dragon.motherId === dragon.fatherId) {
    return { ok: false, error: 'Mother and father must be different dragons.' }
  }

  let dragons: Project['dragons'] = {
    ...project.dragons,
    [dragon.id]: dragon,
  }
  if (dragon.motherId !== null) {
    dragons[dragon.motherId] = clearCanvasPos(dragons[dragon.motherId]!)
  }
  if (dragon.fatherId !== null) {
    dragons[dragon.fatherId] = clearCanvasPos(dragons[dragon.fatherId]!)
  }

  return {
    ok: true,
    project: { ...project, dragons },
    dragonId: dragon.id,
  }
}

export function updateDragonFields(
  project: Project,
  dragonId: string,
  patch: Partial<Omit<Dragon, 'id' | 'motherId' | 'fatherId'>>,
): RelationResult {
  const existing = project.dragons[dragonId]
  if (!existing) return { ok: false, error: 'Dragon not found.' }

  return {
    ok: true,
    project: withDragon(project, { ...existing, ...patch, id: dragonId }),
    dragonId,
  }
}

export function setMother(
  project: Project,
  childId: string,
  motherId: string | null,
): RelationResult {
  const child = project.dragons[childId]
  if (!child) return { ok: false, error: 'Dragon not found.' }

  try {
    assertCanSetParent(project, childId, motherId)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RelationError ? error.message : 'Invalid mother.',
    }
  }

  if (motherId !== null) {
    const mother = project.dragons[motherId]
    if (mother.sex !== 'female') {
      return { ok: false, error: 'Only a female dragon can be set as mother.' }
    }
    if (motherId === child.fatherId) {
      return { ok: false, error: 'Mother and father must be different dragons.' }
    }
  }

  let dragons: Project['dragons'] = {
    ...project.dragons,
    [childId]: { ...clearCanvasPos(child), motherId },
  }
  if (motherId !== null) {
    dragons[motherId] = clearCanvasPos(dragons[motherId]!)
  }

  return {
    ok: true,
    project: { ...project, dragons },
    dragonId: childId,
  }
}

export function setFather(
  project: Project,
  childId: string,
  fatherId: string | null,
): RelationResult {
  const child = project.dragons[childId]
  if (!child) return { ok: false, error: 'Dragon not found.' }

  try {
    assertCanSetParent(project, childId, fatherId)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RelationError ? error.message : 'Invalid father.',
    }
  }

  if (fatherId !== null) {
    const father = project.dragons[fatherId]
    if (father.sex !== 'male') {
      return { ok: false, error: 'Only a male dragon can be set as father.' }
    }
    if (fatherId === child.motherId) {
      return { ok: false, error: 'Mother and father must be different dragons.' }
    }
  }

  let dragons: Project['dragons'] = {
    ...project.dragons,
    [childId]: { ...clearCanvasPos(child), fatherId },
  }
  if (fatherId !== null) {
    dragons[fatherId] = clearCanvasPos(dragons[fatherId]!)
  }

  return {
    ok: true,
    project: { ...project, dragons },
    dragonId: childId,
  }
}

/** `parentId` becomes mother or father of `childId` based on parent sex. */
export function linkAsParent(
  project: Project,
  parentId: string,
  childId: string,
): RelationResult {
  const parent = project.dragons[parentId]
  if (!parent) return { ok: false, error: 'Dragon not found.' }
  if (parent.sex === 'female') return setMother(project, childId, parentId)
  return setFather(project, childId, parentId)
}

/** `childId` becomes child of `parentId` (parent sex picks the slot). */
export function linkAsChild(
  project: Project,
  childId: string,
  parentId: string,
): RelationResult {
  return linkAsParent(project, parentId, childId)
}

/**
 * Mark A and B as siblings via a shared siblingGroupId.
 * Does not copy parents - a shared parent (and the lineage fork) only appears
 * when the player explicitly links someone as parent of both.
 */
export function linkAsSiblings(
  project: Project,
  aId: string,
  bId: string,
): RelationResult {
  const a = project.dragons[aId]
  const b = project.dragons[bId]
  if (!a || !b) return { ok: false, error: 'Dragon not found.' }
  if (aId === bId) {
    return { ok: false, error: 'A dragon cannot be a sibling of itself.' }
  }

  if (areSiblings(a, b)) {
    return { ok: false, error: 'Those dragons are already siblings.' }
  }

  const groupId = a.siblingGroupId ?? b.siblingGroupId ?? createId()
  let dragons: Project['dragons'] = { ...project.dragons }

  const joinGroup = (id: string, fromGroup: string | null) => {
    if (fromGroup && fromGroup !== groupId) {
      for (const [otherId, dragon] of Object.entries(dragons)) {
        if (dragon.siblingGroupId === fromGroup) {
          dragons[otherId] = { ...dragon, siblingGroupId: groupId }
        }
      }
    }
    const current = dragons[id]!
    if (current.siblingGroupId !== groupId) {
      dragons[id] = { ...current, siblingGroupId: groupId }
    }
  }

  joinGroup(aId, a.siblingGroupId)
  joinGroup(bId, b.siblingGroupId)

  for (const [id, dragon] of Object.entries(dragons)) {
    if (dragon.siblingGroupId === groupId) {
      dragons[id] = clearCanvasPos(dragon)
    }
  }

  return {
    ok: true,
    project: { ...project, dragons },
    dragonId: aId,
  }
}

export function areSiblings(a: Dragon, b: Dragon): boolean {
  if (a.id === b.id) return false
  if (a.siblingGroupId && a.siblingGroupId === b.siblingGroupId) return true
  if (a.motherId && a.motherId === b.motherId) return true
  if (a.fatherId && a.fatherId === b.fatherId) return true
  return false
}

export function shareAParent(a: Dragon, b: Dragon): boolean {
  if (a.motherId && a.motherId === b.motherId) return true
  if (a.fatherId && a.fatherId === b.fatherId) return true
  return false
}

/**
 * Full siblings: each parent slot matches on both dragons.
 * Same id matches; both missing also matches. One set and one missing
 * (or different ids) means half-siblings.
 */
export function shareBothParents(a: Dragon, b: Dragon): boolean {
  return a.motherId === b.motherId && a.fatherId === b.fatherId
}

export function canLinkAsParent(parent: Dragon, child: Dragon): boolean {
  if (parent.sex === 'female') return child.motherId === null
  return child.fatherId === null
}

export function canLinkAsChild(child: Dragon, parent: Dragon): boolean {
  return canLinkAsParent(parent, child)
}

export function canLinkAsSiblings(a: Dragon, b: Dragon): boolean {
  return !areSiblings(a, b)
}

/** Create a new mother and attach them to `childId`. */
export function createMotherFor(
  project: Project,
  childId: string,
  draft: DragonDraft = {},
): RelationResult {
  const created = addDragon(project, {
    ...draft,
    name: draft.name ?? 'Unnamed',
    sex: 'female',
  })
  if (!created.ok || !created.dragonId) return created
  const linked = setMother(created.project, childId, created.dragonId)
  if (!linked.ok) return linked
  return { ok: true, project: linked.project, dragonId: created.dragonId }
}

/** Create a new father and attach them to `childId`. */
export function createFatherFor(
  project: Project,
  childId: string,
  draft: DragonDraft = {},
): RelationResult {
  const created = addDragon(project, {
    ...draft,
    name: draft.name ?? 'Unnamed',
    sex: 'male',
  })
  if (!created.ok || !created.dragonId) return created
  const linked = setFather(created.project, childId, created.dragonId)
  if (!linked.ok) return linked
  return { ok: true, project: linked.project, dragonId: created.dragonId }
}

/**
 * Create a child of `parentId`.
 * Parent sex decides mother vs father link on the child.
 */
export function createChildOf(
  project: Project,
  parentId: string,
  draft: DragonDraft = {},
): RelationResult {
  const parent = project.dragons[parentId]
  if (!parent) {
    return { ok: false, error: 'Parent dragon does not exist.' }
  }

  const link =
    parent.sex === 'female' ? { motherId: parentId } : { fatherId: parentId }

  return addDragon(project, {
    ...draft,
    name: draft.name ?? 'Unnamed',
    sex: draft.sex ?? 'female',
    ...link,
  })
}

export function removeDragon(project: Project, dragonId: string): RelationResult {
  if (!project.dragons[dragonId]) {
    return { ok: false, error: 'Dragon not found.' }
  }

  const dragons: Project['dragons'] = { ...project.dragons }
  delete dragons[dragonId]

  for (const id of Object.keys(dragons)) {
    const dragon = dragons[id]
    let next = dragon
    if (dragon.motherId === dragonId) {
      next = { ...next, motherId: null }
    }
    if (dragon.fatherId === dragonId) {
      next = { ...next, fatherId: null }
    }
    dragons[id] = next
  }

  return { ok: true, project: { ...project, dragons } }
}
