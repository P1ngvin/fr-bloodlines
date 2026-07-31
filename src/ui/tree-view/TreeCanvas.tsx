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
  kinshipLabel,
  listDragons,
} from '../../tree'
import {
  findFreePosition,
  FREE_NODE_H,
  FREE_NODE_W,
  LAYOUT_CELL_H,
  LAYOUT_CELL_W,
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
}

const CELL_W = LAYOUT_CELL_W
/** Must match .dragon-node height at --tree-zoom: 1 (padding + portrait + gap + name). */
const NODE_H = FREE_NODE_H
/** Must match .dragon-node width at --tree-zoom: 1. */
const NODE_W = FREE_NODE_W
const CELL_H = LAYOUT_CELL_H
const PAD_X = LAYOUT_PAD_X
const PAD_Y = LAYOUT_PAD_Y
const CLICK_DRAG_THRESHOLD = 4
const ZOOM_STEP = 1.15

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

function nodeTopY(generation: number, minGeneration: number, zoom: number) {
  return (PAD_Y + (generation - minGeneration) * CELL_H) * zoom
}

function nodeCenterX(x: number, zoom: number) {
  return (PAD_X + x * CELL_W + CELL_W / 2) * zoom
}

type LayoutPos = { dragonId?: string; generation: number; x: number }

/**
 * Orthogonal parent→child forks, grouped by parental couple (not by parent).
 * So Belthil+Sidhe→Oconel and Belthil+Morilinde→Hannibal stay separate
 * instead of one rail that glues all of Belthil's kids together.
 */
