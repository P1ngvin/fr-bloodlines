import type { Dragon, Project } from '../data/models'
import { buildChildrenIndex, listDragons } from './graph'
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
  const descCount = new Map<string, number>()
  function countDescendants(id: string): number {
    const hit = descCount.get(id)
    if (hit !== undefined) return hit
    let total = 0
    for (const childId of childrenIndex[id] ?? []) {
      total += 1 + countDescendants(childId)
    }
    descCount.set(id, total)
    return total
  }
  const byForestSize = (a: Dragon, b: Dragon) =>
    countDescendants(b.id) - countDescendants(a.id) || a.id.localeCompare(b.id)

  const bloodlineRoots = roots
    .filter((root) => !isMateOnlyRoot(project, root.id, childrenIndex))
    .sort(byForestSize)
  const mateRoots = roots
    .filter((root) => isMateOnlyRoot(project, root.id, childrenIndex))
    .sort(byForestSize)

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
      const partnerId = partnerIds[0]!
      const partnerX = placed.get(partnerId)!.x
      const left = partnerX - step
      const right = partnerX + step
      // Only when this couple also has a separate brood: root mate on the right.
      const separateBrood =
        hasSeparateBrood(project, rootId, partnerId) ||
        hasSeparateBrood(project, partnerId, rootId)
      const selfRoot = !hasOwnParents(project, rootId)
      const partnerRoot = !hasOwnParents(project, partnerId)
      const preferred =
        separateBrood && selfRoot && !partnerRoot
          ? right
          : separateBrood && !selfRoot && partnerRoot
            ? left
            : dragon.sex === 'female'
              ? left
              : right
      const fallback = preferred === left ? right : left

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

    const childIds = (childrenIndex[rootId] ?? []).filter((id) =>
      activeIds.has(id),
    )
    let placedKids = childIds.filter((id) => placed.has(id))
    const unplacedKids = childIds.filter((id) => !placed.has(id))

    // Already on the map (often via placeBesidePartner as a mate). Still
    // attach edges to kids that landed earlier, then pack anyone missing.
    if (placed.has(rootId)) {
      for (const childId of placedKids) addEdge(rootId, childId)
      if (unplacedKids.length === 0) return

      const rootSlot = placed.get(rootId)!
      for (const childId of unplacedKids) {
        if (placed.has(childId)) {
          addEdge(rootId, childId)
          placedKids = [...placedKids, childId]
          continue
        }
        const local = new Map<string, LayoutSlot>()
        const childGen = generations.get(childId) ?? rootSlot.generation + 1
        packSubtree(
          childId,
          childGen,
          maxGenerations === Number.POSITIVE_INFINITY
            ? Number.POSITIVE_INFINITY
            : childGen + maxGenerations,
          childrenIndex,
          local,
          addEdge,
          project,
        )
        addEdge(rootId, childId)

        let minLocal = Infinity
        const newly: string[] = []
        for (const [id, slot] of local) {
          if (!activeIds.has(id) || placed.has(id)) continue
          newly.push(id)
          minLocal = Math.min(minLocal, slot.x)
        }
        if (newly.length === 0) continue
        if (!Number.isFinite(minLocal)) minLocal = 0

        // Park the new brood on this parent's outer side (away from a mate),
        // not always to the right of existing kids (Alder left of Aleru →
        // father-only brood left of Azalar, not far right past Aleru).
        const siblingXs = placedKids
          .map((id) => placed.get(id)?.x)
          .filter((x): x is number => x !== undefined)
        let mateX: number | null = null
        for (const kidId of placedKids) {
          const kid = project.dragons[kidId]
          if (!kid) continue
          for (const parentId of [kid.motherId, kid.fatherId]) {
            if (!parentId || parentId === rootId) continue
            const slot = placed.get(parentId)
            if (slot) {
              mateX = slot.x
              break
            }
          }
          if (mateX !== null) break
        }
        const outerLeft = mateX === null || rootSlot.x <= mateX
        const broodWidth = (() => {
          let maxLocalX = minLocal
          for (const id of newly) {
            maxLocalX = Math.max(maxLocalX, local.get(id)!.x)
          }
          return maxLocalX - minLocal
        })()
        const step = 1 + SIBLING_GAP
        let anchor = rootSlot.x
        if (siblingXs.length > 0) {
          anchor = outerLeft
            ? Math.min(...siblingXs) - step - broodWidth
            : Math.max(...siblingXs) + step
        } else if (mateX !== null) {
          anchor = outerLeft ? rootSlot.x - step - broodWidth : rootSlot.x + step
        }
        for (const id of newly) {
          const slot = local.get(id)!
          placed.set(id, {
            generation: generations.get(id) ?? slot.generation,
            x: slot.x - minLocal + anchor,
          })
        }
        placedKids = [
          ...placedKids,
          ...newly.filter((id) => (childrenIndex[rootId] ?? []).includes(id)),
        ]
      }
      return
    }

    if (placedKids.length > 0 && unplacedKids.length === 0) {
      placeBesidePartner(rootId, placedKids)
      return
    }

    const local = new Map<string, LayoutSlot>()
    packSubtree(
      rootId,
      generations.get(rootId) ?? 0,
      maxGenerations === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : (generations.get(rootId) ?? 0) + maxGenerations,
      childrenIndex,
      local,
      addEdge,
      project,
    )

    const newly: string[] = []
    let minLocal = Infinity
    let maxLocal = -Infinity
    for (const [id, slot] of local) {
      if (!activeIds.has(id) || placed.has(id)) continue
      newly.push(id)
      minLocal = Math.min(minLocal, slot.x)
      maxLocal = Math.max(maxLocal, slot.x)
    }

    if (newly.length === 0) {
      if (placedKids.length > 0) placeBesidePartner(rootId, placedKids)
      return
    }

    if (!Number.isFinite(minLocal)) minLocal = 0
    const localWidth = Math.max(maxLocal - minLocal + 1, 1)

    for (const id of newly) {
      const slot = local.get(id)!
      placed.set(id, {
        generation: generations.get(id) ?? slot.generation,
        x: slot.x - minLocal + cursor,
      })
    }

    // Forests share descendants across roots (Carl→Runefall→Romeo when Romeo
    // is already packed under Caerula). Anchor onto those kids instead of
    // reserving a fresh horizontal band for the full packed width.
    const anchors: number[] = []
    for (const id of newly) {
      for (const childId of childrenIndex[id] ?? []) {
        if (!activeIds.has(childId)) continue
        if (newly.includes(childId)) continue
        const childSlot = placed.get(childId)
        if (childSlot) anchors.push(childSlot.x)
      }
    }

    if (anchors.length > 0) {
      const anchorX =
        (Math.min(...anchors) + Math.max(...anchors)) / 2
      const xs = newly.map((id) => placed.get(id)!.x)
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2
      const delta = anchorX - mid
      for (const id of newly) {
        const slot = placed.get(id)!
        placed.set(id, { generation: slot.generation, x: slot.x + delta })
      }
      return
    }

    cursor += localWidth + SIBLING_GAP
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
  // Couples must be the last word on X - pack mates as units toward kids and
  // ancestors (never park one mate alone under their parents).
  layoutCouplesOnRows(project, placed, childrenIndex)
  layoutCouplesOnRows(project, placed, childrenIndex)
  // Slide shared broods under their parents as rigid blocks (Audora×Azalar
  // kids left behind by deep subtrees while the pair stayed with ancestors).
  alignBroodsUnderParents(project, placed, childrenIndex)
  // Collapse leftover holes between full siblings / sibling-group neighbors.
  tightenSiblingRuns(project, placed)
  // Fractional shifts can leave mates closer than one layout step
  // (Audora|Azalar glued into one card). Re-seat each same-generation mate
  // component on a strict step grid.
  enforceCoupleSpacing(project, placed)
  // Align can slide a brood into a neighbor couple (Dieter|Caerula at 0.5).
  // Enforce a full step between every consecutive card on a row.
  enforceMinRowSpacing(placed, childrenIndex)

  // Placement can seat a parent via placeBesidePartner (mate of an already
  // packed co-parent) and then skip that parent's forest forever. Their other
  // kids still land nearby via parent-midpoint packing, but without edges -
  // so rebuild every parent→child link that exists among placed dragons.
  for (const dragon of active) {
    if (!placed.has(dragon.id)) continue
    if (dragon.motherId && placed.has(dragon.motherId)) {
      addEdge(dragon.motherId, dragon.id)
    }
    if (dragon.fatherId && placed.has(dragon.fatherId)) {
      addEdge(dragon.fatherId, dragon.id)
    }
  }

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
  shiftSubtreeOnce([rootId], delta, childrenIndex, placed)
}

