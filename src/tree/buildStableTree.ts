import type { Dragon, Project } from '../data/models'
import { buildChildrenIndex, listDragons } from './graph'
import {
  normalizePlaced,
  packSubtree,
  SIBLING_GAP,
  type LayoutSlot,
} from './packSubtree'
import { areSiblings, shareAParent, shareBothParents } from './relations'
import type {
  TreeLayout,
  TreeLayoutEdge,
  TreeLayoutSiblingEdge,
} from './treeLayout'

export type StableTreeOptions = {
  /** Max depth from bloodline roots. Infinity = full tree. */
  maxGenerations?: number
}

/**
 * Stable lineage layout for edit mode.
 * Roots sit at the top; children flow downward.
 * Selecting or renaming a dragon does not re-root or reshuffle packing order.
 *
 * Generations are assigned from the full graph (not from pack order), so adding
 * a mate/root cannot pull an existing child up a generation.
 *
 * Explicit sibling groups sit on one row with a horizontal link until a shared
 * parent is confirmed (then the lineage fork appears via parent edges).
 *
 * Unlinked isolates (no parents, children, or sibling group) stay out of the
 * packed layout so Create dragon can place them freely on the canvas.
 */
export function buildStableTree(
  project: Project,
  options: StableTreeOptions = {},
): TreeLayout | null {
  const dragons = listDragonsStable(project)
  if (dragons.length === 0) return null

  const maxGenerations = options.maxGenerations ?? Number.POSITIVE_INFINITY
  const childrenIndex = buildChildrenIndex(project)
  const generations = computeGenerations(project)

  const active = dragons.filter(
    (dragon) => !isUnlinkedIsolate(project, dragon.id, childrenIndex),
  )
  if (active.length === 0) return null
  const activeIds = new Set(active.map((dragon) => dragon.id))

  const roots = findRoots(project).filter((root) => activeIds.has(root.id))
  const bloodlineRoots = roots.filter(
    (root) => !isMateOnlyRoot(project, root.id, childrenIndex),
  )
  const mateRoots = roots.filter((root) =>
    isMateOnlyRoot(project, root.id, childrenIndex),
  )

  const placed = new Map<string, LayoutSlot>()
  const edges: TreeLayoutEdge[] = []
  const edgeKeys = new Set<string>()

  function addEdge(parentId: string, childId: string) {
    if (!activeIds.has(parentId) || !activeIds.has(childId)) return
    const key = `${parentId}->${childId}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ parentId, childId })
  }

  let cursor = 0

  function placeBesidePartner(rootId: string, kidIds: string[]) {
    const kidSlots = kidIds.map((id) => placed.get(id)!)
    const mid =
      (Math.min(...kidSlots.map((s) => s.x)) +
        Math.max(...kidSlots.map((s) => s.x))) /
      2
    const generation = generations.get(rootId) ?? kidSlots[0]!.generation - 1
    const dragon = project.dragons[rootId]
    if (!dragon) return

    const partnerIds: string[] = []
    for (const kidId of kidIds) {
      const kid = project.dragons[kidId]
      if (!kid) continue
      for (const parentId of [kid.motherId, kid.fatherId]) {
        if (
          parentId &&
          parentId !== rootId &&
          placed.has(parentId) &&
          !partnerIds.includes(parentId)
        ) {
          partnerIds.push(parentId)
        }
      }
    }

    const step = 1 + SIBLING_GAP
    let x = mid

    if (partnerIds.length > 0) {
      // Sit beside the existing partner - do not jump to kids' midpoint alone
      // (that parked mates between unrelated siblings).
      const partnerX = placed.get(partnerIds[0]!)!.x
      const left = partnerX - step
      const right = partnerX + step
      const preferred = dragon.sex === 'female' ? left : right
      const fallback = dragon.sex === 'female' ? right : left

      // Never sit under anyone in the row above - that reads as a false
      // parent link (Nila under Sidhe) and invites vertical crossings.
      const aboveColumns = new Set<number>()
      for (const [, slot] of placed) {
        if (Math.abs(slot.generation - (generation - 1)) < 0.01) {
          aboveColumns.add(slot.x)
        }
      }
      for (const partnerId of partnerIds) {
        const partner = project.dragons[partnerId]
        if (!partner) continue
        for (const parentId of [partner.motherId, partner.fatherId]) {
          if (!parentId || parentId === rootId) continue
          const slot = placed.get(parentId)
          if (slot) aboveColumns.add(slot.x)
        }
      }

      const blocked = (tx: number) => {
        if ([...aboveColumns].some((col) => Math.abs(col - tx) < 0.51)) {
          return true
        }
        return [...placed.entries()].some(
          ([id, slot]) =>
            id !== rootId &&
            slot.generation === generation &&
            Math.abs(slot.x - tx) < 0.51,
        )
      }

      const candidates: number[] = [preferred, fallback]
      for (let ring = 2; ring <= 10; ring++) {
        candidates.push(partnerX - ring * step, partnerX + ring * step)
      }
      const free = candidates.find((tx) => !blocked(tx))
      if (free !== undefined) {
        x = free
      } else {
        // Keep walking outward rather than falling back under a parent column.
        let found = preferred
        for (let ring = 11; ring <= 24; ring++) {
          const left = partnerX - ring * step
          const right = partnerX + ring * step
          if (!blocked(left)) {
            found = left
            break
          }
          if (!blocked(right)) {
            found = right
            break
          }
        }
        x = found
      }
    } else if (dragon.sex === 'female') {
      x = mid - step
    } else if (dragon.sex === 'male') {
      x = mid + step
    }

    // Last guard - never sit on an occupied cell in this row or under the row above.
    {
      const above = new Set<number>()
      for (const [, slot] of placed) {
        if (Math.abs(slot.generation - (generation - 1)) < 0.01) {
          above.add(slot.x)
        }
      }
      const taken = (tx: number) =>
        [...above].some((col) => Math.abs(col - tx) < 0.51) ||
        [...placed.entries()].some(
          ([id, slot]) =>
            id !== rootId &&
            slot.generation === generation &&
            Math.abs(slot.x - tx) < 0.51,
        )
      if (taken(x)) {
        let found = x
        for (let ring = 1; ring <= 24; ring++) {
          const left = x - ring * step
          const right = x + ring * step
          if (!taken(left)) {
            found = left
            break
          }
          if (!taken(right)) {
            found = right
            break
          }
        }
        x = found
      }
    }

    placed.set(rootId, { generation, x })
    for (const childId of kidIds) addEdge(rootId, childId)
  }

  function placeForest(rootId: string) {
    if (!activeIds.has(rootId)) return
    if (placed.has(rootId)) return

    const childIds = (childrenIndex[rootId] ?? []).filter((id) =>
      activeIds.has(id),
    )
    const placedKids = childIds.filter((id) => placed.has(id))
    const unplacedKids = childIds.filter((id) => !placed.has(id))

    if (placedKids.length > 0 && unplacedKids.length === 0) {
      placeBesidePartner(rootId, placedKids)
      return
    }

    const local = new Map<string, LayoutSlot>()
    const part = packSubtree(
      rootId,
      generations.get(rootId) ?? 0,
      maxGenerations === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : (generations.get(rootId) ?? 0) + maxGenerations,
      childrenIndex,
      local,
      addEdge,
    )

    for (const [id, slot] of local) {
      if (!activeIds.has(id)) continue
      if (placed.has(id)) continue
      placed.set(id, {
        generation: generations.get(id) ?? slot.generation,
        x: slot.x + cursor,
      })
    }

    cursor += Math.max(part.width, 1) + SIBLING_GAP
  }

  for (const root of bloodlineRoots) {
    placeForest(root.id)
  }
  for (const root of mateRoots) {
    placeForest(root.id)
  }
  for (const dragon of active) {
    placeForest(dragon.id)
  }

  for (const [id, slot] of placed) {
    const generation = generations.get(id)
    if (generation !== undefined && generation !== slot.generation) {
      placed.set(id, { generation, x: slot.x })
    }
  }

  clusterSiblingGroups(project, placed, childrenIndex, generations)
  clearCoupleGaps(project, placed, childrenIndex)
  separateCoParentGroups(project, placed, childrenIndex)
  unstackFromNonParents(project, placed)
  resolveOverlaps(placed)

  const siblingEdges = buildSiblingEdges(project, placed)
  const { nodes, minGeneration, maxGeneration } = normalizePlaced(placed)
  if (nodes.length === 0) return null

  return {
    focusId: bloodlineRoots[0]?.id ?? roots[0]?.id ?? nodes[0]!.dragonId,
    nodes,
    edges,
    siblingEdges,
    minGeneration,
    maxGeneration,
  }
}

/** Id order - never name - so rename does not reshuffle the tree. */
function listDragonsStable(project: Project) {
  return Object.values(project.dragons).sort((a, b) => a.id.localeCompare(b.id))
}

function findRoots(project: Project) {
  const dragons = listDragonsStable(project)
  const roots = dragons.filter((dragon) => {
    const motherMissing =
      dragon.motherId === null || !(dragon.motherId in project.dragons)
    const fatherMissing =
      dragon.fatherId === null || !(dragon.fatherId in project.dragons)
    return motherMissing && fatherMissing
  })

  return roots.length > 0 ? roots : dragons
}

/** No parents, no children, no sibling-group mates - a blank Create dragon. */
export function isUnlinkedIsolate(
  project: Project,
  dragonId: string,
  childrenIndex: ReturnType<typeof buildChildrenIndex> = buildChildrenIndex(project),
): boolean {
  const dragon = project.dragons[dragonId]
  if (!dragon) return true

  const hasMother =
    dragon.motherId !== null && dragon.motherId in project.dragons
  const hasFather =
    dragon.fatherId !== null && dragon.fatherId in project.dragons
  if (hasMother || hasFather) return false

  if ((childrenIndex[dragonId] ?? []).length > 0) return false

  if (dragon.siblingGroupId) {
    for (const other of Object.values(project.dragons)) {
      if (
        other.id !== dragonId &&
        other.siblingGroupId === dragon.siblingGroupId
      ) {
        return false
      }
    }
  }

  return true
}

function isMateOnlyRoot(
  project: Project,
  rootId: string,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
): boolean {
  const childIds = childrenIndex[rootId] ?? []
  if (childIds.length === 0) return false

  return childIds.every((childId) => {
    const child = project.dragons[childId]
    if (!child) return false
    const otherId = child.motherId === rootId ? child.fatherId : child.motherId
    return Boolean(otherId && project.dragons[otherId])
  })
}

function shiftNodeAndDescendants(
  rootId: string,
  delta: number,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
  placed: Map<string, LayoutSlot>,
) {
  if (delta === 0 || !Number.isFinite(delta)) return
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const slot = placed.get(id)
    if (slot) {
      placed.set(id, { generation: slot.generation, x: slot.x + delta })
    }
    for (const childId of childrenIndex[id] ?? []) {
      stack.push(childId)
    }
  }
}

function setNodeX(
  id: string,
  x: number,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
  placed: Map<string, LayoutSlot>,
) {
  const slot = placed.get(id)
  if (!slot) return
  shiftNodeAndDescendants(id, x - slot.x, childrenIndex, placed)
}

/** Mother+father pairs that share at least one child. */
function findCouples(project: Project): [string, string][] {
  const pairs = new Map<string, [string, string]>()
  for (const dragon of Object.values(project.dragons)) {
    const motherId = dragon.motherId
    const fatherId = dragon.fatherId
    if (!motherId || !fatherId) continue
    if (!project.dragons[motherId] || !project.dragons[fatherId]) continue
    const key = motherId < fatherId ? `${motherId}|${fatherId}` : `${fatherId}|${motherId}`
    pairs.set(key, [motherId, fatherId])
  }
  return [...pairs.values()]
}

function areKin(
  project: Project,
  aId: string,
  bId: string,
): boolean {
  const a = project.dragons[aId]
  const b = project.dragons[bId]
  if (!a || !b) return false
  if (shareAParent(a, b)) return true
  if (a.siblingGroupId && a.siblingGroupId === b.siblingGroupId) return true
  return false
}

/**
 * If anyone sits between a mother/father pair on the same row, move them
 * outside the couple. Does not re-anchor the whole tree around couples.
 */
function clearCoupleGaps(
  project: Project,
  placed: Map<string, LayoutSlot>,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
) {
  const step = 1 + SIBLING_GAP
  const couples = findCouples(project)

  for (let iter = 0; iter < 8; iter++) {
    let changed = false

    for (const [aId, bId] of couples) {
      const a = placed.get(aId)
      const b = placed.get(bId)
      if (!a || !b || a.generation !== b.generation) continue

      const leftId = a.x <= b.x ? aId : bId
      const rightId = a.x <= b.x ? bId : aId
      const lo = placed.get(leftId)!.x
      const hi = placed.get(rightId)!.x
      if (hi - lo < step - 1e-6) continue

      const interlopers = [...placed.entries()]
        .filter(([id, slot]) => {
          if (id === leftId || id === rightId) return false
          if (slot.generation !== a.generation) return false
          return slot.x > lo + 1e-6 && slot.x < hi - 1e-6
        })
        .sort((p, q) => p[1].x - q[1].x)

      if (interlopers.length === 0) continue

      const toLeft = interlopers
        .filter(([id]) => {
          const kinLeft = areKin(project, id, leftId)
          const kinRight = areKin(project, id, rightId)
          if (kinLeft && !kinRight) return true
          if (kinRight && !kinLeft) return false
          const slot = placed.get(id)!
          return slot.x - lo <= hi - slot.x
        })
        .sort((p, q) => q[1].x - p[1].x)

      const toRight = interlopers
        .filter(([id]) => !toLeft.some(([other]) => other === id))
        .sort((p, q) => p[1].x - q[1].x)

      let leftCursor = lo
      for (const [id] of toLeft) {
        leftCursor -= step
        const slot = placed.get(id)
        if (!slot) continue
        if (Math.abs(leftCursor - slot.x) > 1e-6) {
          setNodeX(id, leftCursor, childrenIndex, placed)
          changed = true
        }
      }

      let rightCursor = hi
      for (const [id] of toRight) {
        rightCursor += step
        const slot = placed.get(id)
        if (!slot) continue
        if (Math.abs(rightCursor - slot.x) > 1e-6) {
          setNodeX(id, rightCursor, childrenIndex, placed)
          changed = true
        }
      }
    }

    if (!changed) break
  }
}

/**
 * After generation sync / couple nudges, two dragons can share a cell.
 * Push later ids right on that row until every pair has at least one step gap.
 */
function resolveOverlaps(placed: Map<string, LayoutSlot>) {
  const step = 1 + SIBLING_GAP

  for (let iter = 0; iter < 24; iter++) {
    let changed = false
    const byGen = new Map<number, { id: string; x: number }[]>()

    for (const [id, slot] of placed) {
      const row = byGen.get(slot.generation) ?? []
      row.push({ id, x: slot.x })
      byGen.set(slot.generation, row)
    }

    for (const row of byGen.values()) {
      row.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1]!
        const curr = row[i]!
        if (curr.x - prev.x >= step - 1e-6) continue
        const target = prev.x + step
        const slot = placed.get(curr.id)
        if (!slot) continue
        placed.set(curr.id, { generation: slot.generation, x: target })
        curr.x = target
        changed = true
      }
    }

    if (!changed) break
  }
}

/**
 * Kids of one parent with different co-parents (Belthil×Sidhe vs Belthil×Morilinde)
 * get an extra horizontal gap so their couple bars do not touch.
 */
function separateCoParentGroups(
  project: Project,
  placed: Map<string, LayoutSlot>,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
) {
  const step = 1 + SIBLING_GAP
  const extra = step

  for (const parentId of Object.keys(project.dragons)) {
    const childIds = (childrenIndex[parentId] ?? []).filter((id) =>
      placed.has(id),
    )
    if (childIds.length < 2) continue

    const groups = new Map<string, string[]>()
    for (const childId of childIds) {
      const child = project.dragons[childId]
      if (!child) continue
      const other =
        child.motherId === parentId
          ? (child.fatherId ?? 'solo')
          : (child.motherId ?? 'solo')
      const list = groups.get(other) ?? []
      list.push(childId)
      groups.set(other, list)
    }
    if (groups.size < 2) continue

    const ordered = [...groups.values()]
      .map((ids) => {
        const xs = ids.map((id) => placed.get(id)!.x)
        return {
          ids,
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
        }
      })
      .sort((a, b) => a.minX - b.minX)

    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]!
      const curr = ordered[i]!
      const need = prev.maxX + step + extra
      if (curr.minX >= need - 1e-6) continue
      const delta = need - curr.minX
      for (const id of curr.ids) {
        shiftNodeAndDescendants(id, delta, childrenIndex, placed)
      }
      curr.minX += delta
      curr.maxX += delta
    }
  }
}

/**
 * If a dragon sits directly under someone who is not their parent, move them.
 * Stops mates (Nila under Sidhe) from reading as parent→child.
 */
function unstackFromNonParents(
  project: Project,
  placed: Map<string, LayoutSlot>,
) {
  const step = 1 + SIBLING_GAP

  for (let iter = 0; iter < 12; iter++) {
    let changed = false

    for (const [id, slot] of [...placed.entries()]) {
      const dragon = project.dragons[id]
      if (!dragon) continue

      const above = [...placed.entries()].find(
        ([otherId, other]) =>
          otherId !== id &&
          Math.abs(other.x - slot.x) < 0.51 &&
          other.generation === slot.generation - 1,
      )
      if (!above) continue

      const [aboveId] = above
      if (dragon.motherId === aboveId || dragon.fatherId === aboveId) continue

      const taken = (tx: number) =>
        [...placed.entries()].some(
          ([otherId, other]) =>
            otherId !== id &&
            other.generation === slot.generation &&
            Math.abs(other.x - tx) < 0.51,
        ) ||
        [...placed.entries()].some(
          ([otherId, other]) =>
            otherId !== id &&
            other.generation === slot.generation - 1 &&
            Math.abs(other.x - tx) < 0.51,
        )

      let nextX: number | null = null
      for (let ring = 1; ring <= 16; ring++) {
        const right = slot.x + ring * step
        const left = slot.x - ring * step
        if (!taken(right)) {
          nextX = right
          break
        }
        if (!taken(left)) {
          nextX = left
          break
        }
      }
      if (nextX === null || Math.abs(nextX - slot.x) < 1e-6) continue
      placed.set(id, { generation: slot.generation, x: nextX })
      changed = true
    }

    if (!changed) break
  }
}

/** Sit free-root sibling-group members on one row. */
function clusterSiblingGroups(
  project: Project,
  placed: Map<string, LayoutSlot>,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
  generations: Map<string, number>,
) {
  const groups = new Map<string, string[]>()
  for (const id of placed.keys()) {
    const groupId = project.dragons[id]?.siblingGroupId
    if (!groupId) continue
    const list = groups.get(groupId) ?? []
    list.push(id)
    groups.set(groupId, list)
  }

  function isFreeRoot(id: string): boolean {
    const dragon = project.dragons[id]
    if (!dragon) return false
    const motherMissing =
      dragon.motherId === null || !(dragon.motherId in project.dragons)
    const fatherMissing =
      dragon.fatherId === null || !(dragon.fatherId in project.dragons)
    return motherMissing && fatherMissing
  }

  for (const ids of groups.values()) {
    if (ids.length < 2) continue

    // Only cluster members without parents in the project.
    const free = ids.filter((id) => placed.has(id) && isFreeRoot(id))
    if (free.length < 2) continue

    const generation = Math.max(
      ...free.map(
        (id) => generations.get(id) ?? placed.get(id)?.generation ?? 0,
      ),
    )

    const sorted = [...free].sort(
      (a, b) => (placed.get(a)?.x ?? 0) - (placed.get(b)?.x ?? 0),
    )
    const startX = placed.get(sorted[0]!)?.x ?? 0
    const step = 1 + SIBLING_GAP

    sorted.forEach((id, index) => {
      const slot = placed.get(id)
      if (!slot) return
      const targetX = startX + index * step
      const delta = targetX - slot.x
      shiftNodeAndDescendants(id, delta, childrenIndex, placed)
      const after = placed.get(id)
      if (after) {
        placed.set(id, { generation, x: after.x })
      }
    })
  }
}

function buildSiblingEdges(
  project: Project,
  placed: Map<string, LayoutSlot>,
): TreeLayoutSiblingEdge[] {
  const byGen = new Map<number, string[]>()
  for (const [id, slot] of placed) {
    const list = byGen.get(slot.generation) ?? []
    list.push(id)
    byGen.set(slot.generation, list)
  }

  const edges: TreeLayoutSiblingEdge[] = []
  const seen = new Set<string>()

  for (const ids of byGen.values()) {
    const sorted = [...ids].sort(
      (a, b) => (placed.get(a)?.x ?? 0) - (placed.get(b)?.x ?? 0),
    )
    for (let i = 0; i < sorted.length; i++) {
      const aId = sorted[i]!
      const a = project.dragons[aId]
      if (!a) continue
      for (let j = i + 1; j < sorted.length; j++) {
        const bId = sorted[j]!
        const b = project.dragons[bId]
        if (!b) continue
        if (!areSiblings(a, b)) continue
        // Full siblings already hang from a shared parental fork.
        if (shareBothParents(a, b)) continue
        const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({ aId, bId })
        }
        break
      }
    }
  }
  return edges
}

/**
 * Generation = longest parent chain; co-parents are equalized to one band.
 * Members of a sibling group share one generation row.
 */
export function computeGenerations(project: Project): Map<string, number> {
  const dragons = listDragons(project)
  const gens = new Map<string, number>()
  for (const dragon of dragons) gens.set(dragon.id, 0)

  let changed = true
  let guard = 0
  while (changed && guard < dragons.length + 2) {
    changed = false
    guard += 1

    for (const dragon of dragons) {
      let g = gens.get(dragon.id) ?? 0
      for (const parentId of [dragon.motherId, dragon.fatherId]) {
        if (!parentId || !project.dragons[parentId]) continue
        g = Math.max(g, (gens.get(parentId) ?? 0) + 1)
      }
      if (g !== gens.get(dragon.id)) {
        gens.set(dragon.id, g)
        changed = true
      }
    }

    for (const dragon of dragons) {
      const parentIds = [dragon.motherId, dragon.fatherId].filter(
        (id): id is string => Boolean(id && project.dragons[id]),
      )
      if (parentIds.length === 0) continue

      const childGen = gens.get(dragon.id) ?? 0
      const target = Math.max(
        childGen - 1,
        ...parentIds.map((id) => gens.get(id) ?? 0),
      )
      for (const parentId of parentIds) {
        if ((gens.get(parentId) ?? 0) < target) {
          gens.set(parentId, target)
          changed = true
        }
      }
    }

    const groups = new Map<string, Dragon[]>()
    for (const dragon of dragons) {
      if (!dragon.siblingGroupId) continue
      const list = groups.get(dragon.siblingGroupId) ?? []
      list.push(dragon)
      groups.set(dragon.siblingGroupId, list)
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue
      const maxG = Math.max(...members.map((d) => gens.get(d.id) ?? 0))
      for (const member of members) {
        if ((gens.get(member.id) ?? 0) < maxG) {
          gens.set(member.id, maxG)
          changed = true
        }
      }
    }
  }

  return gens
}
