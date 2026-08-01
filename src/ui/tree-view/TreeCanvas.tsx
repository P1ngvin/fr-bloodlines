import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Dragon, Project } from '../../data/models'
import {
  MAX_TREE_ZOOM,
  MIN_TREE_ZOOM,
  setViewSettings,
  useViewSettings,
} from '../../state/viewSettingsStore'
import {
  buildChildrenIndex,
  buildFocusTree,
  buildStableTree,
  canLinkAsChild,
  canLinkAsParent,
  canLinkAsSiblings,
  collectLocalRelativeIds,
  filterAndCompactLayout,
  kinshipInfo,
  listDragons,
} from '../../tree'
import { treeLodFromZoom, type TreeLod } from './treeLod'
import {
  findFreePosition,
  FREE_NODE_H,
  FREE_NODE_W,
  LAYOUT_CELL_W,
  LAYOUT_GEN_GAP,
  LAYOUT_PAD_X,
  LAYOUT_PAD_Y,
  packedNodeTopLeft,
  type Rect,
} from '../../utils/placement'
import {
  ContextMenu,
  type ContextMenuItem,
} from '../dialogs/ContextMenu'
import { DragonNode } from './DragonNode'
import './TreeCanvas.css'

export type CanvasContextTarget =
  | { kind: 'empty'; worldX: number; worldY: number }
  | { kind: 'dragon'; dragonId: string }
  | { kind: 'link'; fromId: string; toId: string }

export type CanvasMenuState = {
  x: number
  y: number
  target: CanvasContextTarget
}

type TreeCanvasProps = {
  project: Project
  selectedDragonId: string | null
  viewFocusId: string | null
  interactive: boolean
  emptyLine: string
  ancestorGenerations: number | null
  descendantGenerations: number | null
  menu: CanvasMenuState | null
  onSelectDragon: (id: string | null) => void
  onOpenMenu: (menu: CanvasMenuState) => void
  onCloseMenu: () => void
  onMenuAction: (actionId: string, target: CanvasContextTarget) => void
  /** Edit mode: import one or more downloaded FR dragon pages. */
  onImportDragonPage?: () => void
  /** Edit mode: open paste-text import for an FR dragon profile. */
  onPasteImportDragon?: () => void
}

const CELL_W = LAYOUT_CELL_W
/** Must match .dragon-node height at --tree-zoom: 1 (padding + portrait + gap + name). */
const NODE_H = FREE_NODE_H
/** Must match .dragon-node width at --tree-zoom: 1. */
const NODE_W = FREE_NODE_W
const PAD_X = LAYOUT_PAD_X
const PAD_Y = LAYOUT_PAD_Y
const CLICK_DRAG_THRESHOLD = 4
const ZOOM_STEP = 1.15
/** Unscaled px per fork lane so All-mode trunks stay readable. */
const MIN_FORK_LANE_H = 48
const FORK_GAP_EXTRA = 20
/**
 * When one parent feeds several couple forks (Survivor×Dana and Survivor×Spring),
 * space their exit stubs along the card bottom so the trunks do not overlap.
 */
const STEM_EXIT_GAP = 14
/** Min px between trunk / stem / child verticals in the same generation gap. */
const MIN_TRUNK_GAP = 16
/** Half-gap punched in a rail where a foreign vertical crosses it. */
const RAIL_HOLE = 7
/** 9.75rem card → FREE_NODE_H; keep LOD sizes in the same px/rem scale. */
const REM = FREE_NODE_H / 9.75

/** Visible card box at the current LOD (nodes stay top-aligned in the cell). */
function lodNodeSize(lod: TreeLod): { w: number; h: number } {
  switch (lod) {
    case 'dot':
      return { w: 0.8 * REM, h: 0.8 * REM }
    case 'portrait':
      return { w: 5.4 * REM, h: 5.4 * REM }
    case 'named':
      return { w: NODE_W, h: 7.35 * REM }
    default:
      return { w: NODE_W, h: NODE_H }
  }
}

function emptyMenuItems(): ContextMenuItem[] {
  return [{ type: 'item', id: 'create', label: 'Create dragon' }]
}

function dragonMenuItems(dragon: Dragon): ContextMenuItem[] {
  return [
    {
      type: 'item',
      id: 'add-mother',
      label: 'Add mother',
      disabled: dragon.motherId !== null,
    },
    {
      type: 'item',
      id: 'add-father',
      label: 'Add father',
      disabled: dragon.fatherId !== null,
    },
    {
      type: 'item',
      id: 'add-child',
      label: 'Add child',
      disabled: dragon.sex === 'unknown',
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'clear-mother',
      label: 'Clear mother',
      disabled: dragon.motherId === null,
    },
    {
      type: 'item',
      id: 'clear-father',
      label: 'Clear father',
      disabled: dragon.fatherId === null,
    },
    { type: 'separator' },
    { type: 'item', id: 'delete', label: 'Delete...', danger: true },
  ]
}

function displayName(dragon: Dragon): string {
  return dragon.name.trim() || 'Unnamed'
}

function linkMenuItems(from: Dragon, to: Dragon): ContextMenuItem[] {
  // Drop target (to) is the grammatical subject: "{to} is ..."
  const fromName = displayName(from)
  const toName = displayName(to)

  return [
    {
      type: 'item',
      id: 'link-parent',
      label: `${toName} is parent of ${fromName}`,
      disabled: !canLinkAsParent(to, from),
    },
    {
      type: 'item',
      id: 'link-child',
      label: `${toName} is child of ${fromName}`,
      disabled: !canLinkAsChild(to, from),
    },
    {
      type: 'item',
      id: 'link-sibling',
      label: `${toName} is sibling of ${fromName}`,
      disabled: !canLinkAsSiblings(to, from),
    },
  ]
}

function nodeCenterX(x: number, zoom: number) {
  return (PAD_X + x * CELL_W + CELL_W / 2) * zoom
}

type LayoutPos = { dragonId?: string; generation: number; x: number }

type ChildSlot = { id: string; generation: number; x: number }
type ForkBase = {
  key: string
  stems: { id: string; x: number; generation: number }[]
  children: ChildSlot[]
  parentGen: number
  childGen: number
  spanLo: number
  spanHi: number
}
type LaneFork = ForkBase & { lane: number; laneCount: number }

function buildGenerationTops(
  minGeneration: number,
  maxGeneration: number,
  gapAfter: Map<number, number>,
): Map<number, number> {
  const tops = new Map<number, number>()
  let y = PAD_Y
  for (let g = minGeneration; g <= maxGeneration; g++) {
    tops.set(g, y)
    if (g < maxGeneration) {
      y += NODE_H + (gapAfter.get(g) ?? LAYOUT_GEN_GAP)
    }
  }
  return tops
}

function genTopY(
  generation: number,
  tops: Map<number, number>,
  zoom: number,
): number {
  return (tops.get(generation) ?? PAD_Y) * zoom
}

/**
 * Orthogonal parent→child forks, grouped by parental couple (not by parent).
 * Lane counts drive generation gap height so All-mode trunks stay readable.
 */