/**
 * After brood aligns, unrelated neighbors can sit on a half-step grid
 * (Orson: Dieter@8 Caerula@8.5). Push the right-hand side of each row so
 * consecutive cards are at least one layout step apart; move subtrees with
 * them so parent→child rails stay attached.
 */
function enforceMinRowSpacing(
  placed: Map<string, LayoutSlot>,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
) {
  const step = 1 + SIBLING_GAP
  const byGen = new Map<number, string[]>()
  for (const [id, slot] of placed) {
    const list = byGen.get(slot.generation) ?? []
    list.push(id)
    byGen.set(slot.generation, list)
  }

  const generations = [...byGen.keys()].sort((a, b) => a - b)
  for (const generation of generations) {
    const sorted = [...byGen.get(generation)!].sort(
      (a, b) =>
        (placed.get(a)?.x ?? 0) - (placed.get(b)?.x ?? 0) ||
        a.localeCompare(b),
    )
    for (let i = 1; i < sorted.length; i++) {
      const prevX = placed.get(sorted[i - 1]!)!.x
      const currX = placed.get(sorted[i]!)!.x
      if (currX - prevX >= step - 1e-6) continue
      const delta = step - (currX - prevX)
      // One walk for the suffix - shared kids of two mates are not double-shifted.
      shiftSubtreeOnce(sorted.slice(i), delta, childrenIndex, placed)
    }
  }
}

/**
 * Keep every mated pair (and hub chains Dana|Survivor|Spring) at least
 * one layout step apart on their row, preserving left→right order and midpoint.
 */
function enforceCoupleSpacing(
  project: Project,
  placed: Map<string, LayoutSlot>,
) {
  const step = 1 + SIBLING_GAP
  const parent = new Map<string, string>()
  function find(id: string): string {
    const p = parent.get(id) ?? id
    if (p !== id) {
      const root = find(p)
      parent.set(id, root)
      return root
    }
    return id
  }
  function unite(a: string, b: string) {
    const pa = find(a)
    const pb = find(b)
    if (pa !== pb) parent.set(pa, pb)
  }

  for (const [aId, bId] of findCouples(project)) {
    const a = placed.get(aId)
    const b = placed.get(bId)
    if (!a || !b || a.generation !== b.generation) continue
    parent.set(aId, parent.get(aId) ?? aId)
    parent.set(bId, parent.get(bId) ?? bId)
    unite(aId, bId)
  }

  const components = new Map<string, string[]>()
  for (const id of parent.keys()) {
    if (!placed.has(id)) continue
    const root = find(id)
    const list = components.get(root) ?? []
    list.push(id)
    components.set(root, list)
  }

  for (const members of components.values()) {
    if (members.length < 2) continue
    const generation = placed.get(members[0]!)!.generation
    const sorted = [...members].sort(
      (a, b) =>
        (placed.get(a)?.x ?? 0) - (placed.get(b)?.x ?? 0) ||
        a.localeCompare(b),
    )
    let tight = false
    for (let i = 1; i < sorted.length; i++) {
      const prev = placed.get(sorted[i - 1]!)!.x
      const curr = placed.get(sorted[i]!)!.x
      if (curr - prev < step - 1e-6) {
        tight = true
        break
      }
    }
    if (!tight) continue

    const xs = sorted.map((id) => placed.get(id)!.x)
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2
    const width = (sorted.length - 1) * step
    let x = mid - width / 2
    for (const id of sorted) {
      placed.set(id, { generation, x })
      x += step
    }
  }
}

