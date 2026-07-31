import type { Project } from '../data/models'

/** Map parent id → child ids (derived; never stored). */
export type ChildrenIndex = Record<string, string[]>

export function buildChildrenIndex(project: Project): ChildrenIndex {
  const index: ChildrenIndex = {}

  for (const dragon of Object.values(project.dragons)) {
    if (dragon.motherId) {
      ;(index[dragon.motherId] ??= []).push(dragon.id)
    }
    if (dragon.fatherId) {
      ;(index[dragon.fatherId] ??= []).push(dragon.id)
    }
  }

  for (const ids of Object.values(index)) {
    ids.sort((a, b) => a.localeCompare(b))
  }

  return index
}

export function getChildren(project: Project, dragonId: string): string[] {
  return buildChildrenIndex(project)[dragonId] ?? []
}

export function listDragons(project: Project) {
  return Object.values(project.dragons).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}