function planParentForkLanes(
  edges: { parentId: string; childId: string }[],
  positions: Map<string, LayoutPos>,
  project: Project,
): { forks: LaneFork[]; laneCountByGap: Map<string, number> } {
  const childrenIndex = buildChildrenIndex(project)
  const parentsOfChild = new Map<string, string[]>()
  for (const edge of edges) {
    const list = parentsOfChild.get(edge.childId) ?? []
    if (!list.includes(edge.parentId)) list.push(edge.parentId)
    parentsOfChild.set(edge.childId, list)
  }

  const byCouple = new Map<string, ForkBase>()
  for (const [childId, parentIds] of parentsOfChild) {
    const childSlot = positions.get(childId)
    if (!childSlot) continue

    const stems = parentIds
      .map((id) => {
        const slot = positions.get(id)
        return slot
          ? { id, x: slot.x, generation: slot.generation }
          : null
      })
      .filter(
        (s): s is { id: string; x: number; generation: number } => s !== null,
      )
    if (stems.length === 0) continue

    const key = [...parentIds].sort().join('|')
    const child: ChildSlot = {
      id: childId,
      generation: childSlot.generation,
      x: childSlot.x,
    }
    const xs = [...stems.map((s) => s.x), child.x]
    // Band the fork in the gap under the closest parent row (not the oldest
    // ancestor stem). Otherwise Audora@N + Azalar@N+1 → Alegria lands in a
    // multi-row gap and paints a trunk through an unrelated sibling row.
    const parentGen = Math.max(...stems.map((s) => s.generation))
    const existing = byCouple.get(key)
    if (existing) {
      if (!existing.children.some((c) => c.id === childId)) {
        existing.children.push(child)
      }
      // Keep stem slots fresh - a later child may see an updated generation.
      for (const stem of stems) {
        const prev = existing.stems.find((s) => s.id === stem.id)
        if (prev) {
          prev.x = stem.x
          prev.generation = stem.generation
        } else {
          existing.stems.push(stem)
        }
      }
      existing.spanLo = Math.min(existing.spanLo, ...xs)
      existing.spanHi = Math.max(existing.spanHi, ...xs)
      existing.childGen = Math.min(existing.childGen, child.generation)
      existing.parentGen = Math.max(existing.parentGen, parentGen)
    } else {
      byCouple.set(key, {
        key,
        stems,
        children: [child],
        parentGen,
        childGen: child.generation,
        spanLo: Math.min(...xs),
        spanHi: Math.max(...xs),
      })
    }
  }

  const byGap = new Map<string, ForkBase[]>()
  for (const fork of byCouple.values()) {
    const gapKey = `${fork.parentGen}->${fork.childGen}`
    const list = byGap.get(gapKey) ?? []
    list.push(fork)
    byGap.set(gapKey, list)
  }

  function spanInterleave(
    aLo: number,
    aHi: number,
    bLo: number,
    bHi: number,
  ): boolean {
    return (
      (aLo < bLo && bLo < aHi && aHi < bHi) ||
      (bLo < aLo && aLo < bHi && bHi < aHi)
    )
  }

  function forkParentMid(fork: ForkBase): number {
    return fork.stems.reduce((sum, s) => sum + s.x, 0) / fork.stems.length
  }

  function forkChildMid(fork: ForkBase): number {
    return (
      fork.children.reduce((sum, c) => sum + c.x, 0) / fork.children.length
    )
  }

  function broodDistance(fork: ForkBase): number {
    if (fork.stems.length === 0 || fork.children.length === 0) return 0
    return Math.abs(forkParentMid(fork) - forkChildMid(fork))
  }

  function parentBranchesCross(a: ForkBase, b: ForkBase): boolean {
    if (a.children.length === 0 || b.children.length === 0) return false
    const parentDelta = forkParentMid(a) - forkParentMid(b)
    const childDelta = forkChildMid(a) - forkChildMid(b)
    if (Math.abs(parentDelta) < 0.05 || Math.abs(childDelta) < 0.05) {
      return false
    }
    return parentDelta * childDelta < 0
  }

  /** Corridors parentMid→childMid overlap while at least one side pulls sideways. */
  function parentCorridorsTangle(a: ForkBase, b: ForkBase): boolean {
    if (a.children.length === 0 || b.children.length === 0) return false
    const aP = forkParentMid(a)
    const aC = forkChildMid(a)
    const bP = forkParentMid(b)
    const bC = forkChildMid(b)
    const aLo = Math.min(aP, aC)
    const aHi = Math.max(aP, aC)
    const bLo = Math.min(bP, bC)
    const bHi = Math.max(bP, bC)
    if (aHi < bLo - 0.05 || bHi < aLo - 0.05) return false
    return Math.abs(aP - aC) > 0.35 || Math.abs(bP - bC) > 0.35
  }

  function motherFatherOfCouple(aId: string, bId: string): [string, string] {
    const a = project.dragons[aId]
    const b = project.dragons[bId]
    if (a?.sex === 'female') return [aId, bId]
    if (a?.sex === 'male') return [bId, aId]
    if (b?.sex === 'female') return [bId, aId]
    if (b?.sex === 'male') return [aId, bId]
    const ax = positions.get(aId)?.x ?? 0
    const bx = positions.get(bId)?.x ?? 0
    return ax <= bx ? [aId, bId] : [bId, aId]
  }

  /** Fork key for a dragon's placed parents (one or both). */
  function parentForkKey(
    motherId: string | null,
    fatherId: string | null,
  ): string | null {
    const ids = [motherId, fatherId].filter(
      (id): id is string => !!id && positions.has(id),
    )
    if (ids.length === 0) return null
    return [...ids].sort().join('|')
  }

  function shareOffspring(aId: string, bId: string): boolean {
    const aKids = childrenIndex[aId] ?? []
    const bSet = new Set(childrenIndex[bId] ?? [])
    return aKids.some((id) => bSet.has(id))
  }

  /**
   * Mother's-parents fork vs father's-parents fork for each mated pair.
   * Always separate lanes - shared unionY makes adjacent grandparent bars fuse
   * even when the corridors do not geometrically cross.
   */
  type InLawPair = { maternalKey: string; paternalKey: string }
  const inLawPairs: InLawPair[] = []
  const inLawPairKeys = new Set<string>()
  const sideByKey = new Map<string, 'maternal' | 'paternal'>()

  const childIds = [...positions.keys()]

  for (let i = 0; i < childIds.length; i++) {
    const aId = childIds[i]!
    const aSlot = positions.get(aId)
    if (!aSlot) continue
    for (let j = i + 1; j < childIds.length; j++) {
      const bId = childIds[j]!
      const bSlot = positions.get(bId)
      if (!bSlot || bSlot.generation !== aSlot.generation) continue
      if (!shareOffspring(aId, bId)) continue

      const [motherId, fatherId] = motherFatherOfCouple(aId, bId)
      const mother = project.dragons[motherId]
      const father = project.dragons[fatherId]
      if (!mother || !father) continue

      const maternalKey = parentForkKey(mother.motherId, mother.fatherId)
      const paternalKey = parentForkKey(father.motherId, father.fatherId)
      if (!maternalKey || !paternalKey || maternalKey === paternalKey) continue
      if (!byCouple.has(maternalKey) || !byCouple.has(paternalKey)) continue

      const pairKey =
        maternalKey < paternalKey
          ? `${maternalKey}::${paternalKey}`
          : `${paternalKey}::${maternalKey}`
      if (inLawPairKeys.has(pairKey)) continue
      inLawPairKeys.add(pairKey)
      inLawPairs.push({ maternalKey, paternalKey })
      sideByKey.set(maternalKey, 'maternal')
      sideByKey.set(paternalKey, 'paternal')
    }
  }

  function isInLawPair(aKey: string, bKey: string): boolean {
    const pairKey =
      aKey < bKey ? `${aKey}::${bKey}` : `${bKey}::${aKey}`
    return inLawPairKeys.has(pairKey)
  }

  function forksConflict(a: ForkBase, b: ForkBase): boolean {
    const aStems = new Set(a.stems.map((s) => s.id))
    const bStems = new Set(b.stems.map((s) => s.id))
    const shared = [...aStems].filter((id) => bStems.has(id))

    if (shared.length > 0) return true

    // Maternal vs paternal grandparents of the same couple.
    if (isInLawPair(a.key, b.key)) return true

    if (parentBranchesCross(a, b)) return true
    if (parentCorridorsTangle(a, b)) return true

    // Only overlapping / interleaved spans share the gap - near-but-separate
    // forks keep one lane so the tree does not stretch for no reason.
    if (spanInterleave(a.spanLo, a.spanHi, b.spanLo, b.spanHi)) return true
    if (a.spanHi < b.spanLo - 0.05 || b.spanHi < a.spanLo - 0.05) {
      return false
    }
    return true
  }

  const forks: LaneFork[] = []
  const laneCountByGap = new Map<string, number>()

  for (const [gapKey, group] of byGap) {
    // In-law: mother's parents first. Else longer sideways travel lower
    // (only matters when forksConflict put them on different lanes).
    const ordered = [...group].sort((a, b) => {
      if (isInLawPair(a.key, b.key)) {
        const aSide = sideByKey.get(a.key)
        const bSide = sideByKey.get(b.key)
        if (aSide === 'maternal' && bSide === 'paternal') return -1
        if (aSide === 'paternal' && bSide === 'maternal') return 1
      }
      return (
        broodDistance(a) - broodDistance(b) ||
        a.spanLo - b.spanLo ||
        a.key.localeCompare(b.key)
      )
    })
    const laneOf: { fork: ForkBase; lane: number }[] = []

    for (const fork of ordered) {
      const used = new Set<number>()
      for (const prev of laneOf) {
        if (forksConflict(prev.fork, fork)) used.add(prev.lane)
      }
      let lane = 0
      while (used.has(lane)) lane += 1
      laneOf.push({ fork, lane })
    }

    // Maternal lane above paternal; pick free lanes if order was inverted.
    for (const { maternalKey, paternalKey } of inLawPairs) {
      const maternal = laneOf.find((e) => e.fork.key === maternalKey)
      const paternal = laneOf.find((e) => e.fork.key === paternalKey)
      if (!maternal || !paternal) continue
      if (maternal.lane < paternal.lane) continue

      const usedByOthers = () =>
        new Set(
          laneOf
            .filter((e) => e !== maternal && e !== paternal)
            .map((e) => e.lane),
        )

      let mLane = Math.min(maternal.lane, paternal.lane)
      const used = usedByOthers()
      while (used.has(mLane)) mLane += 1
      maternal.lane = mLane
      used.add(mLane)

      let pLane = mLane + 1
      while (used.has(pLane)) pLane += 1
      paternal.lane = pLane
    }

    const laneCount = Math.max(1, ...laneOf.map((e) => e.lane + 1))
    laneCountByGap.set(gapKey, laneCount)
    for (const { fork, lane } of laneOf) {
      forks.push({ ...fork, lane, laneCount })
    }
  }

  return { forks, laneCountByGap }
}

