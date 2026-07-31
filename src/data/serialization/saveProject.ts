import type { Project, ProjectFile } from '../models'
import { APP_VERSION, CURRENT_FORMAT_VERSION } from '../../version'

/** Always write the newest format version. */
export function toProjectFile(
  project: Project,
  meta: { createdWith: string },
): ProjectFile {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    createdWith: meta.createdWith,
    updatedWith: APP_VERSION,
    project,
  }
}

export function serializeProjectFile(file: ProjectFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}
