import { CURRENT_FORMAT_VERSION } from '../../version'
import { MIGRATIONS } from './registry'

export class ProjectLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectLoadError'
  }
}

/**
 * Run every migration from `formatVersion` up to CURRENT_FORMAT_VERSION.
 * Returns the migrated envelope (still unvalidated).
 */
export function migrateToCurrent(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const rawVersion = document.formatVersion
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
    throw new ProjectLoadError('Project file is missing a valid formatVersion.')
  }

  if (rawVersion > CURRENT_FORMAT_VERSION) {
    throw new ProjectLoadError(
      `This project was saved with format ${rawVersion}, which is newer than ` +
        `what this app supports (${CURRENT_FORMAT_VERSION}). Update Bloodlines to open it.`,
    )
  }

  let current = document
  let version = rawVersion

  while (version < CURRENT_FORMAT_VERSION) {
    const migration = MIGRATIONS.find((entry) => entry.from === version)
    if (!migration) {
      throw new ProjectLoadError(
        `No migration path from format ${version} to ${CURRENT_FORMAT_VERSION}.`,
      )
    }
    current = migration.migrate(current)
    version = migration.to
    current = { ...current, formatVersion: version }
  }

  return current
}