/** Widen each generation gap so every fork lane gets a readable trunk. */
function gapAfterFromLanes(
  minGeneration: number,
  maxGeneration: number,
  laneCountByGap: Map<string, number>,
): Map<number, number> {
  const gapAfter = new Map<number, number>()
  for (let g = minGeneration; g < maxGeneration; g++) {
    gapAfter.set(g, LAYOUT_GEN_GAP)
  }

  for (const [gapKey, laneCount] of laneCountByGap) {
    const [parentGen, childGen] = gapKey.split('->').map(Number)
    if (
      parentGen === undefined ||
      childGen === undefined ||
      !Number.isFinite(parentGen) ||
      !Number.isFinite(childGen) ||
      childGen <= parentGen
    ) {
      continue
    }
    const steps = childGen - parentGen
    const needed =
      Math.max(1, laneCount) * MIN_FORK_LANE_H + FORK_GAP_EXTRA
    const perStep = Math.ceil(needed / steps)
    for (let g = parentGen; g < childGen; g++) {
      gapAfter.set(g, Math.max(gapAfter.get(g) ?? LAYOUT_GEN_GAP, perStep))
    }
  }

  return gapAfter
}

/**
 * Horizontal exit X for a parent stem inside a fork.
 * Parents that feed several forks get spaced stubs (solo brood outer,
 * mate link toward the mate). Shared-kid drops still use card centers.
 */
function buildStemExitXs(
  laneForks: LaneFork[],
  zoom: number,
  cardHalfW: number,
): Map<string, number> {
  const byParent = new Map<string, LaneFork[]>()
  for (const fork of laneForks) {
    for (const stem of fork.stems) {
      const list = byParent.get(stem.id) ?? []
      list.push(fork)
      byParent.set(stem.id, list)
    }
  }

  const exitXs = new Map<string, number>()
  const gap = STEM_EXIT_GAP * zoom
  // Keep stubs on the visible card bottom, not past the side edges.
  const maxOffset = Math.max(0, cardHalfW - 4 * zoom)

  for (const [parentId, forks] of byParent) {
    const unique = [...new Map(forks.map((f) => [f.key, f])).values()]
    const stem = unique[0]!.stems.find((s) => s.id === parentId)
    if (!stem) continue
    const center = nodeCenterX(stem.x, zoom)

    if (unique.length === 1) {
      exitXs.set(`${unique[0]!.key}|${parentId}`, center)
      continue
    }

    // Solo forks sit on the outer side of any mate; couple forks toward mate.
    // Bias: mates pull strongly toward their x; solo broods use children mid
    // but flip to the outer side when every mate lies on the opposite side.
    const mateXs: number[] = []
    for (const fork of unique) {
      for (const other of fork.stems) {
        if (other.id !== parentId) mateXs.push(other.x)
      }
    }
    const mateMin = mateXs.length > 0 ? Math.min(...mateXs) : stem.x
    const mateMax = mateXs.length > 0 ? Math.max(...mateXs) : stem.x

    const ranked = [...unique].sort((a, b) => {
      const bias = (fork: LaneFork) => {
        const others = fork.stems.filter((s) => s.id !== parentId)
        if (others.length > 0) {
          return others.reduce((sum, s) => sum + s.x, 0) / others.length
        }
        const childMid =
          fork.children.length === 0
            ? stem.x
            : fork.children.reduce((sum, c) => sum + c.x, 0) /
              fork.children.length
        // Prefer the outer side of the mate span so a solo rail does not
        // leave through the couple bridge (Angelwrath left of Argus → solo left).
        if (mateXs.length > 0) {
          if (stem.x <= mateMin) return stem.x - 1
          if (stem.x >= mateMax) return stem.x + 1
        }
        return childMid
      }
      return bias(a) - bias(b) || a.key.localeCompare(b.key)
    })

    const span = Math.min((ranked.length - 1) * gap, maxOffset * 2)
    const step = ranked.length > 1 ? span / (ranked.length - 1) : 0
    const start = center - span / 2
    ranked.forEach((fork, index) => {
      exitXs.set(`${fork.key}|${parentId}`, start + index * step)
    })
  }

  return exitXs
}

