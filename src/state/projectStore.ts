import { useSyncExternalStore } from 'react'
import {
  countDragons,
  createNewProjectFile,
  type Dragon,
  type Project,
  type ProjectFile,
} from '../data/models'
import { toProjectFile } from '../data/serialization/saveProject'
import {
  loadProjectFromLocalStorage,
  loadUiSession,
  saveProjectToLocalStorage,
  saveUiSession,
} from '../storage/localStorage'
import {
  addDragon,
  createChildOf,
  createFatherFor,
  createMotherFor,
  linkAsChild,
  linkAsParent,
  linkAsSiblings,
  removeDragon,
  setFather,
  setMother,
  updateDragonFields,
  type RelationResult,
} from '../tree'
import { normalizeDisplayName } from '../utils/text'
import {
  getSelectedDragonId,
  getViewFocusId,
  restoreSelectionState,
} from './selectionStore'
import { getViewSettings } from './viewSettingsStore'

type Listener = () => void

let projectFile: ProjectFile = createNewProjectFile()
let lastPersistOk = true
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

function persist() {
  lastPersistOk = saveProjectToLocalStorage(projectFile)
  const view = getViewSettings()
  saveUiSession({
    viewFocusId: getViewFocusId(),
    selectedDragonId: getSelectedDragonId(),
    ancestorGenerations: view.ancestorGenerations,
    descendantGenerations: view.descendantGenerations,
    treeZoom: view.treeZoom,
    treeViewMode: view.treeViewMode,
    highlightKin: view.highlightKin,
    dateFormat: view.dateFormat,
    hideExalted: view.hideExalted,
  })
}

function replaceProjectFile(next: ProjectFile, options?: { persist?: boolean }) {
  projectFile = next
  if (options?.persist !== false) persist()
  emit()
}

function applyRelation(result: RelationResult): RelationResult {
  if (result.ok) {
    replaceProjectFile(
      toProjectFile(result.project, { createdWith: projectFile.createdWith }),
    )
  }
  return result
}

export function subscribeProject(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getProjectFile(): ProjectFile {
  return projectFile
}

export function getProject(): Project {
  return projectFile.project
}

export function wasLastPersistSuccessful(): boolean {
  return lastPersistOk
}

/** Load autosaved project if present. Returns true when a project was restored. */
export function hydrateProjectFromStorage(): boolean {
  const stored = loadProjectFromLocalStorage()
  if (!stored) return false

  replaceProjectFile(stored, { persist: false })

  const ui = loadUiSession()
  if (ui) {
    restoreSelectionState(ui.selectedDragonId, ui.viewFocusId, stored.project)
  }

  // Keep LocalStorage on the newest format after migrate.
  persist()
  return true
}

export function newProject(name = 'Untitled'): void {
  replaceProjectFile(createNewProjectFile(normalizeDisplayName(name, 'Untitled')))
}

export function openProjectFile(file: ProjectFile): void {
  replaceProjectFile(file)
}

export function updateProject(updater: (project: Project) => Project): void {
  const nextProject = updater(projectFile.project)
  replaceProjectFile(
    toProjectFile(nextProject, { createdWith: projectFile.createdWith }),
  )
}

export function renameProject(name: string): void {
  updateProject((project) => ({
    ...project,
    name: normalizeDisplayName(name, 'Untitled'),
  }))
}

export function projectHasContent(): boolean {
  return countDragons(projectFile.project) > 0 || projectFile.project.name !== 'Untitled'
}

export function createDragonInProject(
  draft?: Parameters<typeof addDragon>[1],
): RelationResult {
  return applyRelation(addDragon(projectFile.project, draft))
}

export function patchDragon(
  dragonId: string,
  patch: Partial<Omit<Dragon, 'id' | 'motherId' | 'fatherId'>>,
): RelationResult {
  return applyRelation(updateDragonFields(projectFile.project, dragonId, patch))
}

export function assignMother(childId: string, motherId: string | null): RelationResult {
  return applyRelation(setMother(projectFile.project, childId, motherId))
}

export function assignFather(childId: string, fatherId: string | null): RelationResult {
  return applyRelation(setFather(projectFile.project, childId, fatherId))
}

export function addMotherTo(childId: string): RelationResult {
  return applyRelation(createMotherFor(projectFile.project, childId))
}

export function addFatherTo(childId: string): RelationResult {
  return applyRelation(createFatherFor(projectFile.project, childId))
}

export function addChildOf(parentId: string): RelationResult {
  return applyRelation(createChildOf(projectFile.project, parentId))
}

export function linkDragonAsParent(
  parentId: string,
  childId: string,
): RelationResult {
  return applyRelation(linkAsParent(projectFile.project, parentId, childId))
}

export function linkDragonAsChild(
  childId: string,
  parentId: string,
): RelationResult {
  return applyRelation(linkAsChild(projectFile.project, childId, parentId))
}

export function linkDragonsAsSiblings(
  aId: string,
  bId: string,
): RelationResult {
  return applyRelation(linkAsSiblings(projectFile.project, aId, bId))
}

export function deleteDragon(dragonId: string): RelationResult {
  return applyRelation(removeDragon(projectFile.project, dragonId))
}

export function replaceProject(project: Project): void {
  replaceProjectFile(
    toProjectFile(project, { createdWith: projectFile.createdWith }),
  )
}

export function useProjectFile(): ProjectFile {
  return useSyncExternalStore(subscribeProject, getProjectFile, getProjectFile)
}

export function useProject(): Project {
  return useSyncExternalStore(subscribeProject, getProject, getProject)
}
