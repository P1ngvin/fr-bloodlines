import type { FrDragonPage, FrDragonRef } from './types'

export class FrDragonPageParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrDragonPageParseError'
  }
}

/** Decode a user-downloaded FR dragon page (.mhtml / .html) into structured data. */
export function parseFrDragonPage(text: string): FrDragonPage {
  const html = extractHtmlDocument(text)
  if (!html) {
    throw new FrDragonPageParseError('Could not read HTML from that file.')
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const frId = readFrId(doc, text)
  if (!frId) {
    throw new FrDragonPageParseError(
      'Not a Flight Rising dragon page - no dragon id found.',
    )
  }

  const name = readName(doc) || `Dragon ${frId}`
  const sex = readSex(doc)
  // Living profile vs exalted memorial page use different markup.
  const parents =
    readDragonLinks(doc, 'ul.dragon-profile-lineage-parents') ||
    readExaltedLineageSection(doc, 'Parents')
  const offspring =
    readDragonLinks(doc, 'ul.dragon-profile-lineage-offspring') ||
    readExaltedLineageSection(doc, 'Offspring')

  return {
    frId,
    name,
    sex,
    father: parents[0] ?? null,
    mother: parents[1] ?? null,
    offspring,
  }
}

function extractHtmlDocument(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return trimmed
  }

  // Chrome / Edge "Webpage, Single File" (.mhtml)
  if (
    /Content-Type:\s*multipart\/related/i.test(trimmed) ||
    /Snapshot-Content-Location:/i.test(trimmed) ||
    /MultipartBoundary/i.test(trimmed)
  ) {
    return extractMhtmlHtml(trimmed)
  }

  // Loose HTML without doctype
  if (looksLikeFrDragonHtml(trimmed)) {
    return trimmed
  }

  return null
}

function extractMhtmlHtml(mhtml: string): string | null {
  const parts = mhtml.split(/------MultipartBoundary[^\n]*/i)
  for (const part of parts) {
    if (!/Content-Type:\s*text\/html/i.test(part)) continue
    const headerEnd = part.search(/\r?\n\r?\n/)
    if (headerEnd < 0) continue
    const headers = part.slice(0, headerEnd)
    let body = part.slice(headerEnd).replace(/^\r?\n/, '')
    // Drop trailing boundary junk
    body = body.replace(/\r?\n------MultipartBoundary[\s\S]*$/i, '')

    if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) {
      body = decodeQuotedPrintable(body)
    } else if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) {
      try {
        body = atob(body.replace(/\s+/g, ''))
      } catch {
        continue
      }
    } else if (/=\r?\n|=3D/.test(body)) {
      // Chrome often omits the CTE header but still QP-encodes HTML.
      body = decodeQuotedPrintable(body)
    }

    if (looksLikeFrDragonHtml(body)) {
      return body.trim()
    }
  }

  // Fallback: whole file looks QP-encoded HTML
  if (/=\r?\n|=3D/.test(mhtml) && looksLikeFrDragonHtml(mhtml)) {
    const decoded = decodeQuotedPrintable(mhtml)
    const start = decoded.search(/<!DOCTYPE\s+html|<html[\s>]/i)
    if (start >= 0) return decoded.slice(start)
  }

  return null
}

function looksLikeFrDragonHtml(text: string): boolean {
  return (
    /<html[\s>]/i.test(text) ||
    /dragon-profile/i.test(text) ||
    /exalted-lineage/i.test(text) ||
    /exalted-content/i.test(text)
  )
}

function decodeQuotedPrintable(text: string): string {
  const soft = text.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(soft.charCodeAt(i) & 0xff)
    }
  }
  try {
    return new TextDecoder('utf-8').decode(Uint8Array.from(bytes))
  } catch {
    return String.fromCharCode(...bytes)
  }
}

