import type { ProjectFile } from '../models'
import { migrateToCurrent, ProjectLoadError } from '../migrations/migrate'
import { validateProjectFile } from './validateProject'

export { ProjectLoadError }

/**
 * Parse unknown JSON into the current ProjectFile model.
 * Pipeline: parse → migrate → validate.
 */
export function loadProject(raw: unknown): ProjectFile {
  if (typeof raw === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ProjectLoadError('Project file is not valid JSON.')
    }
    return loadProject(parsed)
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProjectLoadError('Project file must be a JSON object.')
  }

  const migrated = migrateToCurrent(raw as Record<string, unknown>)
  return validateProjectFile(migrated)
}
