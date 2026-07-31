/** Matches .dragon-node box and TreeCanvas packing at --tree-zoom: 1. */
export const FREE_NODE_W = 100
export const FREE_NODE_H = 116

export const LAYOUT_CELL_W = 118
export const LAYOUT_GEN_GAP = 88
export const LAYOUT_CELL_H = FREE_NODE_H + LAYOUT_GEN_GAP
export const LAYOUT_PAD_X = 48
export const LAYOUT_PAD_Y = 48

export type Rect = { x: number; y: number; w: number; h: number }

export type PackedNode = {
  x: number
  generation: number
}

function overlaps(a: Rect, b: Rect, pad = 12): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  )
}

/** Top-left of a packed layout node in unscaled board space. */
export function packedNodeTopLeft(
  node: PackedNode,
  minGeneration: number,
): { x: number; y: number } {
  return {
    x: LAYOUT_PAD_X + node.x * LAYOUT_CELL_W + LAYOUT_CELL_W / 2 - FREE_NODE_W / 2,
    y: LAYOUT_PAD_Y + (node.generation - minGeneration) * LAYOUT_CELL_H,
  }
}

/** Nudge a top-left position so the node does not cover occupied rects. */
export function findFreePosition(
  preferredX: number,
  preferredY: number,
  occupied: Rect[],
  width = FREE_NODE_W,
  height = FREE_NODE_H,
): { x: number; y: number } {
  const start = { x: preferredX, y: preferredY, w: width, h: height }
  if (!occupied.some((rect) => overlaps(start, rect))) {
    return { x: preferredX, y: preferredY }
  }

  const step = Math.max(width, height) * 0.55
  for (let ring = 1; ring <= 24; ring++) {
    for (let i = 0; i < ring * 6; i++) {
      const angle = (i / (ring * 6)) * Math.PI * 2
      const x = preferredX + Math.cos(angle) * step * ring
      const y = preferredY + Math.sin(angle) * step * ring
      const candidate = { x, y, w: width, h: height }
      if (!occupied.some((rect) => overlaps(candidate, rect))) {
        return { x, y }
      }
    }
  }

  return { x: preferredX + step, y: preferredY }
}
