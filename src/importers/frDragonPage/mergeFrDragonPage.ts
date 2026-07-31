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
  })
  next = main.project
  created += main.created
  updated += main.updated
  const mainId = main.dragonId

  let parentsLinked = 0
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
  },
): { project: Project; dragonId: string; created: number; updated: number } {
  const existing = findByFrId(project, input.frId)
  const name = normalizeDisplayName(input.name, `Dragon ${input.frId}`)

  if (!existing) {
    const dragon = createDragon({
      name,
      frId: input.frId,
      sex: input.sex,
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

  if (existing.frId !== input.frId) {
    next = { ...next, frId: input.frId }
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