function parentForkPaths(
  edges: { parentId: string; childId: string }[],
  positions: Map<string, LayoutPos>,
  minGeneration: number,
  zoom: number,
): { key: string; d: string }[] {
  type ChildSlot = { id: string; generation: number; x: number }
  type Fork = {
    key: string
    stems: { id: string; x: number; generation: number }[]
    children: ChildSlot[]
    childGen: number
    spanLo: number
    spanHi: number
  }

  const parentsOfChild = new Map<string, string[]>()
  for (const edge of edges) {
    const list = parentsOfChild.get(edge.childId) ?? []
    if (!list.includes(edge.parentId)) list.push(edge.parentId)
    parentsOfChild.set(edge.childId, list)
  }

  const byCouple = new Map<string, Fork>()
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
    const existing = byCouple.get(key)
    if (existing) {
      if (!existing.children.some((c) => c.id === childId)) {
        existing.children.push(child)
      }
      existing.spanLo = Math.min(existing.spanLo, ...xs)
      existing.spanHi = Math.max(existing.spanHi, ...xs)
      existing.childGen = Math.min(existing.childGen, child.generation)
    } else {
      byCouple.set(key, {
        key,
        stems,
        children: [child],
        childGen: child.generation,
        spanLo: Math.min(...xs),
        spanHi: Math.max(...xs),
      })
    }
  }

  type LaneFork = Fork & {
    lane: number
    laneCount: number
    parentBottom: number
    childTop: number
  }
  const laneForks: LaneFork[] = []

  const byGap = new Map<string, Fork[]>()
  for (const fork of byCouple.values()) {
    const parentGen = Math.min(...fork.stems.map((s) => s.generation))
    const gapKey = `${parentGen}->${fork.childGen}`
    const list = byGap.get(gapKey) ?? []
    list.push(fork)
    byGap.set(gapKey, list)
  }

  function rangesInterleave(a: Fork, b: Fork): boolean {
    return (
      (a.spanLo < b.spanLo && b.spanLo < a.spanHi && a.spanHi < b.spanHi) ||
      (b.spanLo < a.spanLo && a.spanLo < b.spanHi && b.spanHi < a.spanHi)
    )
  }

  function forksConflict(a: Fork, b: Fork): boolean {
    const aStems = new Set(a.stems.map((s) => s.id))
    const bStems = new Set(b.stems.map((s) => s.id))
    const shared = [...aStems].filter((id) => bStems.has(id))

    if (shared.length > 0) {
      // Half-siblings: solo parent + couple that includes them should share one
      // rail (Gargith→Haunt with mother, Gargith→Lerich alone).
      if (a.stems.length === 1 || b.stems.length === 1) return false
      // Two full couples sharing a mate (Belthil×Sidhe vs Belthil×Morilinde).
      return true
    }

    // Interleaved couples (A _ B _ A-mate _ B-mate) must never share a rail.
    if (rangesInterleave(a, b)) return true

    if (a.spanHi < b.spanLo - 0.05 || b.spanHi < a.spanLo - 0.05) return false
    return true
  }

  for (const group of byGap.values()) {
    const ordered = [...group].sort(
      (a, b) => a.spanLo - b.spanLo || a.key.localeCompare(b.key),
    )
    const laneOf: { fork: Fork; lane: number }[] = []

    for (const fork of ordered) {
      const used = new Set<number>()
      for (const prev of laneOf) {
        if (forksConflict(prev.fork, fork)) used.add(prev.lane)
      }
      // Full couples always take distinct lanes from other full couples in the
      // same gap - prevents one continuous H-rail across unrelated pairs.
      if (fork.stems.length >= 2) {
        for (const prev of laneOf) {
          if (prev.fork.stems.length >= 2) used.add(prev.lane)
        }
      }
      let lane = 0
      while (used.has(lane)) lane += 1
      laneOf.push({ fork, lane })
    }

    const laneCount = Math.max(1, ...laneOf.map((e) => e.lane + 1))
    for (const { fork, lane } of laneOf) {
      laneForks.push({
        ...fork,
        lane,
        laneCount,
        parentBottom: Math.max(
          ...fork.stems.map(
            (s) =>
              nodeTopY(s.generation, minGeneration, zoom) + NODE_H * zoom,
          ),
        ),
        childTop: nodeTopY(fork.childGen, minGeneration, zoom),
      })
    }
  }

  const paths: { key: string; d: string }[] = []

  for (const fork of laneForks) {
    const gap = fork.childTop - fork.parentBottom
    if (gap <= 1) continue

    const laneBand = gap / (fork.laneCount + 1)
    const unionY = fork.parentBottom + laneBand * (fork.lane + 0.35)
    const railY = fork.parentBottom + laneBand * (fork.lane + 0.75)
    if (unionY >= fork.childTop - 2) continue

    const childXs = fork.children.map((c) => c.x)
    const childMin = nodeCenterX(Math.min(...childXs), zoom)
    const childMax = nodeCenterX(Math.max(...childXs), zoom)
    const parts: string[] = []

    const halfSiblingSolo = (couple: LaneFork) =>
      laneForks.find(
        (other) =>
          other.lane === couple.lane &&
          other.childGen === couple.childGen &&
          other.stems.length === 1 &&
          couple.stems.some((s) => s.id === other.stems[0]!.id),
      )

    if (fork.stems.length >= 2) {
      const stemXs = fork.stems.map((s) => s.x).sort((a, b) => a - b)
      const leftStem = nodeCenterX(stemXs[0]!, zoom)
      const rightStem = nodeCenterX(stemXs[stemXs.length - 1]!, zoom)
      const midX = (leftStem + rightStem) / 2
      const flatHalf = Boolean(halfSiblingSolo(fork))

      for (const stem of fork.stems) {
        const px = nodeCenterX(stem.x, zoom)
        const stemBottom =
          nodeTopY(stem.generation, minGeneration, zoom) + NODE_H * zoom
        parts.push(`M ${px} ${stemBottom} V ${unionY}`)
      }
      parts.push(`M ${leftStem} ${unionY} H ${rightStem}`)

      // Half-siblings: one bar only (the couple union). Drop to own kids from it.
      // Full siblings: union → lower rail → children.
      const dropY = flatHalf ? unionY : railY
      if (!flatHalf) {
        if (railY >= fork.childTop - 2) continue
        parts.push(`M ${midX} ${unionY} V ${railY}`)
      }

      const dropX = Math.min(childMax, Math.max(childMin, midX))
      if (Math.abs(dropX - midX) > 0.5) {
        parts.push(`M ${midX} ${dropY} H ${dropX}`)
      }
      if (!flatHalf && Math.abs(childMax - childMin) > 0.5) {
        parts.push(`M ${childMin} ${railY} H ${childMax}`)
      }

      for (const child of fork.children) {
        const cx = nodeCenterX(child.x, zoom)
        parts.push(`M ${cx} ${dropY} V ${fork.childTop}`)
      }
    } else {
      const stem = fork.stems[0]!
      const px = nodeCenterX(stem.x, zoom)
      const stemBottom =
        nodeTopY(stem.generation, minGeneration, zoom) + NODE_H * zoom
      const coupleMate = laneForks.find(
        (other) =>
          other.lane === fork.lane &&
          other.childGen === fork.childGen &&
          other.stems.length >= 2 &&
          other.stems.some((s) => s.id === stem.id),
      )

      if (coupleMate) {
        // Shared parent already reaches unionY via the couple. Hang half-sibs
        // from that same bar — no second lower horizontal.
        for (const child of fork.children) {
          const cx = nodeCenterX(child.x, zoom)
          if (Math.abs(cx - px) > 0.5) {
            parts.push(`M ${px} ${unionY} H ${cx}`)
          }
          parts.push(`M ${cx} ${unionY} V ${fork.childTop}`)
        }
      } else {
        if (railY >= fork.childTop - 2) continue
        parts.push(`M ${px} ${stemBottom} V ${railY}`)
        const railLeft = Math.min(px, childMin, childMax)
        const railRight = Math.max(px, childMin, childMax)
        if (Math.abs(railRight - railLeft) > 0.5) {
          parts.push(`M ${railLeft} ${railY} H ${railRight}`)
        }
        for (const child of fork.children) {
          const cx = nodeCenterX(child.x, zoom)
          parts.push(`M ${cx} ${railY} V ${fork.childTop}`)
        }
      }
    }

    paths.push({ key: `fork-${fork.key}`, d: parts.join(' ') })
  }

  return paths
}

