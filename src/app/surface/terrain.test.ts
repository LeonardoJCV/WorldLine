import { describe, expect, it } from 'vitest'
import { planetPalette } from '../planet/uniforms.ts'
import { BIOMES, SEA, bakeMap, createTerrain, surfaceRadius } from './terrain.ts'

function directions(count: number): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(1 - y * y)
    const a = i * 2.399963
    out.push([Math.cos(a) * r, y, Math.sin(a) * r])
  }
  return out
}

describe('createTerrain', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = createTerrain(482913, planetPalette(482913))
    const b = createTerrain(482913, planetPalette(482913))
    const c = createTerrain(7, planetPalette(7))
    expect(a.sample(0.2, 0.5, 0.84)).toEqual(b.sample(0.2, 0.5, 0.84))
    expect(a.sample(0.2, 0.5, 0.84).height).not.toBe(c.sample(0.2, 0.5, 0.84).height)
  })

  it('keeps a believable share of ocean and every biome is known', () => {
    for (const seed of [1, 2, 3, 482913, 99]) {
      const terrain = createTerrain(seed, planetPalette(seed))
      const samples = directions(3000).map((d) => terrain.sample(...d))
      const ocean = samples.filter((s) => s.biome === 'ocean').length / samples.length
      expect(ocean).toBeGreaterThan(0.25)
      expect(ocean).toBeLessThan(0.85)
      for (const s of samples) expect(BIOMES).toContain(s.biome)
    }
  })

  it('freezes the poles', () => {
    const terrain = createTerrain(482913, planetPalette(482913))
    const pole = terrain.sample(0, 1, 0)
    expect(['ice', 'ocean']).toContain(pole.biome)
  })
})

describe('surfaceRadius', () => {
  it('raises land and sinks the sea floor below the water', () => {
    expect(surfaceRadius(SEA + 0.2)).toBeCloseTo(1.02, 10)
    expect(surfaceRadius(SEA)).toBe(1)
    expect(surfaceRadius(SEA - 0.01)).toBeLessThan(1 - 0.002)
    expect(surfaceRadius(SEA - 0.5)).toBeCloseTo(1 - 0.002 - 0.2 * 0.06, 10)
  })
})

describe('bakeMap', () => {
  it('writes the biome colour and height of each texel centre', () => {
    const terrain = createTerrain(5, planetPalette(5))
    const data = bakeMap(terrain, 16, 8)
    expect(data.length).toBe(16 * 8 * 4)
    const i = 3
    const j = 5
    const lon = ((i + 0.5) / 16) * Math.PI * 2 - Math.PI
    const lat = ((j + 0.5) / 8) * Math.PI - Math.PI / 2
    const s = terrain.sample(
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(lon),
    )
    expect(data[(j * 16 + i) * 4 + 3]).toBeCloseTo(s.height, 6)
  })
})
