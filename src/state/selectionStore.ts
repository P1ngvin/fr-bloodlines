import { useSyncExternalStore } from 'react'
import type { Project } from '../data/models'
import { isUnlinkedIsolate } from '../tree/buildStableTree'

type Listener = () => void

/** Dragon shown in the edit panel. Always set when the project has dragons. */
let selectedDragonId: string | null = null
/** Last linked dragon the tree is focused on (generation limits / layout). */
let viewFocusId: string | null = null

const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

function pickLinkedFocus(project: Project, preferred?: string | null): string | null {
  const ids = Object.keys(project.dragons).sort((a, b) => a.localeCompare(b))
  if (ids.length === 0) return null
  if (
    preferred &&
    project.dragons[preferred] &&
    !isUnlinkedIsolate(project, preferred)
  ) {
    return preferred
  }
  for (const id of ids) {
    if (!isUnlinkedIsolate(project, id)) return id
  }
  return preferred && project.dragons[preferred] ? preferred : ids[0]!
}

export function subscribeSelection(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSelectedDragonId(): string | null {
  return selectedDragonId
}

export function getViewFocusId(): string | null {
  return viewFocusId
}

/**
 * Select a dragon for the edit panel.
 * Tree focus only follows dragons that are linked into the bloodline.
 */
export function selectDragon(id: string | null, project?: Project | null): void {
  let changed = false
  if (selectedDragonId !== id) {
    selectedDragonId = id
    changed = true
  }
  if (id !== null && project && !isUnlinkedIsolate(project, id)) {
    if (viewFocusId !== id) {
      viewFocusId = id
      changed = true
    }
  } else if (id !== null && !project && viewFocusId !== id) {
    viewFocusId = id
    changed = true
  }
  if (changed) emit()
}

export function clearSelection(): void {
  if (selectedDragonId === null) return
  selectedDragonId = null
  emit()
}

export function setViewFocus(id: string | null): void {
  if (viewFocusId === id) return
  viewFocusId = id
  emit()
}

/** Restore focus/selection from a previous browser session. */
export function restoreSelectionState(
  selectedId: string | null,
  focusId: string | null,
  project: Project,
): void {
  const ids = Object.keys(project.dragons)
  const fallback = ids.length > 0 ? [...ids].sort((a, b) => a.localeCompare(b))[0]! : null
  selectedDragonId =
    selectedId !== null && selectedId in project.dragons ? selectedId : fallback
  viewFocusId = pickLinkedFocus(
    project,
    focusId !== null && focusId in project.dragons ? focusId : selectedDragonId,
  )
  emit()
}

/**
 * Drop selection / focus if those dragons no longer exist.
 * When any dragons remain, keep one selected; tree focus prefers a linked dragon.
 */
export function ensureSelectionValid(project: Project): void {
  const ids = Object.keys(project.dragons)
  let changed = false

  if (selectedDragonId !== null && !(selectedDragonId in project.dragons)) {
    selectedDragonId = null
    changed = true
  }
  if (viewFocusId !== null && !(viewFocusId in project.dragons)) {
    viewFocusId = null
    changed = true
  }

  if (ids.length === 0) {
    if (selectedDragonId !== null || viewFocusId !== null) {
      selectedDragonId = null
      viewFocusId = null
      changed = true
    }
    if (changed) emit()
    return
  }

  const fallback = [...ids].sort((a, b) => a.localeCompare(b))[0]!

  if (selectedDragonId === null) {
    selectedDragonId = viewFocusId ?? fallback
    changed = true
  }

  const nextFocus = pickLinkedFocus(project, viewFocusId ?? selectedDragonId)
  if (viewFocusId !== nextFocus) {
    viewFocusId = nextFocus
    changed = true
  }

  if (changed) emit()
}

export function useSelectedDragonId(): string | null {
  return useSyncExternalStore(
    subscribeSelection,
    getSelectedDragonId,
    getSelectedDragonId,
  )
}

export function useViewFocusId(): string | null {
  return useSyncExternalStore(subscribeSelection, getViewFocusId, getViewFocusId)
}