/** Horizontal sibling link in the gap between neighboring cards (not through art). */
function siblingEdgePath(
  aX: number,
  bX: number,
  generation: number,
  minGeneration: number,
  zoom: number,
): string {
  const leftX = Math.min(aX, bX)
  const rightX = Math.max(aX, bX)
  const y = nodeTopY(generation, minGeneration, zoom) + (NODE_H * zoom) / 2
  const x1 = nodeCenterX(leftX, zoom) + (NODE_W * zoom) / 2
  const x2 = nodeCenterX(rightX, zoom) - (NODE_W * zoom) / 2
  if (x2 <= x1) {
    // Cards overlap or touch - short mark at mid-gap of centers.
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
}: TreeCanvasProps) {
  const { treeZoom: zoom } = useViewSettings()
  const dragons = listDragons(project)
  const childrenIndex = useMemo(() => buildChildrenIndex(project), [project])
  // Tree stays on the last linked focus even while an unlinked create is selected.
  const focusId =
    (viewFocusId && project.dragons[viewFocusId] ? viewFocusId : null) ??
    (selectedDragonId && project.dragons[selectedDragonId]
      ? selectedDragonId
      : null) ??
    dragons[0]?.id ??
    null

  const layout = useMemo(() => {
    if (dragons.length === 0) return null

    const ancLimit =
      ancestorGenerations === null
        ? Number.POSITIVE_INFINITY
        : ancestorGenerations
    const desLimit =
      descendantGenerations === null
        ? Number.POSITIVE_INFINITY
        : descendantGenerations

    // Generation caps are relative to the selected dragon.
    const limitsActive =
      ancestorGenerations !== null || descendantGenerations !== null

    if (interactive && !limitsActive) {
      return buildStableTree(project, { maxGenerations: Number.POSITIVE_INFINITY })
    }

    if (!focusId) {
      return interactive
        ? buildStableTree(project, { maxGenerations: desLimit })
        : null
    }

    return buildFocusTree(project, focusId, {
      ancestorGenerations: ancLimit,
      descendantGenerations: desLimit,
    })
  }, [
    project,
    dragons.length,
    interactive,
    focusId,
    ancestorGenerations,
    descendantGenerations,
  ])

  const inTree = new Set(layout?.nodes.map((node) => node.dragonId) ?? [])
  const freePlaced = dragons.filter(
    (dragon) =>
      !inTree.has(dragon.id) &&
      dragon.posX !== null &&
      dragon.posY !== null,
  )

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

  const layoutWidth = layout
    ? PAD_X * 2 + (Math.max(...layout.nodes.map((n) => n.x), 0) + 1) * CELL_W
    : 0
  const layoutHeight = layout
    ? PAD_Y * 2 + (layout.maxGeneration - layout.minGeneration + 1) * CELL_H
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
        (PAD_Y + (node.generation - layout.minGeneration) * CELL_H) * z +
        (NODE_H * z) / 2
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
        const topLeft = packedNodeTopLeft(node, layout.minGeneration)
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
        '.dragon-node, .context-menu, .tree-canvas__zoom',
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
      selectedDragonId && !options.selected
        ? kinshipLabel(project, selectedDragonId, dragon.id, childrenIndex)
        : null

    return (
      <DragonNode
        key={dragon.id}
        dragon={dragon}
        selected={options.selected}
        focused={options.focused}
        relationLabel={relation}
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

  return (
    <section
      ref={viewportRef}
      className={canvasClass}
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
              <span className="tree-canvas__hint">Right-click to create a dragon.</span>
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
                  {parentForkPaths(
                    layout.edges,
                    positions,
                    layout.minGeneration,
                    zoom,
                  ).map((path) => (
                    <path
                      key={path.key}
                      d={path.d}
                      className="tree-canvas__edge"
                    />
                  ))}
                  {layout.siblingEdges.map((edge) => {
                    const a = positions.get(edge.aId)
                    const b = positions.get(edge.bId)
                    if (!a || !b) return null
                    return (
                      <path
                        key={`s-${edge.aId}-${edge.bId}`}
                        d={siblingEdgePath(
                          a.x,
                          b.x,
                          a.generation,
                          layout.minGeneration,
                          zoom,
                        )}
                        className="tree-canvas__edge tree-canvas__edge--sibling"
                      />
                    )
                  })}
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
                        top:
                          (PAD_Y +
                            (node.generation - layout.minGeneration) * CELL_H) *
                          zoom,
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
        </>
      )}

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
