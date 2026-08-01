/**
 * Level-of-detail for the tree canvas, driven by zoom.
 * Farther out = less chrome (and no image loads at `dot`).
 */
export type TreeLod = 'full' | 'named' | 'portrait' | 'dot'

export function treeLodFromZoom(zoom: number): TreeLod {
  if (zoom < 0.4) return 'dot'
  if (zoom < 0.65) return 'portrait'
  if (zoom < 0.95) return 'named'
  return 'full'
}
