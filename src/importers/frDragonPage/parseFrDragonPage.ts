import {
  parseElementFromEyeTypeText,
  parseFrHatchday,
  type DragonElement,
} from '../../data/models'
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
  const birthDate = readBirthDate(doc)
  const exalted = isExaltedDragonPage(doc, text)
  const element = readElement(doc, text)
  // Living profile vs exalted memorial page use different markup.
  const parents = readParents(doc)
  const offspring =
    readDragonLinks(doc, 'ul.dragon-profile-lineage-offspring') ??
    readExaltedLineageSection(doc, 'Offspring')

  return {
    frId,
    name,
    sex,
    birthDate,
    father: parents.father,
    mother: parents.mother,
    parentsNone: parents.parentsNone,
    exalted,
    element,
    offspring,
  }
}

/** Memorial / exalted-to-deity pages use distinct markup and copy. */
function isExaltedDragonPage(doc: Document, rawText: string): boolean {
  if (doc.querySelector('.exalted-content, img.exalted-image, .exalted-lineage')) {
    return true
  }
  if (doc.querySelector('h2.exalted-lineage-header')) return true
  return /was exalted to the ranks/i.test(rawText)
}

type ParentsParse = {
  father: FrDragonRef | null
  mother: FrDragonRef | null
  parentsNone: boolean
}

function readParents(doc: Document): ParentsParse {
  const living = doc.querySelector('ul.dragon-profile-lineage-parents')
  if (living) {
    const refs = collectDragonLinks(living)
    if (refs.length > 0) {
      return {
        father: refs[0] ?? null,
        mother: refs[1] ?? null,
        parentsNone: false,
      }
    }
    if (listLooksLikeNone(living)) {
      return { father: null, mother: null, parentsNone: true }
    }
  }

  const exalted = readExaltedParents(doc)
  if (exalted) return exalted

  return { father: null, mother: null, parentsNone: false }
}

function readExaltedParents(doc: Document): ParentsParse | null {
  const want = 'parents'
  for (const header of doc.querySelectorAll('h2.exalted-lineage-header')) {
    if (normalizeName(header.textContent ?? '').toLowerCase() !== want) {
      continue
    }
    let sibling: Element | null = header.nextElementSibling
    while (sibling && sibling.tagName !== 'UL') {
      sibling = sibling.nextElementSibling
    }
    if (!sibling) {
      return { father: null, mother: null, parentsNone: false }
    }
    const refs = collectDragonLinks(sibling)
    if (refs.length > 0) {
      return {
        father: refs[0] ?? null,
        mother: refs[1] ?? null,
        parentsNone: false,
      }
    }
    if (listLooksLikeNone(sibling)) {
      return { father: null, mother: null, parentsNone: true }
    }
    return { father: null, mother: null, parentsNone: false }
  }
  return null
}

/** FR writes a bare "none" list item for true G1 dragons. */
function listLooksLikeNone(list: Element): boolean {
  const items = [...list.querySelectorAll(':scope > li')]
  if (items.length === 1) {
    const text = normalizeName(items[0]!.textContent ?? '').toLowerCase()
    if (text === 'none') return true
  }
  const whole = normalizeName(list.textContent ?? '').toLowerCase()
  return whole === 'none'
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

/** Eye Type block → flight element (Ice, Fire, …). */
function readElement(doc: Document, rawText: string): DragonElement {
  for (const header of doc.querySelectorAll(
    'h3.dragon-profile-details-subheader',
  )) {
    if (normalizeName(header.textContent ?? '').toLowerCase() !== 'eye type') {
      continue
    }
    let sibling: Element | null = header.nextElementSibling
    while (sibling && !sibling.classList.contains('dragon-profile-stats')) {
      sibling = sibling.nextElementSibling
    }
    const fromBlock = parseElementFromEyeTypeText(sibling?.textContent ?? '')
    if (fromBlock) return fromBlock
    const fromHeader = parseElementFromEyeTypeText(
      `${header.textContent ?? ''} ${sibling?.textContent ?? ''}`,
    )
    if (fromHeader) return fromHeader
  }

  const eyeImg = doc.querySelector(
    'img[alt*="Eye Type"], img[src*="/eyes/"], img[src*="eye_type"]',
  )
  if (eyeImg) {
    const fromAlt = parseElementFromEyeTypeText(
      `${eyeImg.getAttribute('alt') ?? ''} ${eyeImg.getAttribute('src') ?? ''}`,
    )
    if (fromAlt) return fromAlt
    const wrap = eyeImg.closest(
      '.dragon-profile-stat-icon, .dragon-profile-stats, li, div',
    )
    const fromWrap = parseElementFromEyeTypeText(wrap?.textContent ?? '')
    if (fromWrap) return fromWrap
  }

  return parseElementFromEyeTypeText(rawText)
}

/** FR Hatchday block: h3 "Hatchday" then strong date like "Sep 08, 2025". */
function readBirthDate(doc: Document): string {
  for (const header of doc.querySelectorAll(
    'h3.dragon-profile-details-subheader',
  )) {
    if (normalizeName(header.textContent ?? '').toLowerCase() !== 'hatchday') {
      continue
    }
    let sibling: Element | null = header.nextElementSibling
    while (sibling && !sibling.classList.contains('dragon-profile-stats')) {
      sibling = sibling.nextElementSibling
    }
    const strong = sibling?.querySelector(
      '.dragon-profile-stat-icon-value strong',
    )
    const parsed = parseFrHatchday(strong?.textContent ?? '')
    if (parsed) return parsed
  }

  // Fallback: birthday-cake icon next to the hatchday value.
  const cake = doc.querySelector(
    'img[alt="Hatchday"], img[src*="birthday-cake.png"]',
  )
  const value = cake
    ?.closest('.dragon-profile-stat-icon')
    ?.querySelector('.dragon-profile-stat-icon-value strong')
  return parseFrHatchday(value?.textContent ?? '')
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

function readDragonLinks(
  doc: Document,
  selector: string,
): FrDragonRef[] | null {
  const list = doc.querySelector(selector)
  if (!list) return null
  return collectDragonLinks(list)
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
