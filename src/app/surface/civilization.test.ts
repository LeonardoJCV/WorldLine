import { describe, expect, it } from 'vitest'
import { Era, type Allocation, type Variable } from '../../engine/state.ts'
import { planetPalette } from '../planet/uniforms.ts'
import {
  CITY_BASE,
  bustle,
  packLife,
  surfaceModel,
  thresholds,
  type CivilizationInput,
} from './civilization.ts'
import { findSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

const sites = findSites(createTerrain(482913, planetPalette(482913)))
const allocation: Allocation = { agriculture: 40, industry: 30, research: 20, conservation: 10 }
const values: Record<Variable, number> = {
  population: 2_000_000,
  food: 800_000,
  energy: 2,
  technology: 20,
  economy: 3,
  environment: 85,
  stability: 80,
}

function input(
  patch: Partial<CivilizationInput> = {},
  v: Partial<Record<Variable, number>> = {},
): CivilizationInput {
  const population = v.population ?? values.population
  return {
    sites,
    values: { ...values, ...v },
    eras: Era.agricultural,
    active: [],
    allocation,
    status: 'running',
    history: {
      from: 0,
      to: 500,
      population: Float32Array.from([1_000_000, 1_500_000, population]),
    },
    ...patch,
  }
}

describe('thresholds', () => {
  it('grows by repeated multiplication', () => {
    const t = thresholds(3)
    expect(t[0]).toBe(CITY_BASE)
    expect(t[2]).toBeCloseTo(CITY_BASE * 1.12 * 1.12, 6)
  })
})

describe('surfaceModel', () => {
  it('adds cities with population and keeps the old ones in place', () => {
    const small = surfaceModel(input({}, { population: 1_000_000 }))
    const big = surfaceModel(input({}, { population: 8_000_000 }))
    expect(big.cities.length).toBeGreaterThan(small.cities.length)
    small.cities.forEach((city, i) => expect(big.cities[i]?.site).toBe(city.site))
    expect((big.cities[0]?.size ?? 0) > (small.cities[0]?.size ?? 0)).toBe(true)
  })

  it('dates each city from the population history', () => {
    const model = surfaceModel(input({}, { population: 1_600_000 }))
    const first = model.cities[0]
    expect(first?.founded).toBe(0)
    const last = model.cities.at(-1)
    expect(last?.founded).toBeGreaterThan(0)
  })

  it('turns cities into ruins when the population falls', () => {
    const model = surfaceModel(
      input(
        {
          history: {
            from: 0,
            to: 500,
            population: Float32Array.from([1_000_000, 6_000_000, 900_000]),
          },
        },
        { population: 900_000 },
      ),
    )
    expect(model.cities.some((c) => c.state === 'ruin')).toBe(true)
    expect(model.cities.filter((c) => c.state === 'alive').length).toBeLessThan(model.cities.length)
  })

  it('reacts to agriculture, industry and conservation', () => {
    const farming = surfaceModel(
      input({ allocation: { ...allocation, agriculture: 70, industry: 10 } }),
    )
    const plain = surfaceModel(input())
    expect(farming.farm).toBeGreaterThan(plain.farm)
    expect(farming.livestock).toBeGreaterThan(plain.livestock)
    const industrial = { eras: Era.agricultural | Era.industrial }
    const heavy = surfaceModel(
      input(
        { ...industrial, allocation: { ...allocation, industry: 70, agriculture: 10 } },
        { energy: 9 },
      ),
    )
    const light = surfaceModel(input({ ...industrial }, { energy: 9 }))
    expect(heavy.factories).toBeGreaterThan(light.factories)
    const green = surfaceModel(
      input({ allocation: { ...allocation, conservation: 60, research: 0, industry: 0 } }),
    )
    expect(green.forest).toBeGreaterThan(plain.forest)
    expect(green.clearing).toBeLessThan(plain.clearing)
  })

  it('reacts to environment, technology and crises', () => {
    const plain = surfaceModel(input())
    const bare = surfaceModel(input({}, { environment: 20 }))
    expect(bare.forest).toBeLessThan(plain.forest)
    expect(bare.fauna).toBeLessThan(plain.fauna)
    const modern = surfaceModel(
      input({ eras: Era.agricultural | Era.industrial }, { technology: 80, energy: 9 }),
    )
    expect(modern.era).toBe('modern')
    expect(modern.electric).toBeGreaterThan(0.7)
    expect(plain.electric).toBe(0)
    const hungry = surfaceModel(input({ active: ['famine'] }))
    expect(hungry.dry).toBe(true)
    expect(hungry.livestock).toBeLessThan(plain.livestock)
  })

  it('leaves only ruins and wild nature after extinction', () => {
    const model = surfaceModel(input({ status: 'extinct' }, { population: 0 }))
    expect(model.cities.length).toBeGreaterThan(0)
    expect(model.cities.every((c) => c.state === 'ruin')).toBe(true)
    expect(model.electric).toBe(0)
    expect(model.livestock).toBe(0)
    expect(model.fauna).toBe(1)
  })

  it('survives NaN population with history peak', () => {
    const model = surfaceModel(
      input(
        {
          history: {
            from: 0,
            to: 500,
            population: Float32Array.from([1_000_000, 6_000_000, 900_000]),
          },
        },
        { population: NaN },
      ),
    )
    expect(model.cities.length).toBeGreaterThan(0)
    expect(model.cities.some((c) => c.state === 'ruin')).toBe(true)
  })

  it('handles zero population with running status', () => {
    const model = surfaceModel(
      input(
        { history: { from: 0, to: 500, population: Float32Array.from([1_000_000, 6_000_000, 0]) } },
        { population: 0 },
      ),
    )
    expect(model.cities.length).toBeGreaterThan(0)
    expect(model.cities.every((c) => c.state === 'ruin')).toBe(true)
  })
})

describe('packLife', () => {
  it('writes one vec4 per site and flags the state of each city', () => {
    const model = surfaceModel(input())
    const packed = packLife(model, 3)
    expect(packed.city.length).toBe(48 * 4)
    const first = model.cities[0]
    if (!first) throw new Error('no city')
    expect(packed.city[first.site * 4 + 1]).toBe(1)
    expect(packed.life3[2]).toBe(3)
  })

  it('lets the economy fill the harbours and the roads', () => {
    const poor = surfaceModel(input({}, { economy: 2 }))
    const rich = surfaceModel(input({}, { economy: 9 }))
    expect(rich.economy).toBeGreaterThan(poor.economy)
    expect(rich.boats).toBeGreaterThan(poor.boats)
    expect(packLife(rich, 0).life[3]).toBeGreaterThan(packLife(poor, 0).life[3])
    expect(bustle(rich)).toBeGreaterThan(bustle(poor))
    expect(bustle(surfaceModel(input({ status: 'extinct' }, { population: 0 })))).toBe(0.4)
  })

  it('packs the activity of each city for the shaders', () => {
    const industrial = { eras: Era.agricultural | Era.industrial }
    const busy = { ...allocation, industry: 50, agriculture: 20 }
    const model = surfaceModel(input({ ...industrial, allocation: busy }, { economy: 9 }))
    const packed = packLife(model, 0)
    const code = { agrarian: 0, industrial: 1, port: 2 } as const
    for (const city of model.cities) {
      expect(packed.city2[city.site * 4 + 3]).toBe(code[city.activity])
    }
    expect(model.cities.some((c) => c.activity === 'port')).toBe(true)
    expect(model.cities.some((c) => c.activity === 'industrial')).toBe(true)
  })

  it('scales electric light by city size', () => {
    const model = surfaceModel(input({ eras: Era.agricultural | Era.industrial }, { energy: 9 }))
    const packed = packLife(model, 0)
    const cities = model.cities.filter((c) => c.state === 'alive').slice(0, 2)
    const c0 = cities[0]
    const c1 = cities[1]
    if (!c0 || !c1) throw new Error('need at least 2 cities')
    const light0 = packed.city[c0.site * 4 + 3] ?? 0
    const light1 = packed.city[c1.site * 4 + 3] ?? 0
    expect(light0).toBeGreaterThan(0)
    expect(light1).toBeGreaterThan(0)
    if (c0.size > c1.size) expect(light0).toBeGreaterThan(light1)
    else if (c1.size > c0.size) expect(light1).toBeGreaterThan(light0)
  })
})
