/**
 * How the UI picks a Flight Rising render for display.
 * Exporters must not process pixels — they may only read this as a hint.
 */
export type ImageCropMode = 'full' | 'portrait'

export const IMAGE_CROP_MODES: readonly ImageCropMode[] = [
  'full',
  'portrait',
] as const

export function isImageCropMode(value: unknown): value is ImageCropMode {
  return value === 'full' || value === 'portrait'
}
