export type DragonSex = 'female' | 'male' | 'unknown'

/** Sexes that can fill a mother/father slot. */
export type KnownDragonSex = 'female' | 'male'

export const DRAGON_SEXES: readonly DragonSex[] = [
  'female',
  'male',
  'unknown',
] as const

export function isDragonSex(value: unknown): value is DragonSex {
  return value === 'female' || value === 'male' || value === 'unknown'
}

export function isKnownDragonSex(value: unknown): value is KnownDragonSex {
  return value === 'female' || value === 'male'
}

/** Parent slot this sex fills on a child record. */
export function parentRoleForSex(sex: KnownDragonSex): 'mother' | 'father' {
  return sex === 'female' ? 'mother' : 'father'
}

/** True when this dragon can be linked/created as a parent. */
export function canActAsParent(sex: DragonSex): boolean {
  return isKnownDragonSex(sex)
}
