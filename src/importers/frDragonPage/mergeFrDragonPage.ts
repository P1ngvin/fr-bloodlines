import { createDragon, type Dragon, type Project } from '../../data/models'
import { setFather, setMother } from '../../tree'
import { normalizeDisplayName } from '../../utils/text'
import type { FrDragonPage, FrDragonPageImportSummary } from './types'

export type FrDragonPageMergeResult =
  | { ok: true; project: Project; summary: FrDragonPageImportSummary }
  | { ok: false; error: string }

/**
 * Upsert the parsed dragon and their listed kin into the project.
 * Offspring sex is left unknown until their own pages are imported.
 */
export function mergeFrDragonPage(
  project: Project,
  page: FrDragonPage,
): FrDragonPageMergeResult {
  let next = project
  let created = 0
  let updated = 0

  const main = upsertDragon(next, {
    frId: page.frId,
    name: page.name,
    sex: page.sex,
    forceSex: page.sex !== 'unknown',
    birthDate: page.birthDate,
    exalted: page.exalted,
    element: page.element,
  })
  next = main.project
  created += main.created
  updated += main.updated
  const mainId = main.dragonId

  let parentsLinked = 0
  if (page.parentsNone) {
    const cleared = markParentsNone(next, mainId)
    next = cleared.project
    updated += cleared.updated
  } else {
    if (page.father) {
      const father = upsertDragon(next, {
        frId: page.father.frId,
        name: page.father.name,
        sex: 'male',
        forceSex: true,
      })
      next = father.project
      created += father.created
      updated += father.updated
      const linked = setFather(next, mainId, father.dragonId)
      if (!linked.ok) return linked
      next = linked.project
      parentsLinked += 1
    }

    if (page.mother) {
      const mother = upsertDragon(next, {
        frId: page.mother.frId,
        name: page.mother.name,
        sex: 'female',
        forceSex: true,
      })
      next = mother.project
      created += mother.created
      updated += mother.updated
      const linked = setMother(next, mainId, mother.dragonId)
      if (!linked.ok) return linked
      next = linked.project
      parentsLinked += 1
    }

    if (parentsLinked > 0) {
      const clearedFlag = setParentsNoneFlag(next, mainId, false)
      next = clearedFlag.project
      updated += clearedFlag.updated
    }
  }

  const mainDragon = next.dragons[mainId]!
  let offspringLinked = 0

  if (mainDragon.sex === 'unknown') {
    // Cannot attach as parent until sex is known - still upsert offspring stubs.
    for (const child of page.offspring) {
      const stub = upsertDragon(next, {
        frId: child.frId,
        name: child.name,
        sex: 'unknown',
        forceSex: false,
      })
      next = stub.project
      created += stub.created
      updated += stub.updated
    }
  } else {
    for (const child of page.offspring) {
      const stub = upsertDragon(next, {
        frId: child.frId,
        name: child.name,
        sex: 'unknown',
        forceSex: false,
      })
      next = stub.project
      created += stub.created
      updated += stub.updated

      const link =
        mainDragon.sex === 'female'
          ? setMother(next, stub.dragonId, mainId)
          : setFather(next, stub.dragonId, mainId)
      if (!link.ok) return link
      next = link.project
      offspringLinked += 1
    }
  }

  return {
    ok: true,
    project: next,
    summary: {
      mainId,
      mainName: next.dragons[mainId]!.name,
      frId: page.frId,
      created,
      updated,
      parentsLinked,
      offspringLinked,
    },
  }
}

