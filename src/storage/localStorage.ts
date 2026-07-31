import type { ProjectFile } from '../data/models'
import { loadProject, ProjectLoadError } from '../data/serialization/loadProject'
import {
  serializeProjectFile,
  toProjectFile,
} from '../data/serialization/saveProject'

export const LOCAL_STORAGE_KEY = 'bloodlines:current-project'
export const UI_SESSION_KEY = 'bloodlines:ui-session'

export type UiSession = {
  viewFocusId: string | null
  selectedDragonId: string | null
  ancestorGenerations?: number | null
  descendantGenerations?: number | null
  treeZoom?: number
}

export function saveProjectToLocalStorage(file: ProjectFile): boolean {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, serializeProjectFile(file))
    return true
  } catch {
    // Quota / private mode — download JSON remains the backup path.
    return false
  }
}

export function loadProjectFromLocalStorage(): ProjectFile | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(LOCAL_STORAGE_KEY)
  } catch {
    return null
  }

  if (!raw) return null

  try {
    const loaded = loadProject(raw)
    // Write back so migrations stick and the newest format is what we keep.
    saveProjectToLocalStorage(
      toProjectFile(loaded.project, { createdWith: loaded.createdWith }),
    )
    return loaded
  } catch (error) {
    if (error instanceof ProjectLoadError) {
      console.warn('Ignored invalid LocalStorage project:', error.message)
      return null
    }
    throw error
  }
}

export function clearProjectLocalStorage(): void {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function saveUiSession(session: UiSession): void {
  try {
    localStorage.setItem(UI_SESSION_KEY, JSON.stringify(session))
  } catch {
    // ignore
  }
}

function readGenerationLimit(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  return undefined
}

export function loadUiSession(): UiSession | null {
  try {
    const raw = localStorage.getItem(UI_SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    return {
      viewFocusId:
        typeof record.viewFocusId === 'string' || record.viewFocusId === null
          ? (record.viewFocusId as string | null)
          : null,
      selectedDragonId:
        typeof record.selectedDragonId === 'string' ||
        record.selectedDragonId === null
          ? (record.selectedDragonId as string | null)
          : null,
      ancestorGenerations: readGenerationLimit(record.ancestorGenerations),
      descendantGenerations: readGenerationLimit(record.descendantGenerations),
      treeZoom:
        typeof record.treeZoom === 'number' && Number.isFinite(record.treeZoom)
          ? record.treeZoom
          : undefined,
    }
  } catch {
    return null
  }
}
