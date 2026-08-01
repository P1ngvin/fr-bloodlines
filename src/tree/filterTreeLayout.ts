import { generationStagger } from './packSubtree'
import type { TreeLayout } from './treeLayout'

/**
 * Keep only `keepIds` from a layout and compact horizontal slots so Local
 * view does not inherit the full-tree width (empty columns between survivors).
 *
 * Columns are ranked from the full layout across all generations (shared
 * grid), then odd generations get a half-step stagger - same rule as
 * normalizePlaced. Re-indexing 0..n per row destroyed parent/child alignment
 * and cancelled the stagger.
 */
export function filterAndCompactLayout(
  layout: TreeLayout,
  keepIds: ReadonlySet<string>,
): TreeLayout | null {
  const kept = layout.nodes.filter((node) => keepIds.has(node.dragonId))
  if (kept.length === 0) return null

  let minGeneration = Infinity
  let maxGeneration = -Infinity
  for (const node of kept) {
    minGeneration = Math.min(minGeneration, node.generation)
    maxGeneration = Math.max(maxGeneration, node.generation)
  }

  // Work on copies; split same-generation same-x ties so they get columns.
  const working = kept.map((node) => ({ ...node }))
  const byGen = new Map<number, typeof working>()
  for (const node of working) {
    const list = byGen.get(node.generation) ?? []
    list.push(node)
    byGen.set(node.generation, list)
  }
  for (const group of byGen.values()) {
    group.sort(
      (a, b) => a.x - b.x || a.dragonId.localeCompare(b.dragonId),
    )
    let i = 0
    while (i < group.length) {
      let j = i + 1
      while (j < group.length && group[j]!.x === group[i]!.x) j += 1
      if (j - i > 1) {
        const base = group[i]!.x
        for (let k = i; k < j; k++) {
          group[k]!.x = base + (k - i) * 1e-4
        }
      }
      i = j
    }
  }

  const uniqueXs = [...new Set(working.map((node) => node.x))].sort(
    (a, b) => a - b,
  )
  const rankOf = new Map(uniqueXs.map((x, index) => [x, index]))

  const compacted = working.map((node) => ({
    ...node,
    x:
      (rankOf.get(node.x) ?? 0) +
      generationStagger(node.generation, minGeneration),
  }))

  const present = new Set(compacted.map((node) => node.dragonId))
  const edges = layout.edges.filter(
    (edge) => present.has(edge.parentId) && present.has(edge.childId),
  )
  const siblingEdges = layout.siblingEdges.filter(
    (edge) => present.has(edge.aId) && present.has(edge.bId),
  )

  return {
    focusId: present.has(layout.focusId)
      ? layout.focusId
      : compacted[0]!.dragonId,
    nodes: compacted,
    edges,
    siblingEdges,
    minGeneration,
    maxGeneration,
  }
}