function upsertDragon(
  project: Project,
  input: {
    frId: string
    name: string
    sex: Dragon['sex']
    forceSex: boolean
    birthDate?: string
    /** Only set when known from the main imported page. */
    exalted?: boolean
    /** Only set when known from the main imported page. */
    element?: Dragon['element']
  },
): { project: Project; dragonId: string; created: number; updated: number } {
  const frId = input.frId.trim()
  const name = normalizeDisplayName(
    input.name,
    frId ? `Dragon ${frId}` : 'Unnamed',
  )
  const existing = findExisting(project, frId, name)
  const birthDate = input.birthDate?.trim() || ''

  if (!existing) {
    const dragon = createDragon({
      name,
      frId,
      sex: input.sex,
      birthDate,
      exalted: input.exalted === true,
      element: input.element ?? '',
    })
    return {
      project: {
        ...project,
        dragons: { ...project.dragons, [dragon.id]: dragon },
      },
      dragonId: dragon.id,
      created: 1,
      updated: 0,
    }
  }

  let next: Dragon = existing
  let changed = false

  if (name && name !== existing.name) {
    next = { ...next, name }
    changed = true
  }

  // Paste kin often lack frIds - never wipe a known id with an empty one.
  if (frId && existing.frId !== frId) {
    next = { ...next, frId }
    changed = true
  }

  if (
    input.forceSex &&
    input.sex !== 'unknown' &&
    existing.sex !== input.sex
  ) {
    next = { ...next, sex: input.sex }
    changed = true
  } else if (existing.sex === 'unknown' && input.sex !== 'unknown') {
    next = { ...next, sex: input.sex }
    changed = true
  }

  if (birthDate && birthDate !== existing.birthDate) {
    next = { ...next, birthDate }
    changed = true
  }

  // Only the main profile import knows exalted status; kin stubs leave it alone.
  if (input.exalted !== undefined && existing.exalted !== input.exalted) {
    next = { ...next, exalted: input.exalted }
    changed = true
  }

  // Same for element (from Eye Type on the main profile).
  if (
    input.element !== undefined &&
    input.element !== '' &&
    existing.element !== input.element
  ) {
    next = { ...next, element: input.element }
    changed = true
  }

  if (!changed) {
    return {
      project,
      dragonId: existing.id,
      created: 0,
      updated: 0,
    }
  }

  return {
    project: {
      ...project,
      dragons: { ...project.dragons, [existing.id]: next },
    },
    dragonId: existing.id,
    created: 0,
    updated: 1,
  }
}

function findByFrId(project: Project, frId: string): Dragon | undefined {
  for (const dragon of Object.values(project.dragons)) {
    if (dragon.frId === frId) return dragon
  }
  return undefined
}

/**
 * Prefer frId. When paste import has names only, reuse a unique same-name
 * dragon (or a single empty-frId stub when attaching a real frId).
 * Never match "Unnamed" by name alone.
 */
function findExisting(
  project: Project,
  frId: string,
  name: string,
): Dragon | undefined {
  if (frId) {
    const byId = findByFrId(project, frId)
    if (byId) return byId
  }

  if (!name || name === 'Unnamed') return undefined

  const matches = Object.values(project.dragons).filter((d) => d.name === name)
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]

  if (frId) {
    const stubs = matches.filter((d) => !d.frId)
    if (stubs.length === 1) return stubs[0]
  }
  return undefined
}

/** FR confirmed Parents: None - clear links and set the G1 flag. */
function markParentsNone(
  project: Project,
  dragonId: string,
): { project: Project; updated: number } {
  const dragon = project.dragons[dragonId]
  if (!dragon) return { project, updated: 0 }
  if (
    dragon.parentsNone &&
    dragon.motherId === null &&
    dragon.fatherId === null
  ) {
    return { project, updated: 0 }
  }
  return {
    project: {
      ...project,
      dragons: {
        ...project.dragons,
        [dragonId]: {
          ...dragon,
          motherId: null,
          fatherId: null,
          parentsNone: true,
        },
      },
    },
    updated: 1,
  }
}

function setParentsNoneFlag(
  project: Project,
  dragonId: string,
  parentsNone: boolean,
): { project: Project; updated: number } {
  const dragon = project.dragons[dragonId]
  if (!dragon || dragon.parentsNone === parentsNone) {
    return { project, updated: 0 }
  }
  return {
    project: {
      ...project,
      dragons: {
        ...project.dragons,
        [dragonId]: { ...dragon, parentsNone },
      },
    },
    updated: 1,
  }
}
