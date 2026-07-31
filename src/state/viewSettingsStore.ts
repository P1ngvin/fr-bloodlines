import { useSyncExternalStore } from 'react'
import { loadUiSession, saveUiSession } from '../storage/localStorage'
import {
  getSelectedDragonId,
  getViewFocusId,
  subscribeSelection,
} from './selectionStore'

export type ViewSettings = {
  /** null = show all ancestor generations */
  ancestorGenerations: number | null
  /** null = show all descendant generations */
  descendantGenerations: number | null
  /** Tree canvas zoom (1 = 100%). */
  treeZoom: number
}

export const MIN_TREE_ZOOM = 0.25
export const MAX_TREE_ZOOM = 2.5
export const DEFAULT_TREE_ZOOM = 1

const DEFAULT_SETTINGS: ViewSettings = {
  ancestorGenerations: null,
  descendantGenerations: null,
  treeZoom: DEFAULT_TREE_ZOOM,
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

export function useViewSettings(): ViewSettings {
  return useSyncExternalStore(subscribeViewSettings, getViewSettings, getViewSettings)
}

/** Keep generation prefs when selection store rewrites the UI session. */
subscribeSelection(() => {
  persistViewSettings()
})
