import { createId } from '../../utils/id'
import { normalizeDisplayName } from '../../utils/text'
import type { ImageCropMode } from './imageCrop'
import type { DragonSex } from './sex'

/** Built-in frame until the frames registry lands (Stage 5). */
export const DEFAULT_FRAME_ID = 'default'

export type CustomFieldValue = string | number | boolean

/**
 * Current (in-app) dragon model.
 * Add typed core fields via migrations; put user-defined extras in customFields.
 */
export type Dragon = {
  id: string
  name: string
  /**
   * Flight Rising dragon id (digits).
   * Render URL is derived - never stored.
   */
  frId: string
  sex: DragonSex
  imageCrop: ImageCropMode
  frameId: string
  motherId: string | null
  fatherId: string | null
  /**
   * Shared id for explicit siblings (including without known parents).
   * Same non-null value = siblings.
   */
  siblingGroupId: string | null
  /**
   * Free canvas position (unscaled board px, top-left) for unlinked dragons.
   * Ignored once the dragon is in the packed bloodline layout.
   */
  posX: number | null
  posY: number | null
  notes: string
  customFields: Record<string, CustomFieldValue>
}

export type DragonDraft = Partial<Omit<Dragon, 'id'>> & { id?: string }

export function createDragon(draft: DragonDraft = {}): Dragon {
  return {
    id: draft.id ?? createId(),
    name: normalizeDisplayName(draft.name ?? 'Unnamed'),
    frId: draft.frId ?? '',
    sex: draft.sex ?? 'female',
    imageCrop: draft.imageCrop ?? 'portrait',
    frameId: draft.frameId ?? DEFAULT_FRAME_ID,
    motherId: draft.motherId ?? null,
    fatherId: draft.fatherId ?? null,
    siblingGroupId: draft.siblingGroupId ?? null,
    posX: draft.posX ?? null,
    posY: draft.posY ?? null,
    notes: draft.notes ?? '',
    customFields: draft.customFields ?? {},
  }
}
