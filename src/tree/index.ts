export { buildChildrenIndex, getChildren, listDragons } from './graph'
export type { ChildrenIndex } from './graph'

export {
  RelationError,
  collectAncestors,
  wouldCreateCycle,
  assertCanSetParent,
} from './validation'

export {
  addDragon,
  updateDragonFields,
  setMother,
  setFather,
  linkAsParent,
  linkAsChild,
  linkAsSiblings,
  areSiblings,
  shareAParent,
  shareBothParents,
  canLinkAsParent,
  canLinkAsChild,
  canLinkAsSiblings,
  createMotherFor,
  createFatherFor,
  createChildOf,
  removeDragon,
} from './relations'
export type { RelationResult } from './relations'

export { buildFocusTree } from './buildFocusTree'
export type { FocusTreeOptions } from './buildFocusTree'

export { buildStableTree, isUnlinkedIsolate } from './buildStableTree'
export type { StableTreeOptions } from './buildStableTree'

export type {
  TreeLayout,
  TreeLayoutNode,
  TreeLayoutEdge,
  TreeLayoutSiblingEdge,
} from './treeLayout'

/** @deprecated aliases */
export type {
  FocusTreeLayout,
  FocusTreeNode,
  FocusTreeEdge,
} from './buildFocusTree'
