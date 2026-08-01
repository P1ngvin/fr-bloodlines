import type { Migration } from './types'
import { v1ToV2 } from './v1ToV2'
import { v2ToV3 } from './v2ToV3'
import { v3ToV4 } from './v3ToV4'
import { v4ToV5 } from './v4ToV5'
import { v5ToV6 } from './v5ToV6'
import { v6ToV7 } from './v6ToV7'
import { v7ToV8 } from './v7ToV8'
import { v8ToV9 } from './v8ToV9'
import { v9ToV10 } from './v9ToV10'
import { v10ToV11 } from './v10ToV11'

/**
 * Ordered migrations from older format versions up to CURRENT_FORMAT_VERSION.
 */
export const MIGRATIONS: readonly Migration[] = [
  v1ToV2,
  v2ToV3,
  v3ToV4,
  v4ToV5,
  v5ToV6,
  v6ToV7,
  v7ToV8,
  v8ToV9,
  v9ToV10,
  v10ToV11,
]
