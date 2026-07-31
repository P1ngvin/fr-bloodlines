import type { Dragon, Project, ProjectFile } from '../models'
import { isDragonSex, isImageCropMode } from '../models'
import { ProjectLoadError } from '../migrations/migrate'
import { CURRENT_FORMAT_VERSION } from '../../version'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new ProjectLoadError(`Invalid project: ${label} must be a string.`)
  }
  return value
}

function assertParentId(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new ProjectLoadError(`Invalid project: ${label} must be a string or null.`)
}

function assertCoord(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new ProjectLoadError(`Invalid project: ${label} must be a number or null.`)
}

function validateCustomFields(
  value: unknown,
  dragonId: string,
): Dragon['customFields'] {
  if (!isPlainObject(value)) {
    throw new ProjectLoadError(
      `Invalid project: dragon "${dragonId}" customFields must be an object.`,
    )
  }

  const fields: Dragon['customFields'] = {}
  for (const [key, fieldValue] of Object.entries(value)) {
    if (
      typeof fieldValue !== 'string' &&
      typeof fieldValue !== 'number' &&
      typeof fieldValue !== 'boolean'
    ) {
      throw new ProjectLoadError(
        `Invalid project: customFields.${key} on dragon "${dragonId}" has an unsupported type.`,
      )
    }
    fields[key] = fieldValue
  }
  return fields
}

function validateDragon(value: unknown, expectedId: string): Dragon {
  if (!isPlainObject(value)) {
    throw new ProjectLoadError(`Invalid project: dragon "${expectedId}" is not an object.`)
  }

  const id = assertString(value.id, `dragon "${expectedId}" id`)
  if (id !== expectedId) {
    throw new ProjectLoadError(
      `Invalid project: dragon key "${expectedId}" does not match id "${id}".`,
    )
  }

  const imageCrop = value.imageCrop
  if (!isImageCropMode(imageCrop)) {
    throw new ProjectLoadError(
      `Invalid project: dragon "${id}" has an unknown imageCrop.`,
    )
  }

  const sex = value.sex
  if (!isDragonSex(sex)) {
    throw new ProjectLoadError(
      `Invalid project: dragon "${id}" has an unknown sex.`,
    )
  }

  return {
    id,
    name: assertString(value.name, `dragon "${id}" name`),
    frId: assertString(value.frId, `dragon "${id}" frId`),
    sex,
    imageCrop,
    frameId: assertString(value.frameId, `dragon "${id}" frameId`),
    motherId: assertParentId(value.motherId, `dragon "${id}" motherId`),
    fatherId: assertParentId(value.fatherId, `dragon "${id}" fatherId`),
    siblingGroupId: assertParentId(
      value.siblingGroupId,
      `dragon "${id}" siblingGroupId`,
    ),
    posX: assertCoord(value.posX, `dragon "${id}" posX`),
    posY: assertCoord(value.posY, `dragon "${id}" posY`),
    notes: assertString(value.notes, `dragon "${id}" notes`),
    customFields: validateCustomFields(value.customFields, id),
  }
}

function validateProject(value: unknown): Project {
  if (!isPlainObject(value)) {
    throw new ProjectLoadError('Invalid project: missing project object.')
  }

  const id = assertString(value.id, 'project.id')
  const name = assertString(value.name, 'project.name')

  if (!isPlainObject(value.dragons)) {
    throw new ProjectLoadError('Invalid project: dragons must be an object.')
  }

  const dragons: Record<string, Dragon> = {}
  for (const [key, dragonValue] of Object.entries(value.dragons)) {
    dragons[key] = validateDragon(dragonValue, key)
  }

  for (const dragon of Object.values(dragons)) {
    if (dragon.motherId !== null && !(dragon.motherId in dragons)) {
      throw new ProjectLoadError(
        `Invalid project: dragon "${dragon.id}" references missing mother "${dragon.motherId}".`,
      )
    }
    if (dragon.fatherId !== null && !(dragon.fatherId in dragons)) {
      throw new ProjectLoadError(
        `Invalid project: dragon "${dragon.id}" references missing father "${dragon.fatherId}".`,
      )
    }
  }

  return { id, name, dragons }
}

/** Validate a migrated envelope as the current ProjectFile model. */
export function validateProjectFile(document: Record<string, unknown>): ProjectFile {
  if (document.formatVersion !== CURRENT_FORMAT_VERSION) {
    throw new ProjectLoadError(
      `Internal error: expected format ${CURRENT_FORMAT_VERSION} after migration.`,
    )
  }

  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    createdWith: assertString(document.createdWith, 'createdWith'),
    updatedWith: assertString(document.updatedWith, 'updatedWith'),
    project: validateProject(document.project),
  }
}
