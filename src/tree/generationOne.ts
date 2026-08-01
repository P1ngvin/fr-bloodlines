import type { Dragon } from '../data/models'

/**
 * Confirmed first-generation (G1) dragon: Flight Rising lists Parents as None.
 * Missing mother/father links in the project alone are not enough.
 */
export function isGenerationOne(dragon: Dragon): boolean {
  return dragon.parentsNone === true
}