function parentForkPaths(
  laneForks: LaneFork[],
  tops: Map<number, number>,
  zoom: number,
  lod: TreeLod,
): { key: string; d: string; dragonIds: string[] }[] {
  const paths: { key: string; d: string; dragonIds: string[] }[] = []
  const { w: visualW, h: visualH } = lodNodeSize(lod)
  const visualHZoom = visualH * zoom
  const cardHalfW = (visualW * zoom) / 2
  const stemExitXs = buildStemExitXs(laneForks, zoom, cardHalfW)
  const trunkGap = MIN_TRUNK_GAP * zoom
  /** Collapse parent-mid + child drops that would read as a double line. */
  const mergePx = Math.max(8 * zoom, trunkGap)

  type StemDraw = { id: string; x: number; generation: number }
  type ForkGeom = {
    fork: LaneFork
    drawStems: StemDraw[]
    stemXs: number[]
    unionY: number
    railY: number
    childTop: number
    childMin: number
    childMax: number
    childCenters: number[]
    /** Final child-drop X (may micro-shift off a foreign stem). */
    childDropXs: number[]
    /** Couple parent-card midpoint (or solo exit X). */
    naturalX: number
    /** Intermediate trunk X (nudged so lanes do not stack). */
    trunkX: number
    singleChild: boolean
    gapKey: string
  }

  const geoms: ForkGeom[] = []

  for (const fork of laneForks) {
    // Attach to the visible card edges (LOD size), not the full layout cell,
    // so zoomed-out nodes do not leave stubs in empty space - and never draw
    // through the card face.
    const parentBottom = Math.max(
      ...fork.stems.map(
        (s) => genTopY(s.generation, tops, zoom) + visualHZoom,
      ),
    )
    const childTop = genTopY(fork.childGen, tops, zoom)
    const gap = childTop - parentBottom
    if (gap <= 1) continue

    const topPad = Math.max(4 * zoom, Math.min(10 * zoom, gap * 0.1))
    const botPad = Math.max(4 * zoom, Math.min(10 * zoom, gap * 0.1))
    const usable = Math.max(gap - topPad - botPad, gap * 0.55)
    // Union + rail are per lane. A shared unionY lets neighboring couple bars
    // (maternal vs paternal grandparents) fuse into one long stick.
    const laneH = usable / Math.max(1, fork.laneCount)
    const bandTop = parentBottom + topPad + laneH * fork.lane
    const unionY = bandTop + laneH * 0.22
    const railYRaw = bandTop + laneH * 0.72
    const railLo = parentBottom + topPad + 2 * zoom
    const railHi = childTop - botPad - 2 * zoom
    if (railHi <= railLo) continue
    const railY = Math.min(railHi, Math.max(railLo, railYRaw))
    if (unionY >= railY - 2 * zoom) continue

    const exitX = (stemId: string, fallbackX: number) =>
      stemExitXs.get(`${fork.key}|${stemId}`) ?? nodeCenterX(fallbackX, zoom)

    // Bridge only parents on the closest row. Older stems on higher rows would
    // paint long trunks through unrelated generations (Audora through Ardent's
    // sibling row while Azalar sits one band lower).
    const bridgeGen = Math.max(...fork.stems.map((s) => s.generation))
    const bridgeStems = fork.stems.filter((s) => s.generation === bridgeGen)
    const drawStems = (bridgeStems.length > 0 ? bridgeStems : fork.stems).map(
      (s) => ({ id: s.id, x: s.x, generation: s.generation }),
    )
    const stemXs = drawStems.map((s) => exitX(s.id, s.x))

    const childCenters = fork.children.map((c) => nodeCenterX(c.x, zoom))
    const childMin = Math.min(...childCenters)
    const childMax = Math.max(...childCenters)
    const singleChild = fork.children.length === 1

    let naturalX: number
    if (drawStems.length >= 2) {
      const centerXs = drawStems
        .map((s) => nodeCenterX(s.x, zoom))
        .sort((a, b) => a - b)
      naturalX = (centerXs[0]! + centerXs[centerXs.length - 1]!) / 2
    } else {
      naturalX = stemXs[0]!
    }

    // One child: trunk on the child column so mid-drop + child-drop do not
    // run as parallel verticals a few px apart.
    let trunkX: number
    if (singleChild) {
      trunkX = childCenters[0]!
    } else {
      trunkX = Math.min(childMax, Math.max(childMin, naturalX))
      // Snap onto a brood column when mid sits a few px off - otherwise the
      // trunk and that child's drop read as a doubled vertical.
      for (const cx of childCenters) {
        if (Math.abs(trunkX - cx) <= mergePx) {
          trunkX = cx
          break
        }
      }
    }

    const parentGen = Math.max(...drawStems.map((s) => s.generation))
    geoms.push({
      fork,
      drawStems,
      stemXs,
      unionY,
      railY,
      childTop,
      childMin,
      childMax,
      childCenters,
      childDropXs: [...childCenters],
      naturalX,
      trunkX,
      singleChild,
      gapKey: `${parentGen}->${fork.childGen}`,
    })
  }

  // Spread trunks / child drops so stacked lanes are not co-linear.
  const byGap = new Map<string, ForkGeom[]>()
  for (const geom of geoms) {
    const list = byGap.get(geom.gapKey) ?? []
    list.push(geom)
    byGap.set(geom.gapKey, list)
  }

  function foreignVerticals(geom: ForkGeom, group: ForkGeom[]): number[] {
    const xs: number[] = []
    for (const other of group) {
      if (other === geom) continue
      xs.push(...other.stemXs)
      xs.push(...other.childCenters)
      xs.push(other.trunkX)
    }
    return xs
  }

  function overlapsAny(x: number, xs: number[], gap: number): boolean {
    return xs.some((other) => Math.abs(other - x) < gap)
  }

  function nudgeX(
    startX: number,
    blocked: number[],
    preferRight: boolean,
    maxShift: number,
  ): number {
    if (!overlapsAny(startX, blocked, trunkGap)) return startX
    for (let step = 1; step <= 24; step++) {
      const delta = step * trunkGap
      const first = preferRight
        ? startX + delta
        : startX - delta
      const second = preferRight
        ? startX - delta
        : startX + delta
      for (const candidate of [first, second]) {
        if (Math.abs(candidate - startX) > maxShift) continue
        if (!overlapsAny(candidate, blocked, trunkGap)) return candidate
      }
    }
    return startX
  }

  for (const group of byGap.values()) {
    const clusterMid =
      group.reduce((sum, g) => sum + g.naturalX, 0) / Math.max(1, group.length)

    // Multi-child trunks first (flexible), then single-child (prefer card column).
    const trunkOrder = [...group].sort(
      (a, b) =>
        Number(a.singleChild) - Number(b.singleChild) ||
        a.trunkX - b.trunkX ||
        a.fork.key.localeCompare(b.fork.key),
    )

    for (const geom of trunkOrder) {
      const blocked = foreignVerticals(geom, group).filter((x) => {
        // Own brood columns are fine for the trunk (line continues into child).
        return !geom.childCenters.some((cx) => Math.abs(cx - x) < 0.5)
      })
      // Also avoid trunks already resolved in this pass.
      for (const other of group) {
        if (other === geom) continue
        blocked.push(other.trunkX)
      }

      const preferRight = geom.naturalX >= clusterMid
      const maxShift = geom.singleChild
        ? cardHalfW * 0.65
        : Math.max(cardHalfW * 2, trunkGap * 6)
      geom.trunkX = nudgeX(geom.trunkX, blocked, preferRight, maxShift)
      if (geom.singleChild) {
        geom.childDropXs[0] = geom.trunkX
      }
    }

    // Child drops: stay on-card but step off foreign stems/trunks (Eva vs
    // Aerwyna×Beck rail child under her column).
    for (const geom of group) {
      const blocked: number[] = []
      for (const other of group) {
        if (other === geom) continue
        blocked.push(...other.stemXs)
        blocked.push(other.trunkX)
        blocked.push(...other.childDropXs)
      }
      // Keep spacing from this fork's own trunk when it is not on that child.
      for (let i = 0; i < geom.childCenters.length; i++) {
        const center = geom.childCenters[i]!
        const ownBlocked = blocked.filter((x) => Math.abs(x - center) > 0.01)
        if (
          Math.abs(geom.trunkX - center) > mergePx &&
          !geom.singleChild
        ) {
          ownBlocked.push(geom.trunkX)
        }
        const preferRight = center >= clusterMid
        geom.childDropXs[i] = nudgeX(
          center,
          ownBlocked,
          preferRight,
          cardHalfW * 0.7,
        )
      }
      if (geom.singleChild && geom.childDropXs[0] !== undefined) {
        geom.trunkX = geom.childDropXs[0]!
      }
      geom.childMin = Math.min(...geom.childDropXs)
      geom.childMax = Math.max(...geom.childDropXs)
    }
  }

  const hole = RAIL_HOLE * zoom

  /** Horizontal rail with gaps so foreign verticals do not form false T-joints. */
  function appendBrokenRail(
    parts: string[],
    y: number,
    lo: number,
    hi: number,
    obstacles: number[],
  ) {
    if (hi - lo <= 0.5) return
    const cuts = obstacles
      .filter((x) => x > lo + hole && x < hi - hole)
      .sort((a, b) => a - b)
    let cursor = lo
    for (const ox of cuts) {
      const segHi = ox - hole
      if (segHi - cursor > 0.5) {
        parts.push(`M ${cursor} ${y} H ${segHi}`)
      }
      cursor = Math.max(cursor, ox + hole)
    }
    if (hi - cursor > 0.5) {
      parts.push(`M ${cursor} ${y} H ${hi}`)
    }
  }

  function obstaclesFor(geom: ForkGeom): number[] {
    const group = byGap.get(geom.gapKey) ?? []
    const xs: number[] = []
    for (const other of group) {
      if (other === geom) continue
      xs.push(...other.stemXs)
      xs.push(other.trunkX)
      xs.push(...other.childDropXs)
    }
    return xs
  }

  for (const geom of geoms) {
    const {
      fork,
      drawStems,
      unionY,
      railY,
      childTop,
      childMin,
      childMax,
      naturalX,
      trunkX,
      singleChild,
      childDropXs,
    } = geom
    const parts: string[] = []
    const obstacles = obstaclesFor(geom)

    const stemBottomY = (generation: number) =>
      genTopY(generation, tops, zoom) + visualHZoom

    const exitX = (stemId: string, fallbackX: number) =>
      stemExitXs.get(`${fork.key}|${stemId}`) ?? nodeCenterX(fallbackX, zoom)

    if (drawStems.length >= 2) {
      const exits = drawStems
        .map((s) => exitX(s.id, s.x))
        .sort((a, b) => a - b)
      const leftStem = exits[0]!
      const rightStem = exits[exits.length - 1]!

      for (const stem of drawStems) {
        const px = exitX(stem.id, stem.x)
        parts.push(`M ${px} ${stemBottomY(stem.generation)} V ${unionY}`)
      }

      // Parent bar stays between the mates. Never extend it to a far-away
      // only-child (Aerwyna×Beck → Caerula under Eva|Carl) - that painted a
      // highway through the neighboring couple and fused with their stems.
      parts.push(`M ${leftStem} ${unionY} H ${rightStem}`)

      if (singleChild) {
        if (Math.abs(trunkX - naturalX) <= mergePx) {
          parts.push(`M ${trunkX} ${unionY} V ${childTop}`)
        } else {
          parts.push(`M ${naturalX} ${unionY} V ${railY}`)
          appendBrokenRail(
            parts,
            railY,
            Math.min(naturalX, trunkX),
            Math.max(naturalX, trunkX),
            obstacles,
          )
          parts.push(`M ${trunkX} ${railY} V ${childTop}`)
        }
      } else {
        parts.push(`M ${trunkX} ${unionY} V ${railY}`)
        appendBrokenRail(
          parts,
          railY,
          Math.min(childMin, trunkX),
          Math.max(childMax, trunkX),
          obstacles,
        )
        for (const cx of childDropXs) {
          parts.push(`M ${cx} ${railY} V ${childTop}`)
        }
      }
    } else {
      const stem = drawStems[0]!
      const px = exitX(stem.id, stem.x)

      if (singleChild) {
        if (Math.abs(trunkX - px) <= mergePx) {
          parts.push(`M ${px} ${stemBottomY(stem.generation)} V ${childTop}`)
        } else {
          parts.push(`M ${px} ${stemBottomY(stem.generation)} V ${railY}`)
          appendBrokenRail(
            parts,
            railY,
            Math.min(px, trunkX),
            Math.max(px, trunkX),
            obstacles,
          )
          parts.push(`M ${trunkX} ${railY} V ${childTop}`)
        }
      } else {
        parts.push(`M ${px} ${stemBottomY(stem.generation)} V ${railY}`)
        appendBrokenRail(
          parts,
          railY,
          Math.min(px, trunkX, childMin),
          Math.max(px, trunkX, childMax),
          obstacles,
        )
        for (const cx of childDropXs) {
          parts.push(`M ${cx} ${railY} V ${childTop}`)
        }
      }
    }

    paths.push({
      key: `fork-${fork.key}`,
      d: parts.join(' '),
      dragonIds: [
        ...fork.stems.map((s) => s.id),
        ...fork.children.map((c) => c.id),
      ],
    })
  }

  return paths
}

