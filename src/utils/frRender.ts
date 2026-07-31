/**
 * Flight Rising dragon id helpers.
 * The app never scrapes FR — users type the id; we only build the render URL.
 */

const RENDER_HOST = 'https://www1.flightrising.com/rendern'
const DEFAULT_SIZE = 350

/** Keep digits only (users may paste ids with spaces). */
export function normalizeFrId(raw: string): string {
  return raw.trim().replace(/\D/g, '')
}

export function isValidFrId(frId: string): boolean {
  return /^\d+$/.test(frId)
}

/**
 * FR stores renders in numbered folders:
 * folder = ceil(dragonId / 100)
 *
 * Example: id 22389889 →
 * https://www1.flightrising.com/rendern/350/223899/22389889_350.png
 */
export function getFrRenderFolder(frId: string): string {
  const id = Number(normalizeFrId(frId))
  if (!Number.isFinite(id) || id <= 0) return ''
  return String(Math.ceil(id / 100))
}

export function getDragonRenderUrl(
  frId: string,
  size: number = DEFAULT_SIZE,
): string {
  const id = normalizeFrId(frId)
  const folder = getFrRenderFolder(id)
  if (!id || !folder) return ''
  return `${RENDER_HOST}/${size}/${folder}/${id}_${size}.png`
}

/** Best-effort extract an FR id from a pasted render URL or raw digits. */
export function extractFrIdFromRenderUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  if (/^\d+$/.test(trimmed)) return trimmed

  const withExt = trimmed.match(/\/rendern\/\d+\/\d+\/(\d+)_\d+\.(?:png|jpe?g)/i)
  if (withExt?.[1]) return withExt[1]

  const bare = trimmed.match(/\/rendern\/\d+\/\d+\/(\d+)\/?$/i)
  if (bare?.[1]) return bare[1]

  const loose = trimmed.match(/\/(\d+)_\d+\.(?:png|jpe?g)/i)
  return loose?.[1] ?? ''
}
