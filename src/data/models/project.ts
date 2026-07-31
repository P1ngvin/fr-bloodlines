import { createId } from '../../utils/id'
import { normalizeDisplayName } from '../../utils/text'
import { APP_VERSION, CURRENT_FORMAT_VERSION } from '../../version'
import type { Dragon } from './dragon'

export type Project = {
  id: string
  name: string
  dragons: Record<string, Dragon>
}

/**
 * On-disk / LocalStorage envelope.
 * After load+migrate, `project` always matches the current in-app model.
 */
export type ProjectFile = {
  formatVersion: number
  createdWith: string
  updatedWith: string
  project: Project
}

export function createEmptyProject(name = 'Untitled'): Project {
  return {
    id: createId(),
    name: normalizeDisplayName(name, 'Untitled'),
    dragons: {},
  }
}

export function createNewProjectFile(name = 'Untitled'): ProjectFile {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    createdWith: APP_VERSION,
    updatedWith: APP_VERSION,
    project: createEmptyProject(name),
  }
}

export function countDragons(project: Project): number {
  return Object.keys(project.dragons).length
}
