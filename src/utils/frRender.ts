/**
 * Flight Rising dragon id helpers.
 * The app never scrapes FR. Users type the id or import a page they downloaded;
 * we only build the render URL from the id.
 */

const SITE_HOST = 'https://www1.flightrising.com'
const RENDER_HOST = `${SITE_HOST}/rendern`
const DEFAULT_SIZE = 350

type RenderCrop = 'full' | 'portrait'

/** Keep digits only (users may paste ids with spaces). */
export function normalizeFrId(raw: string): string {
  return raw.trim().replace(/\D/g, '')
}

export function isValidFrId(frId: string): boolean {
  return /^\d+$/.test(frId)
}

/** Profile URL for a dragon id, or empty when the id is missing/invalid. */
export function getDragonPageUrl(frId: string): string {
  const id = normalizeFrId(frId)
  if (!isValidFrId(id)) return ''
  return `${SITE_HOST}/dragon/${id}`
}

/**
 * FR stores renders in numbered folders of 100 ids:
 * folder = floor(dragonId / 100) + 1
 * (IDs 1-99 → 1, 100-199 → 2, …; multiples of 100 go in the next folder.)
 *
 * Full:     .../rendern/350/223899/22389889_350.png
 * Portrait: .../rendern/portraits/505122/50512147p.png
 */
export function getFrRenderFolder(frId: string): string {
  const id = Number(normalizeFrId(frId))
  if (!Number.isFinite(id) || id <= 0) return ''
  return String(Math.floor(id / 100) + 1)
}

export function getDragonRenderUrl(
  frId: string,
  crop: RenderCrop = 'portrait',
  size: number = DEFAULT_SIZE,
): string {
  const id = normalizeFrId(frId)
  const folder = getFrRenderFolder(id)
  if (!id || !folder) return ''
  if (crop === 'portrait') {
    return `${RENDER_HOST}/portraits/${folder}/${id}p.png`
  }
  return `${RENDER_HOST}/${size}/${folder}/${id}_${size}.png`
}

/** Best-effort extract an FR id from a pasted render URL or raw digits. */
export function extractFrIdFromRenderUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  if (/^\d+$/.test(trimmed)) return trimmed

  const portrait = trimmed.match(
    /\/rendern\/portraits\/\d+\/(\d+)p\.(?:png|jpe?g)/i,
  )
  if (portrait?.[1]) return portrait[1]

  const withExt = trimmed.match(/\/rendern\/\d+\/\d+\/(\d+)_\d+\.(?:png|jpe?g)/i)
  if (withExt?.[1]) return withExt[1]

  const bare = trimmed.match(/\/rendern\/\d+\/\d+\/(\d+)\/?$/i)
  if (bare?.[1]) return bare[1]

  const loose = trimmed.match(/\/(\d+)_\d+\.(?:png|jpe?g)/i)
  return loose?.[1] ?? ''
}
