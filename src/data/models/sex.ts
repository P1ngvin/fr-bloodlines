export type DragonSex = 'female' | 'male'

export const DRAGON_SEXES: readonly DragonSex[] = ['female', 'male'] as const

export function isDragonSex(value: unknown): value is DragonSex {
  return value === 'female' || value === 'male'
}

/** Parent slot this sex fills on a child record. */
export function parentRoleForSex(sex: DragonSex): 'mother' | 'father' {
  return sex === 'female' ? 'mother' : 'father'
}
