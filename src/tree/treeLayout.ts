export type TreeLayoutNode = {
  dragonId: string
  /** Generation row (0 = top roots in stable layout; 0 = focus in focus layout) */
  generation: number
  /** Horizontal slot in relative units */
  x: number
}

/** Parent → child bloodline edge (orthogonal fork when one parent has several kids). */
export type TreeLayoutEdge = {
  parentId: string
  childId: string
}

/** Explicit sibling pair (horizontal). Only when they do not already share a parent. */
export type TreeLayoutSiblingEdge = {
  aId: string
  bId: string
}

export type TreeLayout = {
  /** Stable: primary root id. Focus: centered dragon id. */
  focusId: string
  nodes: TreeLayoutNode[]
  edges: TreeLayoutEdge[]
  siblingEdges: TreeLayoutSiblingEdge[]
  minGeneration: number
  maxGeneration: number
}