/** Horizontal sibling link through the visible card mid-line. */
function siblingEdgePath(
  aX: number,
  bX: number,
  generation: number,
  tops: Map<number, number>,
  zoom: number,
  lod: TreeLod,
): string {
  const { w, h } = lodNodeSize(lod)
  const leftX = Math.min(aX, bX)
  const rightX = Math.max(aX, bX)
  const y = genTopY(generation, tops, zoom) + (h * zoom) / 2
  const x1 = nodeCenterX(leftX, zoom) + (w * zoom) / 2
  const x2 = nodeCenterX(rightX, zoom) - (w * zoom) / 2
  if (x2 <= x1) {
    const mid = (nodeCenterX(leftX, zoom) + nodeCenterX(rightX, zoom)) / 2
    return `M ${mid - 4 * zoom} ${y} H ${mid + 4 * zoom}`
  }
  return `M ${x1} ${y} H ${x2}`
}

function clampZoom(value: number): number {
  return Math.min(MAX_TREE_ZOOM, Math.max(MIN_TREE_ZOOM, value))
}

function dragonIdAtPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY)
  if (!el || !(el instanceof Element)) return null
  const node = el.closest('[data-dragon-id]')
  return node?.getAttribute('data-dragon-id') ?? null
}

export function TreeCanvas({
  project,
  selectedDragonId,
  viewFocusId,
  interactive,
  emptyLine,
  ancestorGenerations,
  descendantGenerations,
  menu,
  onSelectDragon,
  onOpenMenu,
  onCloseMenu,
  onMenuAction,
  onImportDragonPage,
  onPasteImportDragon,
}: TreeCanvasProps) {
  const { treeZoom: zoom, treeViewMode, highlightKin, hideExalted } =
    useViewSettings()
  const lod: TreeLod = treeLodFromZoom(zoom)
  // Canvas layout can omit exalted dragons; edits still use the full project.
  const treeProject = useMemo(() => {
    if (!hideExalted) return project
    const dragons: Project['dragons'] = {}
    for (const [id, dragon] of Object.entries(project.dragons)) {
      if (!dragon.exalted) dragons[id] = dragon
    }
    return { ...project, dragons }
  }, [project, hideExalted])
  const dragons = listDragons(treeProject)
  const childrenIndex = useMemo(
    () => buildChildrenIndex(treeProject),
    [treeProject],
  )
  // Tree stays on the last linked focus even while an unlinked create is selected.
  const focusId =
    (viewFocusId && treeProject.dragons[viewFocusId] ? viewFocusId : null) ??
    (selectedDragonId && treeProject.dragons[selectedDragonId]
      ? selectedDragonId
      : null) ??
    dragons[0]?.id ??
    null

  /** Local relatives center on the selection when possible. */
  const localFocusId =
    (selectedDragonId && treeProject.dragons[selectedDragonId]
      ? selectedDragonId
      : null) ?? focusId

  const layout = useMemo(() => {
    if (dragons.length === 0) return null

    // Edit mode: Relatives vs All on the stable map. Settings generation
    // limits apply only to Export (non-interactive) focus trees.
    if (interactive) {
      const full = buildStableTree(treeProject, {
        maxGenerations: Number.POSITIVE_INFINITY,
      })
      if (!full) return null
      if (treeViewMode === 'local' && localFocusId) {
        const keep = collectLocalRelativeIds(
          treeProject,
          localFocusId,
          childrenIndex,
        )
        return filterAndCompactLayout(full, keep)
      }
      return full
    }

    const ancLimit =
      ancestorGenerations === null
        ? Number.POSITIVE_INFINITY
        : ancestorGenerations
    const desLimit =
      descendantGenerations === null
        ? Number.POSITIVE_INFINITY
        : descendantGenerations

    if (!focusId) return null
    return buildFocusTree(treeProject, focusId, {
      ancestorGenerations: ancLimit,
      descendantGenerations: desLimit,
    })
  }, [
    treeProject,
    dragons.length,
    interactive,
    focusId,
    localFocusId,
    ancestorGenerations,
    descendantGenerations,
    treeViewMode,
    childrenIndex,
  ])

  const localKeepIds = useMemo(() => {
    if (!interactive || treeViewMode !== 'local' || !localFocusId) return null
    return collectLocalRelativeIds(treeProject, localFocusId, childrenIndex)
  }, [interactive, treeViewMode, localFocusId, treeProject, childrenIndex])

  /**
   * Selected dragon + close kin - All mode + Highlight kin only.
   * Null when there is no kin to show (isolated selection) so the rest of
   * the map is not dimmed / edge-lit for an empty highlight set.
   */
  const relatedIds = useMemo(() => {
    if (!highlightKin || treeViewMode !== 'all') return null
    if (!selectedDragonId || !treeProject.dragons[selectedDragonId]) return null
    const set = new Set<string>([selectedDragonId])
    for (const dragon of dragons) {
      if (dragon.id === selectedDragonId) continue
      if (
        kinshipInfo(treeProject, selectedDragonId, dragon.id, childrenIndex)
      ) {
        set.add(dragon.id)
      }
    }
    if (set.size <= 1) return null
    return set
  }, [
    highlightKin,
    treeViewMode,
    selectedDragonId,
    treeProject,
    dragons,
    childrenIndex,
  ])

  const inTree = new Set(layout?.nodes.map((node) => node.dragonId) ?? [])
  const freePlaced = dragons.filter((dragon) => {
    if (inTree.has(dragon.id)) return false
    if (dragon.posX === null || dragon.posY === null) return false
    if (localKeepIds && !localKeepIds.has(dragon.id)) return false
    return true
  })

  const viewportRef = useRef<HTMLElement>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef({ x: 0, y: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [linkLine, setLinkLine] = useState<{
    x1: number
    y1: number
    x2: number
    y2: number
  } | null>(null)

  const panSession = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  const linkSession = useRef<{
    pointerId: number
    fromId: string
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  zoomRef.current = zoom
  panRef.current = pan

  const positions = new Map(
    layout?.nodes.map((node) => [node.dragonId, node] as const) ?? [],
  )

  /**
   * Prefer live mother/father links among placed nodes over pack-time edges.
   * Packing can seat a mate via placeBesidePartner and skip the rest of that
   * parent's forest - kids still sit underneath, but layout.edges omits them.
   */
  const lineageEdges = useMemo(() => {
    if (!layout) return [] as { parentId: string; childId: string }[]
    const slotOf = new Map(
      layout.nodes.map((n) => [n.dragonId, n] as const),
    )
    const edges: { parentId: string; childId: string }[] = []
    const seen = new Set<string>()
    for (const [childId, childSlot] of slotOf) {
      const child = treeProject.dragons[childId]
      if (!child) continue
      for (const parentId of [child.motherId, child.fatherId]) {
        if (!parentId) continue
        const parentSlot = slotOf.get(parentId)
        // Only draw downward parent→child forks.
        if (!parentSlot || parentSlot.generation >= childSlot.generation) {
          continue
        }
        const key = `${parentId}->${childId}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ parentId, childId })
      }
    }
    return edges
  }, [layout, treeProject])

  const forkPlan = useMemo(() => {
    if (!layout) {
      return {
        forks: [] as LaneFork[],
        laneCountByGap: new Map<string, number>(),
      }
    }
    return planParentForkLanes(lineageEdges, positions, treeProject)
    // positions is rebuilt each render from layout.nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, treeProject, lineageEdges])

  const gapAfter = useMemo(() => {
    if (!layout) return new Map<number, number>()
    return gapAfterFromLanes(
      layout.minGeneration,
      layout.maxGeneration,
      forkPlan.laneCountByGap,
    )
  }, [layout, forkPlan])

  const genTops = useMemo(() => {
    if (!layout) return new Map<number, number>()
    return buildGenerationTops(
      layout.minGeneration,
      layout.maxGeneration,
      gapAfter,
    )
  }, [layout, gapAfter])

  const layoutWidth = layout
    ? PAD_X * 2 + (Math.max(...layout.nodes.map((n) => n.x), 0) + 1) * CELL_W
    : 0
  const layoutHeight = layout
    ? (genTops.get(layout.maxGeneration) ?? PAD_Y) + NODE_H + PAD_Y
    : 0

  let contentWidth = layoutWidth
  let contentHeight = layoutHeight
  for (const dragon of freePlaced) {
    contentWidth = Math.max(contentWidth, (dragon.posX ?? 0) + NODE_W + PAD_X)
    contentHeight = Math.max(contentHeight, (dragon.posY ?? 0) + NODE_H + PAD_Y)
  }
  const boardWidth = Math.max(contentWidth, 1) * zoom
  const boardHeight = Math.max(contentHeight, 1) * zoom

  const layoutKey = layout
    ? `${interactive ? 'stable' : 'focus'}:${layout.nodes
        .map((n) => `${n.dragonId}:${n.generation}:${n.x}`)
        .join('|')}`
    : ''

  useEffect(() => {
    if (!layout || !viewportRef.current || layoutWidth === 0) return
    const rect = viewportRef.current.getBoundingClientRect()
    const z = zoomRef.current
    const node =
      selectedDragonId != null
        ? layout.nodes.find((n) => n.dragonId === selectedDragonId)
        : undefined

    if (node) {
      const cx = (PAD_X + node.x * CELL_W + CELL_W / 2) * z
      const cy =
        genTopY(node.generation, genTops, z) + (NODE_H * z) / 2
      setPan({ x: rect.width / 2 - cx, y: rect.height / 2 - cy })
      return
    }

    setPan({
      x: (rect.width - layoutWidth * z) / 2,
      y: (rect.height - layoutHeight * z) / 2,
    })
  }, [layoutKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function clientToWorldTopLeft(clientX: number, clientY: number) {
    const viewport = viewportRef.current
    if (!viewport) return { x: 0, y: 0 }
    const rect = viewport.getBoundingClientRect()
    const z = zoomRef.current
    return {
      x: (clientX - rect.left - panRef.current.x) / z - NODE_W / 2,
      y: (clientY - rect.top - panRef.current.y) / z - NODE_H / 2,
    }
  }

  function occupiedRects(): Rect[] {
    const rects: Rect[] = []
    if (layout) {
      for (const node of layout.nodes) {
        const topLeft = packedNodeTopLeft(node, layout.minGeneration, {
          y: genTops.get(node.generation),
        })
        rects.push({ ...topLeft, w: NODE_W, h: NODE_H })
      }
    }
    for (const dragon of freePlaced) {
      rects.push({
        x: dragon.posX!,
        y: dragon.posY!,
        w: NODE_W,
        h: NODE_H,
      })
    }
    return rects
  }

  function zoomAt(clientX: number, clientY: number, nextZoom: number) {
    const viewport = viewportRef.current
    if (!viewport) {
      setViewSettings({ treeZoom: nextZoom })
      return
    }

    const rect = viewport.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const current = zoomRef.current
    const clamped = clampZoom(nextZoom)
    if (clamped === current) return

    const wx = (mx - panRef.current.x) / current
    const wy = (my - panRef.current.y) / current
    setPan({
      x: mx - wx * clamped,
      y: my - wy * clamped,
    })
    setViewSettings({ treeZoom: clamped })
  }

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    function onWheel(event: globalThis.WheelEvent) {
      if (dragons.length === 0) return
      event.preventDefault()
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      zoomAt(event.clientX, event.clientY, zoomRef.current * factor)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [dragons.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!linkLine) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      linkSession.current = null
      setLinkLine(null)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [linkLine])

  function handleContextMenu(event: MouseEvent) {
    if (!interactive) return
    event.preventDefault()
    const preferred = clientToWorldTopLeft(event.clientX, event.clientY)
    const free = findFreePosition(preferred.x, preferred.y, occupiedRects())
    onOpenMenu({
      x: event.clientX,
      y: event.clientY,
      target: { kind: 'empty', worldX: free.x, worldY: free.y },
    })
  }

  function beginPan(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    if (linkSession.current) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        '.dragon-node, .context-menu, .tree-canvas__zoom, .tree-canvas__import-group, .tree-canvas__toolbar',
      )
    ) {
      return
    }

    panSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPanning(true)
  }

  function beginLink(
    fromId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!interactive || event.button !== 0) return
    event.stopPropagation()

    const viewport = viewportRef.current
    if (!viewport) return

    const fromRect = event.currentTarget.getBoundingClientRect()
    const viewRect = viewport.getBoundingClientRect()
    const originX = fromRect.left + fromRect.width / 2 - viewRect.left
    const originY = fromRect.top + fromRect.height / 2 - viewRect.top

    linkSession.current = {
      pointerId: event.pointerId,
      fromId,
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
      moved: false,
    }
    panSession.current = null
    setIsPanning(false)
    viewport.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const link = linkSession.current
    if (link && link.pointerId === event.pointerId) {
      const dx = event.clientX - link.startX
      const dy = event.clientY - link.startY
      if (
        !link.moved &&
        (Math.abs(dx) > CLICK_DRAG_THRESHOLD ||
          Math.abs(dy) > CLICK_DRAG_THRESHOLD)
      ) {
        link.moved = true
      }
      if (link.moved) {
        const viewport = viewportRef.current
        if (!viewport) return
        const viewRect = viewport.getBoundingClientRect()
        setLinkLine({
          x1: link.originX,
          y1: link.originY,
          x2: event.clientX - viewRect.left,
          y2: event.clientY - viewRect.top,
        })
      }
      return
    }

    const session = panSession.current
    if (!session || session.pointerId !== event.pointerId) return

    const dx = event.clientX - session.startX
    const dy = event.clientY - session.startY
    if (
      !session.moved &&
      (Math.abs(dx) > CLICK_DRAG_THRESHOLD || Math.abs(dy) > CLICK_DRAG_THRESHOLD)
    ) {
      session.moved = true
    }
    setPan({ x: session.originX + dx, y: session.originY + dy })
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const link = linkSession.current
    if (link && link.pointerId === event.pointerId) {
      const moved = link.moved
      const fromId = link.fromId
      linkSession.current = null
      setLinkLine(null)
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // already released
      }

      if (!moved) {
        onSelectDragon(fromId)
        return
      }

      const toId = dragonIdAtPoint(event.clientX, event.clientY)
      if (!toId || toId === fromId) return
      if (!project.dragons[toId]) return

      onOpenMenu({
        x: event.clientX,
        y: event.clientY,
        target: { kind: 'link', fromId, toId },
      })
      return
    }

    const session = panSession.current
    if (!session || session.pointerId !== event.pointerId) return

    panSession.current = null
    setIsPanning(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // already released
    }
  }

  const menuItems = (() => {
    if (menu === null) return []
    if (menu.target.kind === 'empty') return emptyMenuItems()
    if (menu.target.kind === 'dragon') {
      const dragon = project.dragons[menu.target.dragonId]
      return dragon ? dragonMenuItems(dragon) : []
    }
    const from = project.dragons[menu.target.fromId]
    const to = project.dragons[menu.target.toId]
    if (!from || !to) return []
    return linkMenuItems(from, to)
  })()

  const canvasClass = [
    'tree-canvas',
    isPanning ? 'tree-canvas--panning' : '',
    linkLine ? 'tree-canvas--linking' : '',
  ]
    .filter(Boolean)
    .join(' ')

  function renderDragonNode(
    dragon: Dragon,
    options: { selected: boolean; focused?: boolean; style?: CSSProperties },
  ) {
    const relation =
      lod === 'full' && selectedDragonId && !options.selected
        ? kinshipInfo(treeProject, selectedDragonId, dragon.id, childrenIndex)
        : null
    const dimmed = Boolean(
      relatedIds && !options.selected && !relatedIds.has(dragon.id),
    )

    return (
      <DragonNode
        key={dragon.id}
        dragon={dragon}
        selected={options.selected}
        focused={options.focused}
        dimmed={dimmed}
        relationLabel={relation?.card ?? null}
        relationTitle={relation?.full ?? null}
        lod={lod}
        style={options.style}
        onSelect={() => onSelectDragon(dragon.id)}
        onNodePointerDown={
          interactive
            ? (event) => beginLink(dragon.id, event)
            : undefined
        }
        onContextMenu={(event) => {
          if (!interactive) return
          onOpenMenu({
            x: event.clientX,
            y: event.clientY,
            target: { kind: 'dragon', dragonId: dragon.id },
          })
        }}
      />
    )
  }

  const viewModeClass =
    interactive && treeViewMode === 'local'
      ? 'tree-canvas--view-local'
      : interactive
        ? 'tree-canvas--view-all'
        : ''

  return (
    <section
      ref={viewportRef}
      className={[canvasClass, viewModeClass, `tree-canvas--lod-${lod}`]
        .filter(Boolean)
        .join(' ')}
      aria-label="Family tree"
      onContextMenu={handleContextMenu}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {dragons.length === 0 ? (
        <p className="tree-canvas__empty">
          {emptyLine}
          {interactive ? (
            <>
              <br />
              <span className="tree-canvas__hint">
                Right-click to create a dragon, or import a downloaded page.
              </span>
            </>
          ) : null}
        </p>
      ) : (
        <>
          <div
            className="tree-canvas__world"
            style={
              {
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                '--tree-zoom': String(zoom),
              } as CSSProperties
            }
          >
            <div
              className="tree-canvas__board"
              style={{ width: boardWidth, height: boardHeight }}
            >
              {layout ? (
                <svg
                  className="tree-canvas__edges"
                  width={boardWidth}
                  height={boardHeight}
                  aria-hidden="true"
                >
                  {(() => {
                    const forks = parentForkPaths(
                      forkPlan.forks,
                      genTops,
                      zoom,
                      lod,
                    ).map((path) => {
                      const hit = path.dragonIds.filter((id) =>
                        relatedIds?.has(id),
                      )
                      // Only light edges that connect at least two highlighted kin.
                      const active = !relatedIds || hit.length >= 2
                      return { ...path, active, kind: 'fork' as const }
                    })
                    const siblings = layout.siblingEdges.flatMap((edge) => {
                      const a = positions.get(edge.aId)
                      const b = positions.get(edge.bId)
                      if (!a || !b) return []
                      const active =
                        !relatedIds ||
                        (relatedIds.has(edge.aId) &&
                          relatedIds.has(edge.bId))
                      return [
                        {
                          key: `s-${edge.aId}-${edge.bId}`,
                          d: siblingEdgePath(
                            a.x,
                            b.x,
                            a.generation,
                            genTops,
                            zoom,
                            lod,
                          ),
                          active,
                          kind: 'sibling' as const,
                        },
                      ]
                    })
                    // Dim first, lit on top so kin paths stay readable.
                    const ordered = [...forks, ...siblings].sort(
                      (a, b) => Number(a.active) - Number(b.active),
                    )
                    return ordered.map((path) => (
                      <path
                        key={path.key}
                        d={path.d}
                        className={[
                          'tree-canvas__edge',
                          path.kind === 'sibling'
                            ? 'tree-canvas__edge--sibling'
                            : '',
                          relatedIds
                            ? path.active
                              ? 'tree-canvas__edge--lit'
                              : 'tree-canvas__edge--dim'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                    ))
                  })()}
                </svg>
              ) : null}

              {layout
                ? layout.nodes.map((node) => {
                    const dragon = project.dragons[node.dragonId]
                    if (!dragon) return null
                    return renderDragonNode(dragon, {
                      selected: dragon.id === selectedDragonId,
                      focused: !interactive && dragon.id === layout.focusId,
                      style: {
                        position: 'absolute',
                        left: (PAD_X + node.x * CELL_W + CELL_W / 2) * zoom,
                        top: genTopY(node.generation, genTops, zoom),
                        transform: 'translateX(-50%)',
                      },
                    })
                  })
                : null}

              {freePlaced.map((dragon) =>
                renderDragonNode(dragon, {
                  selected: dragon.id === selectedDragonId,
                  style: {
                    position: 'absolute',
                    left: dragon.posX! * zoom,
                    top: dragon.posY! * zoom,
                  },
                }),
              )}
            </div>
          </div>

        </>
      )}

      {interactive && dragons.length > 0 ? (
        <div className="tree-canvas__toolbar">
          <div
            className="tree-canvas__view-mode"
            role="group"
            aria-label="Tree view scope"
          >
            <button
              type="button"
              className={
                treeViewMode === 'local'
                  ? 'tree-canvas__view-mode-btn tree-canvas__view-mode-btn--active'
                  : 'tree-canvas__view-mode-btn'
              }
              aria-pressed={treeViewMode === 'local'}
              title="Parents, children, full siblings, and mates of the selected dragon"
              onClick={() => setViewSettings({ treeViewMode: 'local' })}
            >
              Relatives
            </button>
            <button
              type="button"
              className={
                treeViewMode === 'all'
                  ? 'tree-canvas__view-mode-btn tree-canvas__view-mode-btn--active'
                  : 'tree-canvas__view-mode-btn'
              }
              aria-pressed={treeViewMode === 'all'}
              title="Full bloodline map"
              onClick={() => setViewSettings({ treeViewMode: 'all' })}
            >
              All
            </button>
          </div>
          {treeViewMode === 'all' ? (
            <button
              type="button"
              className={
                highlightKin
                  ? 'tree-canvas__highlight-btn tree-canvas__highlight-btn--active'
                  : 'tree-canvas__highlight-btn'
              }
              aria-pressed={highlightKin}
              title={
                selectedDragonId
                  ? 'Dim unrelated dragons and highlight kinship links of the selection'
                  : 'Select a dragon, then highlight their kin and links'
              }
              onClick={() => setViewSettings({ highlightKin: !highlightKin })}
            >
              Highlight kin
            </button>
          ) : null}
          <button
            type="button"
            className={
              hideExalted
                ? 'tree-canvas__highlight-btn tree-canvas__highlight-btn--active'
                : 'tree-canvas__highlight-btn'
            }
            aria-pressed={hideExalted}
            title="Hide dragons marked as exalted on Flight Rising"
            onClick={() => setViewSettings({ hideExalted: !hideExalted })}
          >
            Hide exalted
          </button>
        </div>
      ) : null}

      {interactive && (onImportDragonPage || onPasteImportDragon) ? (
        <div className="tree-canvas__import-group">
          {onImportDragonPage ? (
            <button
              type="button"
              className="tree-canvas__import"
              title="Import downloaded Flight Rising dragon pages (.mhtml or .html). Select several files at once."
              onClick={onImportDragonPage}
            >
              Import pages
            </button>
          ) : null}
          {onPasteImportDragon ? (
            <button
              type="button"
              className="tree-canvas__import"
              title="Paste text copied from a Flight Rising dragon profile page."
              onClick={onPasteImportDragon}
            >
              Paste text
            </button>
          ) : null}
        </div>
      ) : null}

      {dragons.length > 0 ? (
        <div className="tree-canvas__zoom" role="group" aria-label="Zoom">
          <input
            type="range"
            className="tree-canvas__zoom-bar"
            min={MIN_TREE_ZOOM}
            max={MAX_TREE_ZOOM}
            step={0.01}
            value={zoom}
            aria-valuemin={MIN_TREE_ZOOM}
            aria-valuemax={MAX_TREE_ZOOM}
            aria-valuenow={zoom}
            aria-valuetext={`${Math.round(zoom * 100)} percent`}
            aria-label="Zoom"
            title={`${Math.round(zoom * 100)}%`}
            onChange={(event) => {
              const next = Number(event.target.value)
              const viewport = viewportRef.current
              if (!viewport) {
                setViewSettings({ treeZoom: next })
                return
              }
              const rect = viewport.getBoundingClientRect()
              zoomAt(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                next,
              )
            }}
            onDoubleClick={() => {
              const viewport = viewportRef.current
              if (!viewport) {
                setViewSettings({ treeZoom: 1 })
                return
              }
              const rect = viewport.getBoundingClientRect()
              zoomAt(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                1,
              )
            }}
          />
        </div>
      ) : null}

      {linkLine ? (
        <svg className="tree-canvas__link-band" aria-hidden="true">
          <line
            x1={linkLine.x1}
            y1={linkLine.y1}
            x2={linkLine.x2}
            y2={linkLine.y2}
            className="tree-canvas__link-band-line"
          />
        </svg>
      ) : null}

      {menu && interactive && menuItems.length > 0 ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={onCloseMenu}
          onSelect={(id) => onMenuAction(id, menu.target)}
        />
      ) : null}
    </section>
  )
}
