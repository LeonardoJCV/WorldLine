import { describe, expect, it } from 'vitest'
import { planetPalette } from '../planet/uniforms.ts'
import { keyOf, tileOf } from './cube.ts'
import { DENSITY, OBJECT_KINDS, OBJECT_LEVEL, STRIDE, objectTile } from './objects.ts'
import { findSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

const terrain = createTerrain(482913, planetPalette(482913))
const sites = findSites(terrain)
const home = sites[0]
if (!home) throw new Error('no site')
const tile = tileOf(home.dir, OBJECT_LEVEL)

describe('objectTile', () => {
  it('is deterministic and stores eight floats per candidate', () => {
    const a = objectTile(terrain, sites, tile, 1)
    const b = objectTile(terrain, sites, tile, 1)
    for (const kind of OBJECT_KINDS) {
      expect(a[kind].length % STRIDE).toBe(0)
      expect(Array.from(a[kind])).toEqual(Array.from(b[kind]))
    }
  })

  it('places buildings around the first site and every candidate inside its tile', () => {
    const set = objectTile(terrain, sites, tile, 1)
    let core = 0
    for (let i = 0; i < set.buildings.length; i += STRIDE) {
      if (set.buildings[i + 6] === home.index && (set.buildings[i + 7] ?? 1) < 0.03) core++
    }
    expect(set.buildings.length / STRIDE).toBeGreaterThan(50)
    expect(core).toBeGreaterThan(5)
    for (const kind of OBJECT_KINDS) {
      const data = set[kind]
      for (let i = 0; i < data.length; i += STRIDE) {
        const dir: [number, number, number] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
        const length = Math.hypot(...dir)
        expect(
          keyOf(tileOf([dir[0] / length, dir[1] / length, dir[2] / length], OBJECT_LEVEL)),
        ).toBe(keyOf(tile))
        const rank = data[i + 5] ?? -1
        expect(rank).toBeGreaterThanOrEqual(0)
        expect(rank).toBeLessThan(1)
      }
    }
  })

  it('fills the centre of a town as densely as its outskirts', () => {
    let centre = 0
    let total = 0
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const set = objectTile(terrain, sites, { ...tile, x: tile.x + dx, y: tile.y + dy }, 1)
        for (let i = 0; i < set.buildings.length; i += STRIDE) {
          if (set.buildings[i + 6] !== home.index) continue
          total++
          if ((set.buildings[i + 7] ?? 1) < 0.1) centre++
        }
      }
    }
    expect(centre).toBeGreaterThan(total * 0.02)
  })

  it('scales the number of candidates with the density', () => {
    const low = objectTile(terrain, sites, tile, DENSITY.low)
    const ultra = objectTile(terrain, sites, tile, DENSITY.ultra)
    expect(ultra.trees.length).toBeGreaterThan(low.trees.length)
    expect(ultra.buildings.length).toBeGreaterThan(low.buildings.length)
  })

  it('keeps urban candidates consistent across neighbouring tiles', () => {
    const neighbour = { ...tile, x: tile.x + 1 }
    const here = objectTile(terrain, sites, tile, 1).buildings
    const there = objectTile(terrain, sites, neighbour, 1).buildings
    const points = new Set<string>()
    for (const data of [here, there]) {
      for (let i = 0; i < data.length; i += STRIDE)
        points.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    }
    expect(points.size).toBe((here.length + there.length) / STRIDE)
  })
})
