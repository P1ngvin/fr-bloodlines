import type { Project } from '../data/models'
import { buildChildrenIndex } from './graph'
import {
  normalizePlaced,
  packSubtree,
  SIBLING_GAP,
  type LayoutSlot,
} from './packSubtree'
import { areSiblings, shareBothParents } from './relations'
import type {
  TreeLayout,
  TreeLayoutEdge,
  TreeLayoutSiblingEdge,
} from './treeLayout'

export type FocusTreeOptions = {
  /** Ancestor depth from focus (1-). Omit / Infinity = full. 0 = focus row only. */
  ancestorGenerations?: number
  /** Descendant depth from focus (1+). Omit / Infinity = full. 0 = focus row only. */
  descendantGenerations?: number
}

/** @deprecated Use TreeLayout */
export type FocusTreeLayout = TreeLayout
export type FocusTreeNode = TreeLayout['nodes'][number]
export type FocusTreeEdge = TreeLayoutEdge

/**
 * Focus tree: selected dragon at generation 0 with siblings on the same row,
 * ancestors above (negative gens), descendants below (positive gens).
 */
export function buildFocusTree(
  project: Project,
  focusId: string,
  options: FocusTreeOptions = {},
): TreeLayout | null {
  if (!project.dragons[focusId]) return null

  const ancestorGenerations =
    options.ancestorGenerations ?? Number.POSITIVE_INFINITY
  const descendantGenerations =
    options.descendantGenerations ?? Number.POSITIVE_INFINITY
  const childrenIndex = buildChildrenIndex(project)

  const placed = new Map<string, LayoutSlot>()
  const edges: TreeLayoutEdge[] = []
  const edgeKeys = new Set<string>()

  function addEdge(parentId: string, childId: string) {
    const key = `${parentId}->${childId}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ parentId, childId })
  }

  const cohort = listFocusCohort(project, focusId)
  let cursor = 0

  for (const id of cohort) {
    const local = new Map<string, LayoutSlot>()
    const part = packSubtree(
      id,
      0,
      descendantGenerations,
      childrenIndex,
      local,
      addEdge,
      project,
    )

    let minX = Infinity
    for (const slot of local.values()) {
      minX = Math.min(minX, slot.x)
    }
    if (!Number.isFinite(minX)) minX = 0

    const delta = cursor - minX
    for (const [nodeId, slot] of local) {
      if (placed.has(nodeId)) continue
      placed.set(nodeId, {
        generation: slot.generation,
        x: slot.x + delta,
      })
    }

    cursor += Math.max(part.width, 1) + SIBLING_GAP
  }

  const focusSlot = placed.get(focusId) ?? { generation: 0, x: 0 }
  placed.set(focusId, { generation: 0, x: focusSlot.x })

  layoutAncestors(
    project,
    focusId,
    0,
    focusSlot.x,
    ancestorGenerations,
    placed,
    addEdge,
  )

  // Shared parents → edges to every cohort sibling already placed.
  for (const id of cohort) {
    if (id === focusId) continue
    const dragon = project.dragons[id]
    if (!dragon) continue
    for (const parentId of [dragon.motherId, dragon.fatherId]) {
      if (parentId && placed.has(parentId)) addEdge(parentId, id)
    }
  }

  placed.set(focusId, {
    generation: 0,
    x: placed.get(focusId)?.x ?? focusSlot.x,
  })

  const siblingEdges = buildFocusSiblingEdges(project, cohort, placed)
  const { nodes, minGeneration, maxGeneration } = normalizePlaced(placed)

  return {
    focusId,
    nodes,
    edges,
    siblingEdges,
    minGeneration,
    maxGeneration,
  }
}

/** Focus plus siblings (shared parent and/or siblingGroupId), stable id order. */
function listFocusCohort(project: Project, focusId: string): string[] {
  const focus = project.dragons[focusId]
  if (!focus) return [focusId]

  const ids = [focusId]
  for (const dragon of Object.values(project.dragons)) {
    if (dragon.id === focusId) continue
    if (areSiblings(focus, dragon)) ids.push(dragon.id)
  }
  return ids.sort((a, b) => a.localeCompare(b))
}

function buildFocusSiblingEdges(
  project: Project,
  cohort: string[],
  placed: Map<string, LayoutSlot>,
): TreeLayoutSiblingEdge[] {
  const onRow = cohort
    .filter((id) => placed.has(id))
    .sort((a, b) => (placed.get(a)?.x ?? 0) - (placed.get(b)?.x ?? 0))

  const edges: TreeLayoutSiblingEdge[] = []
  for (let i = 0; i < onRow.length - 1; i++) {
    const aId = onRow[i]!
    const bId = onRow[i + 1]!
    const a = project.dragons[aId]
    const b = project.dragons[bId]
    if (!a || !b) continue
    // Full siblings share the lineage fork; explicit sibling-group only get a bar.
    if (shareBothParents(a, b)) continue
    edges.push({ aId, bId })
  }
  return edges
}

function layoutAncestors(
  project: Project,
  id: string,
  generation: number,
  centerX: number,
  maxAncestorGenerations: number,
  placed: Map<string, LayoutSlot>,
  addEdge: (parentId: string, childId: string) => void,
) {
  const dragon = project.dragons[id]
  if (!dragon) return

  if (generation < 0) {
    const existing = placed.get(id)
    if (!existing || generation > existing.generation) {
      placed.set(id, { generation, x: centerX })
    } else if (existing.generation === generation) {
      placed.set(id, { generation, x: (existing.x + centerX) / 2 })
    }
  }

  if (-generation >= maxAncestorGenerations) return

  if (dragon.motherId && project.dragons[dragon.motherId]) {
    addEdge(dragon.motherId, id)
    layoutAncestors(
      project,
      dragon.motherId,
      generation - 1,
      centerX - 1,
      maxAncestorGenerations,
      placed,
      addEdge,
    )
  }

  if (dragon.fatherId && project.dragons[dragon.fatherId]) {
    addEdge(dragon.fatherId, id)
    layoutAncestors(
      project,
      dragon.fatherId,
      generation - 1,
      centerX + 1,
      maxAncestorGenerations,
      placed,
      addEdge,
    )
  }
}
