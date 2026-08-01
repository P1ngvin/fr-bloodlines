import type { DragonElement, KnownDragonSex } from '../../data/models'

export type FrDragonRef = {
  /** Empty when the source only had a display name (paste import). */
  frId: string
  name: string
}

/** Parsed Flight Rising dragon profile (from a user-downloaded page). */
export type FrDragonPage = {
  frId: string
  name: string
  sex: KnownDragonSex | 'unknown'
  /**
   * Hatchday as YYYY-MM-DD when present on the page; empty when missing/unparsed.
   */
  birthDate: string
  /** Parents list order on FR: first = father, second = mother. */
  father: FrDragonRef | null
  mother: FrDragonRef | null
  /**
   * True when the page explicitly lists Parents as None (G1).
   * False when parents are present or the section was not conclusive.
   */
  parentsNone: boolean
  /** True when this is an exalted / memorial dragon page. */
  exalted: boolean
  /** Flight element from Eye Type; empty when missing/unparsed. */
  element: DragonElement
  offspring: FrDragonRef[]
}

export type FrDragonPageImportSummary = {
  mainId: string
  mainName: string
  frId: string
  created: number
  updated: number
  parentsLinked: number
  offspringLinked: number
}
