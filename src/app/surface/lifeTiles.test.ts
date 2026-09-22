import { describe, expect, it } from 'vitest'
import { keyOf, tileOf, type Vec3 } from './cube.ts'
import { LIFE_FROM, lifeReach, wantedTiles } from './lifeTiles.ts'
import { OBJECT_LEVEL } from './objects.ts'

describe('wantedTiles', () => {
  const dir = [0.2, 0.3, Math.sqrt(1 - 0.13)] as const

  it('loads nothing from high above', () => {
    expect(wantedTiles(dir, LIFE_FROM, 30)).toEqual({ keys: [], reach: 0 })
  })

  it('starts with the tile under the camera and respects the budget', () => {
    const { keys } = wantedTiles(dir, 0.05, 6)
    expect(keys[0]).toBe(keyOf(tileOf(dir, OBJECT_LEVEL)))
    expect(keys.length).toBeLessThanOrEqual(6)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('grows the area with the altitude until the budget binds', () => {
    const near = wantedTiles(dir, 0.03, 200)
    const far = wantedTiles(dir, 0.35, 200)
    expect(near.reach).toBeCloseTo(lifeReach(0.03))
    expect(far.keys.length).toBeGreaterThan(near.keys.length)
    const tight = wantedTiles(dir, 0.35, 20)
    expect(tight.keys.length).toBe(20)
    expect(tight.reach).toBeLessThan(lifeReach(0.35))
  })

  it('covers every point inside the reported reach', () => {
    const { keys, reach } = wantedTiles(dir, 0.35, 60)
    const loaded = new Set(keys)
    const flat = Math.hypot(dir[0], dir[2])
    const east: Vec3 = [dir[2] / flat, 0, -dir[0] / flat]
    const north: Vec3 = [
      dir[1] * east[2] - dir[2] * east[1],
      dir[2] * east[0] - dir[0] * east[2],
      dir[0] * east[1] - dir[1] * east[0],
    ]
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2
      const r = reach * 0.95 * ((k % 4) + 1) * 0.25
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      const p: Vec3 = [
        dir[0] + east[0] * x + north[0] * y,
        dir[1] + east[1] * x + north[1] * y,
        dir[2] + east[2] * x + north[2] * y,
      ]
      const l = Math.hypot(...p)
      expect(loaded.has(keyOf(tileOf([p[0] / l, p[1] / l, p[2] / l], OBJECT_LEVEL)))).toBe(true)
    }
  })
})