function readFrId(doc: Document, rawText: string): string | null {
  const header = doc.querySelector('.dragon-profile-header-number')
  if (header) {
    const fromHeader = digitsOnly(header.textContent ?? '')
    if (fromHeader) return fromHeader
  }

  const og = doc.querySelector('meta[property="og:url"]')?.getAttribute('content')
  const fromOg = frIdFromUrl(og)
  if (fromOg) return fromOg

  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
  const fromCanon = frIdFromUrl(canonical)
  if (fromCanon) return fromCanon

  const snap = rawText.match(
    /Snapshot-Content-Location:\s*https?:\/\/[^/\s]+\/dragon\/(\d+)/i,
  )
  if (snap?.[1]) return snap[1]

  const any = rawText.match(/flightrising\.com\/dragon\/(\d+)/i)
  return any?.[1] ?? null
}

function readName(doc: Document): string {
  const title = doc.querySelector(
    '#dragon-profile-header h1, .responsive-page-header-title, h1.content-header, #main-content.content-header',
  )
  if (title) {
    const clone = title.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.dragon-profile-header-number').forEach((n) => n.remove())
    const name = normalizeName(clone.textContent ?? '')
    if (name) return name
  }

  const crumb = doc.querySelector('.theme-breadcrumb-active')
  return normalizeName(crumb?.textContent ?? '')
}

function readSex(doc: Document): FrDragonPage['sex'] {
  // Check "female" before "male" - "female" contains the substring "male".
  const tooltip = (
    doc.querySelector('#dragon-profile-icon-sex-tooltip')?.textContent ?? ''
  ).toLowerCase()
  if (tooltip.includes('female')) return 'female'
  if (/\bmale\b/.test(tooltip)) return 'male'

  const img = doc.querySelector(
    'img[src*="/lair/icons/female.png"], img[src*="/lair/icons/male.png"]',
  )
  const src = (img?.getAttribute('src') ?? '').toLowerCase()
  const alt = (img?.getAttribute('alt') ?? '').toLowerCase()
  if (src.includes('female') || alt.includes('female')) return 'female'
  if (src.includes('male') || /\bmale\b/.test(alt)) return 'male'

  // Exalted memorial pages expose FR's numeric gender on the render image.
  // 0 = male, 1 = female.
  const exaltedGender = doc
    .querySelector('img.exalted-image[data-gender]')
    ?.getAttribute('data-gender')
  if (exaltedGender === '0') return 'male'
  if (exaltedGender === '1') return 'female'

  return 'unknown'
}

/** Empty array is falsy for `||` fallback via nullish helper below. */
function readDragonLinks(
  doc: Document,
  selector: string,
): FrDragonRef[] | null {
  const list = doc.querySelector(selector)
  if (!list) return null
  const refs = collectDragonLinks(list)
  return refs.length > 0 ? refs : null
}

/** Exalted pages: heading "Parents" / "Offspring" then `ul.exalted-lineage-list`. */
function readExaltedLineageSection(
  doc: Document,
  heading: string,
): FrDragonRef[] {
  const want = heading.toLowerCase()
  for (const header of doc.querySelectorAll('h2.exalted-lineage-header')) {
    if (normalizeName(header.textContent ?? '').toLowerCase() !== want) {
      continue
    }
    let sibling: Element | null = header.nextElementSibling
    while (sibling && sibling.tagName !== 'UL') {
      sibling = sibling.nextElementSibling
    }
    if (sibling) return collectDragonLinks(sibling)
  }
  return []
}

function collectDragonLinks(list: Element): FrDragonRef[] {
  const refs: FrDragonRef[] = []
  const seen = new Set<string>()
  for (const anchor of list.querySelectorAll('a[href*="/dragon/"]')) {
    const frId = frIdFromUrl(anchor.getAttribute('href'))
    if (!frId || seen.has(frId)) continue
    seen.add(frId)
    const name = normalizeName(anchor.textContent ?? '') || `Dragon ${frId}`
    refs.push({ frId, name })
  }
  return refs
}

function frIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/\/dragon\/(\d+)/i)
  return match?.[1] ?? null
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '')
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
