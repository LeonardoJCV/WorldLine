import { describe, expect, it } from 'vitest'
import { keyOf, tileOf } from './cube.ts'
import { LIFE_FROM, wantedTiles } from './lifeTiles.ts'
import { OBJECT_LEVEL } from './objects.ts'

describe('wantedTiles', () => {
  const dir = [0.2, 0.3, Math.sqrt(1 - 0.13)] as const

  it('loads nothing from high above', () => {
    expect(wantedTiles(dir, LIFE_FROM, 30)).toEqual([])
  })

  it('starts with the tile under the camera and respects the budget', () => {
    const tiles = wantedTiles(dir, 0.05, 6)
    expect(tiles[0]).toBe(keyOf(tileOf(dir, OBJECT_LEVEL)))
    expect(tiles.length).toBeLessThanOrEqual(6)
    expect(new Set(tiles).size).toBe(tiles.length)
  })
})
