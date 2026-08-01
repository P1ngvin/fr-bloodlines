import { getDragonRenderUrl } from '../../utils/frRender'

/**
 * Dominant portrait color for LOD dots.
 * Cached by FR id; at most a few tiny decodes in flight. Falls back to a
 * stable hash color when the image is missing or canvas is CORS-tainted.
 *
 * Subscribers are per-frId so finishing one sample does not re-render the
 * whole 800-node map.
 */

const cache = new Map<string, string>()
const inflight = new Set<string>()
const queue: string[] = []
const listenersById = new Map<string, Set<() => void>>()

const MAX_INFLIGHT = 3
const SAMPLE = 10
const FALLBACK = 'color-mix(in srgb, var(--ink) 42%, var(--paper))'

function emit(frId: string) {
  const set = listenersById.get(frId)
  if (!set) return
  for (const listener of set) listener()
}

export function subscribeDragonDotColor(
  frId: string,
  listener: () => void,
): () => void {
  if (!frId) return () => {}
  let set = listenersById.get(frId)
  if (!set) {
    set = new Set()
    listenersById.set(frId, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listenersById.delete(frId)
  }
}

export function getDragonDotColor(frId: string): string {
  if (!frId) return FALLBACK
  return cache.get(frId) ?? FALLBACK
}

/** Queue a cheap sample when LOD is `dot`. No-op if already cached/queued. */
export function ensureDragonDotColor(frId: string): void {
  if (!frId || cache.has(frId) || inflight.has(frId) || queue.includes(frId)) {
    return
  }
  queue.push(frId)
  pump()
}

function pump() {
  while (inflight.size < MAX_INFLIGHT && queue.length > 0) {
    const frId = queue.shift()!
    void sample(frId)
  }
}

function colorFromFrId(frId: string): string {
  let h = 2166136261
  for (let i = 0; i < frId.length; i++) {
    h ^= frId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hue = (h >>> 0) % 360
  const sat = 42 + ((h >>> 8) % 28)
  const light = 40 + ((h >>> 16) % 14)
  return `hsl(${hue} ${sat}% ${light}%)`
}

function finish(frId: string, color: string) {
  cache.set(frId, color)
  inflight.delete(frId)
  emit(frId)
  pump()
}

async function sample(frId: string) {
  inflight.add(frId)
  const url = getDragonRenderUrl(frId, 'portrait')
  if (!url) {
    finish(frId, colorFromFrId(frId))
    return
  }

  try {
    const img = await loadImage(url)
    const color = averageColor(img) ?? colorFromFrId(frId)
    finish(frId, color)
  } catch {
    // CORS / network: stable stand-in, still readable on the map.
    finish(frId, colorFromFrId(frId))
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = url
  })
}

function averageColor(img: HTMLImageElement): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  try {
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
    let r = 0
    let g = 0
    let b = 0
    let n = 0

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!
      if (a < 40) continue
      const pr = data[i]!
      const pg = data[i + 1]!
      const pb = data[i + 2]!
      // Skip near-white / near-black framing so the dragon body wins.
      if (pr > 245 && pg > 245 && pb > 245) continue
      if (pr < 12 && pg < 12 && pb < 12) continue
      r += pr
      g += pg
      b += pb
      n += 1
    }

    if (n === 0) return null
    r = Math.round(r / n)
    g = Math.round(g / n)
    b = Math.round(b / n)
    return `rgb(${r} ${g} ${b})`
  } catch {
    return null
  }
}
