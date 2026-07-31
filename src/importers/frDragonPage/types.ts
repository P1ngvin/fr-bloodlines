import type { KnownDragonSex } from '../../data/models'

export type FrDragonRef = {
  frId: string
  name: string
}

/** Parsed Flight Rising dragon profile (from a user-downloaded page). */
export type FrDragonPage = {
  frId: string
  name: string
  sex: KnownDragonSex | 'unknown'
  /** Parents list order on FR: first = father, second = mother. */
  father: FrDragonRef | null
  mother: FrDragonRef | null
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
