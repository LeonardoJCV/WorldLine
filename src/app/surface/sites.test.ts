import { describe, expect, it } from 'vitest'
import { planetPalette } from '../planet/uniforms.ts'
import { MAX_SITES, SITE_SPACING, findSites, packSites, unpackSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

const terrain = createTerrain(482913, planetPalette(482913))
const sites = findSites(terrain)

describe('findSites', () => {
  it('picks up to 48 land sites in a stable order', () => {
    expect(sites.length).toBeGreaterThan(10)
    expect(sites.length).toBeLessThanOrEqual(MAX_SITES)
    expect(findSites(createTerrain(482913, planetPalette(482913)))).toEqual(sites)
    for (const site of sites) {
      expect(['ocean', 'ice', 'rock']).not.toContain(terrain.sample(...site.dir).biome)
    }
    sites.forEach((site, i) => expect(site.index).toBe(i))
  })

  it('keeps sites apart and ranks better land first', () => {
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const a = sites[i]?.dir ?? [0, 0, 1]
        const b = sites[j]?.dir ?? [0, 0, 1]
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        expect(dot).toBeLessThanOrEqual(Math.cos(SITE_SPACING) + 1e-12)
      }
    }
    for (let i = 1; i < sites.length; i++) {
      expect(sites[i]?.score ?? 0).toBeLessThanOrEqual(sites[i - 1]?.score ?? 0)
    }
  })

  it('round-trips through a packed array', () => {
    expect(unpackSites(packSites(sites))).toEqual(sites)
  })
})
