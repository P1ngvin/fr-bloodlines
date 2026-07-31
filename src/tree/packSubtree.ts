import type { ChildrenIndex } from './graph'

export type LayoutSlot = { generation: number; x: number }

/** Extra layout units between sibling subtrees (leaf siblings → Δx = 1 + gap). */
export const SIBLING_GAP = 0

export function packSubtree(
  id: string,
  generation: number,
  maxGeneration: number,
  childrenIndex: ChildrenIndex,
  placed: Map<string, LayoutSlot>,
  addEdge: (parentId: string, childId: string) => void,
): { width: number; center: number } {
  const childIds =
    generation >= maxGeneration ? [] : (childrenIndex[id] ?? [])

  if (childIds.length === 0) {
    placed.set(id, { generation, x: 0 })
    return { width: 1, center: 0 }
  }

  const parts: { id: string; width: number; center: number }[] = []
  for (const childId of childIds) {
    const part = packSubtree(
      childId,
      generation + 1,
      maxGeneration,
      childrenIndex,
      placed,
      addEdge,
    )
    parts.push({ id: childId, ...part })
    addEdge(id, childId)
  }

  let cursor = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const childSlot = placed.get(part.id)
    if (!childSlot) continue
    const targetCenter = cursor + (part.width - 1) / 2
    const delta = targetCenter - part.center
    shiftSubtree(
      part.id,
      generation + 1,
      maxGeneration,
      childrenIndex,
      placed,
      delta,
    )
    cursor += part.width
    if (i < parts.length - 1) cursor += SIBLING_GAP
  }

  const width = Math.max(cursor, 1)
  const center = (width - 1) / 2
  placed.set(id, { generation, x: center })
  return { width, center }
}

function shiftSubtree(
  rootId: string,
  rootGeneration: number,
  maxGeneration: number,
  childrenIndex: ChildrenIndex,
  placed: Map<string, LayoutSlot>,
  delta: number,
) {
  const stack = [{ id: rootId, generation: rootGeneration }]
  const seen = new Set<string>()

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || seen.has(current.id)) continue
    seen.add(current.id)

    const slot = placed.get(current.id)
    if (slot) {
      placed.set(current.id, { generation: slot.generation, x: slot.x + delta })
    }

    if (current.generation >= maxGeneration) continue
    for (const childId of childrenIndex[current.id] ?? []) {
      stack.push({ id: childId, generation: current.generation + 1 })
    }
  }
}

export function normalizePlaced(
  placed: Map<string, LayoutSlot>,
): {
  nodes: { dragonId: string; generation: number; x: number }[]
  minGeneration: number
  maxGeneration: number
} {
  let minX = Infinity
  let minGeneration = 0
  let maxGeneration = 0
  for (const slot of placed.values()) {
    minX = Math.min(minX, slot.x)
    minGeneration = Math.min(minGeneration, slot.generation)
    maxGeneration = Math.max(maxGeneration, slot.generation)
  }
  if (!Number.isFinite(minX)) minX = 0

  const nodes = [...placed.entries()].map(([dragonId, slot]) => ({
    dragonId,
    generation: slot.generation,
    x: slot.x - minX,
  }))

  nodes.sort((a, b) => a.generation - b.generation || a.x - b.x)

  return { nodes, minGeneration, maxGeneration }
}
