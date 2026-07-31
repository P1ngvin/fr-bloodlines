import type { Migration } from './types'
import { v1ToV2 } from './v1ToV2'
import { v2ToV3 } from './v2ToV3'
import { v3ToV4 } from './v3ToV4'
import { v4ToV5 } from './v4ToV5'
import { v5ToV6 } from './v5ToV6'

/**
 * Ordered migrations from older format versions up to CURRENT_FORMAT_VERSION.
 */
export const MIGRATIONS: readonly Migration[] = [
  v1ToV2,
  v2ToV3,
  v3ToV4,
  v4ToV5,
  v5ToV6,
]
