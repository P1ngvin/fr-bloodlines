import { useSyncExternalStore } from 'react'
import {
  loadUiSession,
  saveUiSession,
  type DateFormat,
  type TreeViewMode,
} from '../storage/localStorage'
import {
  getSelectedDragonId,
  getViewFocusId,
  subscribeSelection,
} from './selectionStore'

export type { DateFormat, TreeViewMode }

export type ViewSettings = {
  /** null = show all ancestor generations */
  ancestorGenerations: number | null
  /** null = show all descendant generations */
  descendantGenerations: number | null
  /** Tree canvas zoom (1 = 100%). */
  treeZoom: number
  /**
   * Edit canvas scope:
   * - local: parents, children, siblings, mates around the focus
   * - all: full bloodline map
   */
  treeViewMode: TreeViewMode
  /**
   * When on and a dragon is selected: dim unrelated cards and emphasize
   * kinship edges of that dragon.
   */
  highlightKin: boolean
  /** Birth date display: DD.MM.YYYY or MM/DD/YYYY. */
  dateFormat: DateFormat
  /** Hide exalted dragons from the packed tree and free canvas. */
  hideExalted: boolean
}

export const MIN_TREE_ZOOM = 0.25
export const MAX_TREE_ZOOM = 2.5
export const DEFAULT_TREE_ZOOM = 1
export const DEFAULT_TREE_VIEW_MODE: TreeViewMode = 'local'
export const DEFAULT_HIGHLIGHT_KIN = false
export const DEFAULT_DATE_FORMAT: DateFormat = 'european'
export const DEFAULT_HIDE_EXALTED = false

const DEFAULT_SETTINGS: ViewSettings = {
  ancestorGenerations: null,
  descendantGenerations: null,
  treeZoom: DEFAULT_TREE_ZOOM,
  treeViewMode: DEFAULT_TREE_VIEW_MODE,
  highlightKin: DEFAULT_HIGHLIGHT_KIN,
  dateFormat: DEFAULT_DATE_FORMAT,
  hideExalted: DEFAULT_HIDE_EXALTED,
}

type Listener = () => void

let settings: ViewSettings = { ...DEFAULT_SETTINGS }
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

function persistViewSettings() {
  saveUiSession({
    viewFocusId: getViewFocusId(),
    selectedDragonId: getSelectedDragonId(),
    ancestorGenerations: settings.ancestorGenerations,
    descendantGenerations: settings.descendantGenerations,
    treeZoom: settings.treeZoom,
    treeViewMode: settings.treeViewMode,
    highlightKin: settings.highlightKin,
    dateFormat: settings.dateFormat,
    hideExalted: settings.hideExalted,
  })
}

export function subscribeViewSettings(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getViewSettings(): ViewSettings {
  return settings
}

export function setViewSettings(patch: Partial<ViewSettings>): void {
  settings = {
    ancestorGenerations:
      patch.ancestorGenerations !== undefined
        ? normalizeGenerationLimit(patch.ancestorGenerations)
        : settings.ancestorGenerations,
    descendantGenerations:
      patch.descendantGenerations !== undefined
        ? normalizeGenerationLimit(patch.descendantGenerations)
        : settings.descendantGenerations,
    treeZoom:
      patch.treeZoom !== undefined
        ? normalizeZoom(patch.treeZoom)
        : settings.treeZoom,
    treeViewMode:
      patch.treeViewMode !== undefined
        ? normalizeTreeViewMode(patch.treeViewMode)
        : settings.treeViewMode,
    highlightKin:
      patch.highlightKin !== undefined
        ? Boolean(patch.highlightKin)
        : settings.highlightKin,
    dateFormat:
      patch.dateFormat !== undefined
        ? normalizeDateFormat(patch.dateFormat)
        : settings.dateFormat,
    hideExalted:
      patch.hideExalted !== undefined
        ? Boolean(patch.hideExalted)
        : settings.hideExalted,
  }
  persistViewSettings()
  emit()
}

export function hydrateViewSettings(): void {
  const ui = loadUiSession()
  if (!ui) return
  settings = {
    ancestorGenerations: normalizeGenerationLimit(ui.ancestorGenerations ?? null),
    descendantGenerations: normalizeGenerationLimit(
      ui.descendantGenerations ?? null,
    ),
    treeZoom: normalizeZoom(ui.treeZoom ?? DEFAULT_TREE_ZOOM),
    treeViewMode: normalizeTreeViewMode(
      ui.treeViewMode ?? DEFAULT_TREE_VIEW_MODE,
    ),
    highlightKin:
      typeof ui.highlightKin === 'boolean'
        ? ui.highlightKin
        : DEFAULT_HIGHLIGHT_KIN,
    dateFormat: normalizeDateFormat(ui.dateFormat ?? DEFAULT_DATE_FORMAT),
    hideExalted:
      typeof ui.hideExalted === 'boolean'
        ? ui.hideExalted
        : DEFAULT_HIDE_EXALTED,
  }
  emit()
}

function normalizeGenerationLimit(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isFinite(value)) return null
  const n = Math.floor(value)
  if (n < 0) return null
  return n
}

export function normalizeZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TREE_ZOOM
  return Math.min(MAX_TREE_ZOOM, Math.max(MIN_TREE_ZOOM, value))
}

function normalizeTreeViewMode(value: TreeViewMode): TreeViewMode {
  return value === 'all' ? 'all' : 'local'
}

function normalizeDateFormat(value: DateFormat): DateFormat {
  return value === 'american' ? 'american' : 'european'
}

export function useViewSettings(): ViewSettings {
  return useSyncExternalStore(subscribeViewSettings, getViewSettings, getViewSettings)
}

/** Keep generation prefs when selection store rewrites the UI session. */
subscribeSelection(() => {
  persistViewSettings()
})
