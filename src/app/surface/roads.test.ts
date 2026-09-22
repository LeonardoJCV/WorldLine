import { describe, expect, it } from 'vitest'
import { Era } from '../../engine/state.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { surfaceModel } from './civilization.ts'
import { aliveKey, buildRoads, ROAD_SAMPLES } from './roads.ts'
import { findSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

const terrain = createTerrain(482913, planetPalette(482913))
const sites = findSites(terrain)
const model = surfaceModel({
  sites,
  values: {
    population: 6_000_000,
    food: 2_000_000,
    energy: 4,
    technology: 40,
    economy: 6,
    environment: 70,
    stability: 70,
  },
  eras: Era.agricultural | Era.industrial,
  active: [],
  allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
  status: 'running',
  history: { from: 0, to: 800, population: Float32Array.from([1_000_000, 6_000_000]) },
})

describe('buildRoads', () => {
  it('links every living city after the first to an earlier one', () => {
    const roads = buildRoads(model, sites, terrain)
    const alive = model.cities.filter((c) => c.state === 'alive').map((c) => c.site)
    for (const road of roads) {
      expect(alive).toContain(road.from)
      expect(alive).toContain(road.to)
      expect(alive.indexOf(road.to)).toBeLessThan(alive.indexOf(road.from))
      expect(road.points.length).toBe(ROAD_SAMPLES * 3)
    }
    expect(roads.length).toBeGreaterThan(0)
  })

  it('drapes roads on the relief', () => {
    for (const road of buildRoads(model, sites, terrain)) {
      for (let i = 0; i < road.points.length; i += 3) {
        const r = Math.hypot(road.points[i] ?? 0, road.points[i + 1] ?? 0, road.points[i + 2] ?? 0)
        expect(r).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('builds no roads without living cities', () => {
    const dead = { ...model, cities: model.cities.map((c) => ({ ...c, state: 'ruin' as const })) }
    expect(buildRoads(dead, sites, terrain)).toEqual([])
  })

  it('is deterministic', () => {
    const a = buildRoads(model, sites, terrain)
    const b = buildRoads(model, sites, terrain)
    expect(b.map((r) => [r.from, r.to])).toEqual(a.map((r) => [r.from, r.to]))
    expect(b.map((r) => [...r.points])).toEqual(a.map((r) => [...r.points]))
  })

  it('keys the roads by the set of living cities', () => {
    const alive = model.cities.filter((c) => c.state === 'alive').map((c) => c.site)
    expect(aliveKey(model)).toBe(alive.join())
    expect(aliveKey(null)).toBe('')
  })

  it('flags the samples that fall on the sea', () => {
    const roads = buildRoads(model, sites, terrain)
    for (const road of roads) {
      expect(road.wet.length).toBe(ROAD_SAMPLES)
      for (let k = 0; k < road.wet.length; k++) {
        const x = road.points[k * 3] ?? 0
        const y = road.points[k * 3 + 1] ?? 0
        const z = road.points[k * 3 + 2] ?? 0
        const r = Math.hypot(x, y, z)
        const sea = terrain.sample(x / r, y / r, z / r).biome === 'ocean'
        expect(road.wet[k]).toBe(sea ? 1 : 0)
      }
    }
    expect(roads.some((road) => road.wet.includes(1))).toBe(true)
  })
})