/** Apply delta once per node reached from any root via childrenIndex. */
function shiftSubtreeOnce(
  rootIds: Iterable<string>,
  delta: number,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
  placed: Map<string, LayoutSlot>,
) {
  if (delta === 0 || !Number.isFinite(delta)) return
  const stack = [...rootIds]
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

/**
 * True when child sits next to half-siblings under one of the couple parents
 * (Azalar beside Alder's solo brood). Sliding that singleton would tear them
 * out of the half-sib packing - leave them alone.
 */
function isEmbeddedInHalfSibRun(
  project: Project,
  childId: string,
  motherId: string,
  fatherId: string,
  placed: Map<string, LayoutSlot>,
): boolean {
  const child = project.dragons[childId]
  const childSlot = placed.get(childId)
  if (!child || !childSlot) return false
  const step = 1 + SIBLING_GAP
  const near = 2 * step + 1e-6

  for (const [otherId, slot] of placed) {
    if (otherId === childId || slot.generation !== childSlot.generation) {
      continue
    }
    if (Math.abs(slot.x - childSlot.x) > near) continue
    const other = project.dragons[otherId]
    if (!other) continue
    // Half-sib under this couple: shares exactly one of the couple parents.
    const viaMother =
      (other.motherId === motherId || other.motherId === fatherId) &&
      other.motherId === child.motherId &&
      child.motherId !== null
    const viaFather =
      (other.fatherId === motherId || other.fatherId === fatherId) &&
      other.fatherId === child.fatherId &&
      child.fatherId !== null
    if (viaMother === viaFather) continue
    if (viaMother || viaFather) return true
  }
  return false
}

/**
 * Slide each shared mother×father brood so its midpoint sits under the parents.
 * Rigid translate - sibling gaps unchanged. Same-generation mates of those kids
 * move with them so couple blocks do not tear. Solo / half-sib broods with a
 * different pair key are left alone (Azalar's father-only kids, Alder's solo brood).
 */
function alignBroodsUnderParents(
  project: Project,
  placed: Map<string, LayoutSlot>,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
) {
  const ALIGN_EPS = 0.75

  const matesOf = new Map<string, Set<string>>()
  for (const [aId, bId] of findCouples(project)) {
    if (!placed.has(aId) || !placed.has(bId)) continue
    const aSet = matesOf.get(aId) ?? new Set<string>()
    aSet.add(bId)
    matesOf.set(aId, aSet)
    const bSet = matesOf.get(bId) ?? new Set<string>()
    bSet.add(aId)
    matesOf.set(bId, bSet)
  }

  const couples = findCouples(project)
    .map(([motherId, fatherId]) => {
      const mother = placed.get(motherId)
      const father = placed.get(fatherId)
      if (!mother || !father) return null
      return {
        motherId,
        fatherId,
        parentGen: Math.max(mother.generation, father.generation),
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort(
      (a, b) =>
        a.parentGen - b.parentGen ||
        a.motherId.localeCompare(b.motherId) ||
        a.fatherId.localeCompare(b.fatherId),
    )

  for (const { motherId, fatherId } of couples) {
    const mother = placed.get(motherId)
    const father = placed.get(fatherId)
    if (!mother || !father) continue

    const motherKids = childrenIndex[motherId] ?? []
    const fatherKidSet = new Set(childrenIndex[fatherId] ?? [])
    const shared = motherKids.filter(
      (id) => fatherKidSet.has(id) && placed.has(id),
    )
    if (shared.length === 0) continue

    // Singleton still glued into a half-sib rail under these parents
    // (Azalar next to Geumsog) - do not yank the hub out of that packing.
    if (
      shared.length === 1 &&
      isEmbeddedInHalfSibRun(
        project,
        shared[0]!,
        motherId,
        fatherId,
        placed,
      )
    ) {
      continue
    }

    const parentMid = (mother.x + father.x) / 2
    const childXs = shared.map((id) => placed.get(id)!.x)
    const childMid =
      (Math.min(...childXs) + Math.max(...childXs)) / 2
    const delta = parentMid - childMid
    if (Math.abs(delta) < ALIGN_EPS) continue

    // Blood kids + same-row mates (Alegria|Ardent) so the unit stays intact.
    const moveRoots = new Set<string>(shared)
    for (const kidId of shared) {
      const kidSlot = placed.get(kidId)
      if (!kidSlot) continue
      for (const mateId of matesOf.get(kidId) ?? []) {
        const mateSlot = placed.get(mateId)
        if (mateSlot && mateSlot.generation === kidSlot.generation) {
          moveRoots.add(mateId)
        }
      }
    }

    shiftSubtreeOnce(moveRoots, delta, childrenIndex, placed)
  }
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

function coupleMotherFather(
  project: Project,
  aId: string,
  bId: string,
  placed: Map<string, LayoutSlot>,
): [string, string] {
  const a = placed.get(aId)!
  const b = placed.get(bId)!
  const aDragon = project.dragons[aId]
  const motherId =
    aDragon?.sex === 'female'
      ? aId
      : aDragon?.sex === 'male'
        ? bId
        : a.x <= b.x
          ? aId
          : bId
  const fatherId = motherId === aId ? bId : aId
  return [motherId, fatherId]
}

/** True when this dragon has at least one parent recorded in the project. */
function hasOwnParents(project: Project, dragonId: string): boolean {
  const dragon = project.dragons[dragonId]
  if (!dragon) return false
  if (dragon.motherId !== null && dragon.motherId in project.dragons) {
    return true
  }
  if (dragon.fatherId !== null && dragon.fatherId in project.dragons) {
    return true
  }
  return false
}

/**
 * True when parentId has a child whose other parent is not mateId
 * (missing co-parent or a different mate) - a separate brood.
 */
function hasSeparateBrood(
  project: Project,
  parentId: string,
  mateId: string,
): boolean {
  for (const dragon of Object.values(project.dragons)) {
    const viaMother = dragon.motherId === parentId
    const viaFather = dragon.fatherId === parentId
    if (!viaMother && !viaFather) continue
    const other = viaMother ? dragon.fatherId : dragon.motherId
    if (other !== mateId) return true
  }
  return false
}

/**
 * Left→right order for a mated pair on a row.
 * Default: mother | father.
 * Only when one mate also has a separate brood (so pair + solo rails would
 * cross): put the mate with no own parents on the right (Audora right of
 * Azalar when Azalar also has father-only kids).
 */
function coupleLeftRight(
  project: Project,
  aId: string,
  bId: string,
  placed: Map<string, LayoutSlot>,
): [string, string] {
  const [motherId, fatherId] = coupleMotherFather(project, aId, bId, placed)
  const separateBrood =
    hasSeparateBrood(project, motherId, fatherId) ||
    hasSeparateBrood(project, fatherId, motherId)
  if (!separateBrood) return [motherId, fatherId]

  const motherRoot = !hasOwnParents(project, motherId)
  const fatherRoot = !hasOwnParents(project, fatherId)
  if (motherRoot && !fatherRoot) return [fatherId, motherId]
  if (fatherRoot && !motherRoot) return [motherId, fatherId]
  return [motherId, fatherId]
}

type CoupleBlock = {
  ids: string[]
  sortKey: number
  /** Stable tie-break so full-sib subgroups stay contiguous within a brood. */
  orderKey: string
}

/**
 * Desired X under known parents on the row above.
 * Both parents → midpoint; only mother or father → that parent's X.
 */
function parentMidpoint(
  project: Project,
  dragonId: string,
  placed: Map<string, LayoutSlot>,
  childGeneration: number,
): number | null {
  const dragon = project.dragons[dragonId]
  if (!dragon) return null

  const mother =
    dragon.motherId && placed.has(dragon.motherId)
      ? placed.get(dragon.motherId)!
      : null
  const father =
    dragon.fatherId && placed.has(dragon.fatherId)
      ? placed.get(dragon.fatherId)!
      : null

  const motherOk = mother && mother.generation === childGeneration - 1
  const fatherOk = father && father.generation === childGeneration - 1

  if (motherOk && fatherOk) return (mother.x + father.x) / 2
  if (motherOk) return mother.x
  if (fatherOk) return father.x
  return null
}

function sharedChildrenMid(
  aId: string,
  bId: string,
  placed: Map<string, LayoutSlot>,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
): number | null {
  const aKids = childrenIndex[aId] ?? []
  const bKidSet = new Set(childrenIndex[bId] ?? [])
  const shared = aKids.filter((id) => bKidSet.has(id) && placed.has(id))
  if (shared.length === 0) return null
  return (
    (Math.min(...shared.map((id) => placed.get(id)!.x)) +
      Math.max(...shared.map((id) => placed.get(id)!.x))) /
    2
  )
}

function blockOrderKey(project: Project, ids: string[]): string {
  // Prefer the member that still has parents - keeps a mated child ordered
  // with their brood, not with their mate's unrelated parents.
  const keys = ids.map((id) => {
    const dragon = project.dragons[id]
    if (!dragon) return id
    const hasParents = dragon.motherId !== null || dragon.fatherId !== null
    return `${hasParents ? '0' : '1'}\0${dragon.motherId ?? ''}\0${dragon.fatherId ?? ''}\0${id}`
  })
  keys.sort()
  return keys[0] ?? ids[0] ?? ''
}

function buildRowBlocks(
  project: Project,
  placed: Map<string, LayoutSlot>,
  generation: number,
  desiredX: (ids: string[]) => number,
): CoupleBlock[] {
  const ids = [...placed.entries()]
    .filter(([, slot]) => slot.generation === generation)
    .map(([id]) => id)
  if (ids.length === 0) return []

  const onGen = new Set(ids)
  const couples = findCouples(project).filter(
    ([aId, bId]) => onGen.has(aId) && onGen.has(bId),
  )

  const partners = new Map<string, Set<string>>()
  for (const [aId, bId] of couples) {
    const aSet = partners.get(aId) ?? new Set<string>()
    aSet.add(bId)
    partners.set(aId, aSet)
    const bSet = partners.get(bId) ?? new Set<string>()
    bSet.add(aId)
    partners.set(bId, bSet)
  }

  const blocks: CoupleBlock[] = []
  const used = new Set<string>()

  // Shared mate with 2+ partners on this row: sit the hub between mates
  // (A–B–C) so brood rails do not cross through an intervening unrelated parent.
  const hubs = [...partners.entries()]
    .filter(([, mates]) => mates.size >= 2)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))

  for (const [hubId, mateSet] of hubs) {
    if (used.has(hubId)) continue
    const mateList = [...mateSet].filter((id) => !used.has(id))
    if (mateList.length < 2) continue

    mateList.sort(
      (a, b) =>
        desiredX([a, hubId]) - desiredX([b, hubId]) || a.localeCompare(b),
    )
    const mid = Math.floor(mateList.length / 2)
    const chain = [...mateList.slice(0, mid), hubId, ...mateList.slice(mid)]
    blocks.push({
      ids: chain,
      sortKey: desiredX(chain),
      orderKey: blockOrderKey(project, chain),
    })
    used.add(hubId)
    for (const mateId of mateList) used.add(mateId)
  }

  for (const [aId, bId] of couples) {
    if (used.has(aId) || used.has(bId)) continue
    const pair = coupleLeftRight(project, aId, bId, placed)
    blocks.push({
      ids: [...pair],
      sortKey: desiredX(pair),
      orderKey: blockOrderKey(project, pair),
    })
    used.add(aId)
    used.add(bId)
  }

  for (const id of ids) {
    if (used.has(id)) continue
    blocks.push({
      ids: [id],
      sortKey: desiredX([id]),
      orderKey: blockOrderKey(project, [id]),
    })
  }

  return blocks
}

/**
 * Keep full-sibling broods (same mother+father pair) on one sortKey.
 *
 * A leaf parks under the parents while a sib with a huge subtree (often
 * already in a couple-block) is pulled toward their kids - that opened
 * 100+ slot gaps (Ferenczi Vodou; project "1" Survivor/Spring).
 * Children of different pairs are not merged.
 */
function equalizeSiblingBroodSortKeys(
  project: Project,
  blocks: CoupleBlock[],
  _childrenIndex: ReturnType<typeof buildChildrenIndex>,
) {
  const blockOf = new Map<string, CoupleBlock>()
  for (const block of blocks) {
    for (const id of block.ids) blockOf.set(id, block)
  }

  function equalizeBlocks(group: Iterable<CoupleBlock>) {
    const list = [...group]
    if (list.length < 2) return
    const mid =
      list.reduce((sum, block) => sum + block.sortKey, 0) / list.length
    for (const block of list) block.sortKey = mid
  }

  const fullGroups = new Map<string, Set<CoupleBlock>>()
  for (const block of blocks) {
    for (const id of block.ids) {
      const dragon = project.dragons[id]
      if (!dragon) continue
      if (dragon.motherId === null && dragon.fatherId === null) continue
      const key = `${dragon.motherId ?? ''}\0${dragon.fatherId ?? ''}`
      const set = fullGroups.get(key) ?? new Set()
      set.add(block)
      fullGroups.set(key, set)
    }
  }
  for (const [key, group] of fullGroups) {
    const members = [...blockOf.keys()].filter((id) => {
      const dragon = project.dragons[id]
      if (!dragon) return false
      return `${dragon.motherId ?? ''}\0${dragon.fatherId ?? ''}` === key
    })
    if (members.length < 2) continue
    equalizeBlocks(group)
  }
}

function hasSiblingOnGeneration(
  project: Project,
  dragonId: string,
  generation: number,
  placed: Map<string, LayoutSlot>,
): boolean {
  const dragon = project.dragons[dragonId]
  if (!dragon) return false
  for (const [otherId, slot] of placed) {
    if (otherId === dragonId || slot.generation !== generation) continue
    const other = project.dragons[otherId]
    if (other && areSiblings(dragon, other)) return true
  }
  return false
}

/**
 * Collapse gaps larger than one step between dragons that share a parent
 * (or an explicit sibling group). Unrelated clusters keep their spacing.
 */
function tightenSiblingRuns(
  project: Project,
  placed: Map<string, LayoutSlot>,
) {
  const step = 1 + SIBLING_GAP
  const byGen = new Map<number, string[]>()
  for (const [id, slot] of placed) {
    const row = byGen.get(slot.generation) ?? []
    row.push(id)
    byGen.set(slot.generation, row)
  }

  for (const [generation, ids] of byGen) {
    const sorted = [...ids].sort(
      (a, b) =>
        (placed.get(a)?.x ?? 0) - (placed.get(b)?.x ?? 0) ||
        a.localeCompare(b),
    )

    for (let i = 1; i < sorted.length; i++) {
      const prevId = sorted[i - 1]!
      const currId = sorted[i]!
      const prev = project.dragons[prevId]
      const curr = project.dragons[currId]
      const prevSlot = placed.get(prevId)
      const currSlot = placed.get(currId)
      if (!prev || !curr || !prevSlot || !currSlot) continue
      if (!areSiblings(prev, curr)) continue

      const gap = currSlot.x - prevSlot.x
      if (gap <= step + 1e-6) continue

      const delta = gap - step
      for (let j = i; j < sorted.length; j++) {
        const id = sorted[j]!
        const slot = placed.get(id)!
        placed.set(id, { generation, x: slot.x - delta })
      }
    }
  }
}

type BlockSegment = {
  members: CoupleBlock[]
  sortKey: number
  /** motherId\\0fatherId when this segment is a full-sib brood. */
  coupleKey: string | null
}

/**
 * Order blocks inside one full-sib brood segment.
 * Blood children stay together; a mate attached to one sibling sits on that
 * sibling's outer side (same side as that parent in the couple), never between
 * siblings.
 */
function orderBroodSegmentBlocks(
  project: Project,
  placed: Map<string, LayoutSlot>,
  broodKey: string,
  members: CoupleBlock[],
): CoupleBlock[] {
  function isBlood(id: string): boolean {
    const dragon = project.dragons[id]
    if (!dragon) return false
    if (dragon.motherId === null && dragon.fatherId === null) return false
    return `${dragon.motherId ?? ''}\0${dragon.fatherId ?? ''}` === broodKey
  }

  type Edge = 'blood' | 'mateLeft' | 'mateRight'
  const tagged: { block: CoupleBlock; edge: Edge; orderKey: string }[] = []

  for (const block of members) {
    const bloodIds = block.ids.filter(isBlood)
    const mateIds = block.ids.filter((id) => !isBlood(id))

    if (bloodIds.length === 1 && mateIds.length === 1) {
      const bloodId = bloodIds[0]!
      const mateId = mateIds[0]!
      const [leftId, rightId] = coupleLeftRight(
        project,
        bloodId,
        mateId,
        placed,
      )
      block.ids = [leftId, rightId]
      tagged.push({
        block,
        edge: leftId === mateId ? 'mateLeft' : 'mateRight',
        orderKey: block.orderKey,
      })
      continue
    }

    tagged.push({ block, edge: 'blood', orderKey: block.orderKey })
  }

  const byKey = (
    a: (typeof tagged)[number],
    b: (typeof tagged)[number],
  ) =>
    a.orderKey.localeCompare(b.orderKey) ||
    a.block.ids[0]!.localeCompare(b.block.ids[0]!)

  return [
    ...tagged.filter((entry) => entry.edge === 'mateLeft').sort(byKey),
    ...tagged.filter((entry) => entry.edge === 'blood').sort(byKey),
    ...tagged.filter((entry) => entry.edge === 'mateRight').sort(byKey),
  ].map((entry) => entry.block)
}

/**
 * Group blocks that share the same parental pair (mother+father) into
 * contiguous segments. Different pairs stay separate even if they share
 * one parent. Segments are ordered by the parent-couple midpoint when
 * parents are already placed (left couple → left brood).
 */
function segmentRowBlocks(
  project: Project,
  blocks: CoupleBlock[],
  placed: Map<string, LayoutSlot>,
): BlockSegment[] {
  const blockOf = new Map<string, CoupleBlock>()
  for (const block of blocks) {
    for (const id of block.ids) blockOf.set(id, block)
  }

  function coupleKey(dragonId: string): string | null {
    const dragon = project.dragons[dragonId]
    if (!dragon) return null
    if (dragon.motherId === null && dragon.fatherId === null) return null
    return `${dragon.motherId ?? ''}\0${dragon.fatherId ?? ''}`
  }

  function coupleMid(key: string | null): number | null {
    if (!key) return null
    const [motherId, fatherId] = key.split('\0')
    const mother = motherId ? placed.get(motherId) : undefined
    const father = fatherId ? placed.get(fatherId) : undefined
    if (mother && father) return (mother.x + father.x) / 2
    if (mother) return mother.x
    if (father) return father.x
    return null
  }

  const broodSize = new Map<string, number>()
  for (const id of blockOf.keys()) {
    const key = coupleKey(id)
    if (!key) continue
    broodSize.set(key, (broodSize.get(key) ?? 0) + 1)
  }

  // Couple-blocks vote with their blood member's pair (not the mate's).
  const assignment = new Map<CoupleBlock, string>()
  for (const block of blocks) {
    const votes = new Map<string, number>()
    for (const id of block.ids) {
      const key = coupleKey(id)
      if (!key) continue
      if ((broodSize.get(key) ?? 0) < 2) continue
      votes.set(key, (votes.get(key) ?? 0) + 1)
    }
    if (votes.size === 0) continue

    let bestKey: string | null = null
    let bestVote = -1
    let bestSize = -1
    for (const [key, vote] of votes) {
      const size = broodSize.get(key) ?? 0
      if (
        vote > bestVote ||
        (vote === bestVote && size > bestSize) ||
        (vote === bestVote &&
          size === bestSize &&
          key.localeCompare(bestKey ?? '') < 0)
      ) {
        bestKey = key
        bestVote = vote
        bestSize = size
      }
    }
    if (bestKey) assignment.set(block, bestKey)
  }

  const byCouple = new Map<string, CoupleBlock[]>()
  const remaining = new Set(blocks)
  for (const [block, key] of assignment) {
    const list = byCouple.get(key) ?? []
    list.push(block)
    byCouple.set(key, list)
  }

  const segments: BlockSegment[] = []
  for (const [key, members] of byCouple) {
    const unique = [...new Set(members)]
    if (unique.length < 2) continue
    for (const block of unique) remaining.delete(block)
    // Keep blood siblings contiguous; park each in-brood mate on the outer
    // side of their partner (Azalar's sibs | Azalar | Audora) so a mate is
    // never inserted into the middle of a sibling rail.
    const ordered = orderBroodSegmentBlocks(project, placed, key, unique)
    const sortKey =
      ordered.reduce((sum, block) => sum + block.sortKey, 0) / ordered.length
    segments.push({ members: ordered, sortKey, coupleKey: key })
  }

  for (const block of remaining) {
    // Prefer a blood child's pair key when the block is blood|mate ordered.
    const bloodId =
      block.ids.find((id) => coupleKey(id) !== null) ?? block.ids[0]!
    const key = coupleKey(bloodId)
    segments.push({ members: [block], sortKey: block.sortKey, coupleKey: key })
  }

  /**
   * Among broods that share a parent, put a one-parent brood on that parent's
   * outer side (Alder left of Aleru → Alder's solo kids left of Aleru×Alder).
   * Only reorders within a shared-parent cluster - does not stretch the row.
   */
  function parentsOfKey(key: string | null): string[] {
    if (!key) return []
    const [motherId, fatherId] = key.split('\0')
    return [motherId, fatherId].filter((id): id is string => Boolean(id))
  }

  function localBroodCompare(a: BlockSegment, b: BlockSegment): number {
    const aParents = parentsOfKey(a.coupleKey)
    const bParents = parentsOfKey(b.coupleKey)
    const shared = aParents.filter((id) => bParents.includes(id))
    const aSolo = aParents.length === 1
    const bSolo = bParents.length === 1

    if (shared.length > 0 && aSolo !== bSolo) {
      const soloSeg = aSolo ? a : b
      const coupleSeg = aSolo ? b : a
      const soloParent = parentsOfKey(soloSeg.coupleKey)[0]!
      const mateId = parentsOfKey(coupleSeg.coupleKey).find(
        (id) => id !== soloParent,
      )
      const soloX = placed.get(soloParent)?.x ?? 0
      const mateX = mateId ? (placed.get(mateId)?.x ?? soloX) : soloX
      // Solo brood on the outer side of soloParent (away from mate).
      const soloShouldBeRight = soloX >= mateX
      const soloFirst = soloShouldBeRight ? 1 : -1
      return aSolo ? soloFirst : -soloFirst
    }

    const aMid = coupleMid(a.coupleKey)
    const bMid = coupleMid(b.coupleKey)
    return (
      a.sortKey - b.sortKey ||
      (aMid ?? 0) - (bMid ?? 0) ||
      a.members[0]!.orderKey.localeCompare(b.members[0]!.orderKey)
    )
  }

  // Cluster only segments that share a parent, reorder inside, keep clusters
  // in their overall sortKey order so the rest of the row stays compact.
  const parentIndex = new Map<string, number[]>()
  for (let i = 0; i < segments.length; i++) {
    for (const parentId of parentsOfKey(segments[i]!.coupleKey)) {
      const list = parentIndex.get(parentId) ?? []
      list.push(i)
      parentIndex.set(parentId, list)
    }
  }
  const componentOf = segments.map((_, i) => i)
  function findComp(i: number): number {
    if (componentOf[i] !== i) componentOf[i] = findComp(componentOf[i]!)
    return componentOf[i]!
  }
  for (const indexes of parentIndex.values()) {
    for (let i = 1; i < indexes.length; i++) {
      const pa = findComp(indexes[0]!)
      const pb = findComp(indexes[i]!)
      if (pa !== pb) componentOf[pb] = pa
    }
  }
  const components = new Map<number, BlockSegment[]>()
  for (let i = 0; i < segments.length; i++) {
    const root = findComp(i)
    const list = components.get(root) ?? []
    list.push(segments[i]!)
    components.set(root, list)
  }
  const orderedComponents = [...components.values()].sort((a, b) => {
    const aKey = a.reduce((sum, seg) => sum + seg.sortKey, 0) / a.length
    const bKey = b.reduce((sum, seg) => sum + seg.sortKey, 0) / b.length
    return aKey - bKey
  })
  const ordered: BlockSegment[] = []
  for (const group of orderedComponents) {
    group.sort(localBroodCompare)
    // Lock sortKeys to the desired left→right order around the two-parent
    // midpoint (or solo parent). Otherwise a deep subtree on Azalar|Audora
    // keeps a tiny sortKey and placeRowBlocks can still start the row on the
    // wrong side of the cluster.
    if (group.length >= 2) {
      const coupleSeg = group.find(
        (seg) => parentsOfKey(seg.coupleKey).length === 2,
      )
      const soloSeg = group.find(
        (seg) => parentsOfKey(seg.coupleKey).length === 1,
      )
      const anchor =
        (coupleSeg ? coupleMid(coupleSeg.coupleKey) : null) ??
        (soloSeg
          ? (placed.get(parentsOfKey(soloSeg.coupleKey)[0]!)?.x ?? null)
          : null) ??
        group.reduce((sum, seg) => sum + seg.sortKey, 0) / group.length
      const slotCounts = group.map((seg) =>
        seg.members.reduce((sum, block) => sum + block.ids.length, 0),
      )
      const segGap = 1
      let coupleCenter = 0
      let cursor = 0
      for (let i = 0; i < group.length; i++) {
        const count = Math.max(slotCounts[i]!, 1)
        const center = cursor + (count - 1) / 2
        if (coupleSeg && group[i] === coupleSeg) coupleCenter = center
        cursor += count + segGap
      }
      if (!coupleSeg) coupleCenter = (cursor - segGap - 1) / 2
      cursor = 0
      for (let i = 0; i < group.length; i++) {
        const count = Math.max(slotCounts[i]!, 1)
        const center = cursor + (count - 1) / 2
        group[i]!.sortKey = anchor + (center - coupleCenter)
        cursor += count + segGap
      }
    }
    ordered.push(...group)
  }
  return ordered
}

/**
 * Keep each mate's parents on the same side as that mate on the row below.
 * Uses the mates' placed left/right order (not a fixed mother-left rule), so
 * Survivor|Spring → his parents | her parents and the rails do not cross.
 */
function applyMaternalPaternalOrder(
  project: Project,
  blocks: CoupleBlock[],
  generation: number,
  placed: Map<string, LayoutSlot>,
  step: number,
) {
  const blockOf = new Map<string, CoupleBlock>()
  for (const block of blocks) {
    for (const id of block.ids) blockOf.set(id, block)
  }

  const childGen = generation + 1
  // Left→right couples first so a hub (Dana|Survivor|Spring) accumulates
  // parent blocks in visual order instead of fighting later pairs.
  const couples = findCouples(project)
    .map(([aId, bId]) => {
      const aSlot = placed.get(aId)
      const bSlot = placed.get(bId)
      if (!aSlot || !bSlot) return null
      if (aSlot.generation !== childGen || bSlot.generation !== childGen) {
        return null
      }
      const leftId = aSlot.x <= bSlot.x ? aId : bId
      const rightId = leftId === aId ? bId : aId
      return { leftId, rightId, midX: (aSlot.x + bSlot.x) / 2 }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort(
      (a, b) => a.midX - b.midX || a.leftId.localeCompare(b.leftId),
    )

  for (const { leftId, rightId } of couples) {
    const left = project.dragons[leftId]
    const right = project.dragons[rightId]
    if (!left || !right) continue

    const leftParents = new Set<CoupleBlock>()
    const rightParents = new Set<CoupleBlock>()
    for (const parentId of [left.motherId, left.fatherId]) {
      if (parentId && blockOf.has(parentId)) {
        leftParents.add(blockOf.get(parentId)!)
      }
    }
    for (const parentId of [right.motherId, right.fatherId]) {
      if (parentId && blockOf.has(parentId)) {
        rightParents.add(blockOf.get(parentId)!)
      }
    }

    for (const lBlock of leftParents) {
      for (const rBlock of rightParents) {
        if (lBlock === rBlock) continue
        const mid = (lBlock.sortKey + rBlock.sortKey) / 2
        const half = Math.max(
          Math.abs(rBlock.sortKey - lBlock.sortKey) / 2,
          step,
        )
        lBlock.sortKey = mid - half
        rBlock.sortKey = mid + half
      }
    }
  }
}

/**
 * Place blocks left-to-right. Full-sib broods are contiguous segments;
 * within and between segments we pack tightly (no idealLeft holes).
 */
function placeRowBlocks(
  project: Project,
  placed: Map<string, LayoutSlot>,
  blocks: CoupleBlock[],
  step: number,
  _childrenIndex: ReturnType<typeof buildChildrenIndex>,
) {
  if (blocks.length === 0) return

  const segments = segmentRowBlocks(project, blocks, placed)
  if (segments.length === 0) return

  const blockGap = step
  let cursor = Number.NEGATIVE_INFINITY

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s]!
    for (let b = 0; b < segment.members.length; b++) {
      const block = segment.members[b]!
      const width = (block.ids.length - 1) * step
      const idealLeft = block.sortKey - width / 2
      const left =
        cursor === Number.NEGATIVE_INFINITY ? idealLeft : cursor

      for (let i = 0; i < block.ids.length; i++) {
        const id = block.ids[i]!
        const slot = placed.get(id)!
        placed.set(id, { generation: slot.generation, x: left + i * step })
      }

      cursor = left + block.ids.length * step
    }

    // Keep separate lineages (e.g. maternal vs paternal grandparents) apart
    // so their parent-bridges do not read as one four-parent bar.
    if (s < segments.length - 1) cursor += blockGap
  }
}

/**
 * Pack each generation as couple-blocks + singles so mates stay adjacent.
 * Couples move as units toward children and ancestors - never park one mate
 * under their parents alone (that re-opened Sivtar|Caerula|Nibiru|Runefall).
 */
function layoutCouplesOnRows(
  project: Project,
  placed: Map<string, LayoutSlot>,
  childrenIndex: ReturnType<typeof buildChildrenIndex>,
) {
  const step = 1 + SIBLING_GAP
  const generations = [
    ...new Set([...placed.values()].map((slot) => slot.generation)),
  ].sort((a, b) => a - b)

  const avg = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length

  // Deepest first: order by children.
  for (const generation of [...generations].reverse()) {
    const blocks = buildRowBlocks(
      project,
      placed,
      generation,
      (ids) => {
        if (ids.length === 2) {
          const kids =
            sharedChildrenMid(ids[0]!, ids[1]!, placed, childrenIndex) ??
            avg(ids.map((id) => placed.get(id)!.x))
          return kids
        }
        const id = ids[0]!
        return (
          sharedChildrenMid(id, id, placed, childrenIndex) ??
          placed.get(id)!.x
        )
      },
    )
    // Singles: prefer mid of any placed children.
    for (const block of blocks) {
      if (block.ids.length !== 1) continue
      const id = block.ids[0]!
      const kids = (childrenIndex[id] ?? []).filter((cid) => placed.has(cid))
      if (kids.length > 0) {
        block.sortKey =
          (Math.min(...kids.map((cid) => placed.get(cid)!.x)) +
            Math.max(...kids.map((cid) => placed.get(cid)!.x))) /
          2
      }
    }
    equalizeSiblingBroodSortKeys(project, blocks, childrenIndex)
    applyMaternalPaternalOrder(project, blocks, generation, placed, step)
    placeRowBlocks(project, placed, blocks, step, childrenIndex)
  }

  // Top-down: pull each block toward ancestors + children, still as a unit.
  // Dragons that already have siblings on the row prefer the parental
  // midpoint so a huge personal subtree cannot yank them out of the brood.
  // Parent couples with a placed shared child follow that child - otherwise
  // grandparent midpoints yank them back across the map after a mate pull
  // (Romeo left with Lydia, Caerula×Runefall stuck under right-side gens).
  for (const generation of generations) {
    const blocks = buildRowBlocks(
      project,
      placed,
      generation,
      (ids) => {
        const parentTargets: number[] = []
        for (const id of ids) {
          const mid = parentMidpoint(project, id, placed, generation)
          if (mid !== null) parentTargets.push(mid)
        }
        const sibAnchored = ids.some((id) =>
          hasSiblingOnGeneration(project, id, generation, placed),
        )
        if (sibAnchored && parentTargets.length > 0) {
          return avg(parentTargets)
        }

        if (ids.length >= 2) {
          // Prefer shared kids of the parental pair (first two = mother/father
          // order from buildRowBlocks) so in-law sides stay under the right child.
          // Exception: if a blood member also has a one-parent co-brood on this
          // row (Alder-only sibs beside Azalar|Audora), stay under the parents
          // so the outer-brood packer can keep that brood on the father's side.
          const bloodId = ids.find((id) => {
            const d = project.dragons[id]
            return d && (d.motherId !== null || d.fatherId !== null)
          })
          const hasCoBrood =
            bloodId !== undefined &&
            hasOneParentCoBroodOnGeneration(
              project,
              bloodId,
              generation,
              placed,
            )
          if (hasCoBrood && parentTargets.length > 0) {
            return avg(parentTargets)
          }
          const kids = sharedChildrenMid(
            ids[0]!,
            ids[1]!,
            placed,
            childrenIndex,
          )
          if (kids !== null) return kids
        }

        const targets: number[] = [...parentTargets]
        if (ids.length === 1) {
          const id = ids[0]!
          const kids = (childrenIndex[id] ?? []).filter((cid) =>
            placed.has(cid),
          )
          if (kids.length > 0) {
            targets.push(
              (Math.min(...kids.map((cid) => placed.get(cid)!.x)) +
                Math.max(...kids.map((cid) => placed.get(cid)!.x))) /
                2,
            )
          }
        }
        if (targets.length > 0) return avg(targets)
        return avg(ids.map((id) => placed.get(id)!.x))
      },
    )
    equalizeSiblingBroodSortKeys(project, blocks, childrenIndex)
    applyMaternalPaternalOrder(project, blocks, generation, placed, step)
    placeRowBlocks(project, placed, blocks, step, childrenIndex)
  }
}

/** Same generation, shares exactly one parent, other parent differs / missing. */
function hasOneParentCoBroodOnGeneration(
  project: Project,
  dragonId: string,
  generation: number,
  placed: Map<string, LayoutSlot>,
): boolean {
  const dragon = project.dragons[dragonId]
  if (!dragon) return false
  const parents = [dragon.motherId, dragon.fatherId].filter(
    (id): id is string => Boolean(id) && id in project.dragons,
  )
  if (parents.length === 0) return false

  for (const [otherId, slot] of placed) {
    if (otherId === dragonId || slot.generation !== generation) continue
    const other = project.dragons[otherId]
    if (!other) continue
    const otherParents = [other.motherId, other.fatherId].filter(
      (id): id is string => Boolean(id) && id in project.dragons,
    )
    const shared = parents.filter((id) => otherParents.includes(id))
    if (shared.length !== 1) continue
    // Different parental pair (including one-parent vs two-parent).
    const samePair =
      (dragon.motherId ?? '') === (other.motherId ?? '') &&
      (dragon.fatherId ?? '') === (other.fatherId ?? '')
    if (!samePair) return true
  }
  return false
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
 *
 * The iterative co-parent pass can ratchet on deep mate graphs and is capped
 * at dragons.length+2 (must stay capped - raising it inflates gens without
 * converging). A final one-shot repair then:
 * 1) enforces child > parent
 * 2) puts every full parental-pair brood on one band (max among those children)
 * so a mated child cannot sit rows below their full siblings while
 * segmentRowBlocks only sees one generation at a time.
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

  // The capped loop often stops before every mated pair shares a band
  // (Audora/Azalar, Alegria/Ardent on project "1"). Finish with mate-only
  // equalization: raise the lower co-parent to the higher, then repair
  // child > parent. Never push parents up from childGen-1 here - that was
  // the unbounded ratchet on dense mate meshes.
  {
    let mateChanged = true
    let mateGuard = 0
    while (mateChanged && mateGuard < dragons.length + 2) {
      mateChanged = false
      mateGuard += 1

      for (const child of dragons) {
        const motherId = child.motherId
        const fatherId = child.fatherId
        if (!motherId || !fatherId) continue
        if (!project.dragons[motherId] || !project.dragons[fatherId]) continue
        const motherGen = gens.get(motherId) ?? 0
        const fatherGen = gens.get(fatherId) ?? 0
        const target = Math.max(motherGen, fatherGen)
        if (motherGen < target) {
          gens.set(motherId, target)
          mateChanged = true
        }
        if (fatherGen < target) {
          gens.set(fatherId, target)
          mateChanged = true
        }
      }

      for (const dragon of dragons) {
        let g = gens.get(dragon.id) ?? 0
        for (const parentId of [dragon.motherId, dragon.fatherId]) {
          if (!parentId || !project.dragons[parentId]) continue
          g = Math.max(g, (gens.get(parentId) ?? 0) + 1)
        }
        if (g !== (gens.get(dragon.id) ?? 0)) {
          gens.set(dragon.id, g)
          mateChanged = true
        }
      }
    }
  }

  // Full parental pairs share one generation band - not all kids of one parent.
  const byCouple = new Map<string, string[]>()
  for (const dragon of dragons) {
    if (dragon.motherId === null && dragon.fatherId === null) continue
    const key = `${dragon.motherId ?? ''}\0${dragon.fatherId ?? ''}`
    const list = byCouple.get(key) ?? []
    list.push(dragon.id)
    byCouple.set(key, list)
  }
  for (const childIds of byCouple.values()) {
    if (childIds.length < 2) continue
    const maxG = Math.max(...childIds.map((id) => gens.get(id) ?? 0))
    for (const childId of childIds) {
      if ((gens.get(childId) ?? 0) < maxG) gens.set(childId, maxG)
    }
  }

  // Brood unify can leave someone still <= a parent; bump (single pass).
  for (const dragon of dragons) {
    let g = gens.get(dragon.id) ?? 0
    for (const parentId of [dragon.motherId, dragon.fatherId]) {
      if (!parentId || !project.dragons[parentId]) continue
      g = Math.max(g, (gens.get(parentId) ?? 0) + 1)
    }
    gens.set(dragon.id, g)
  }

  // Absolute gens can still sit high on dense mate graphs; relative bands are
  // what matter - shift so the shallowest dragon is generation 0.
  let minG = Infinity
  for (const g of gens.values()) minG = Math.min(minG, g)
  if (Number.isFinite(minG) && minG !== 0) {
    for (const [id, g] of gens) gens.set(id, g - minG)
  }

  return gens
}
