import { describe, expect, it } from 'vitest'
import {
  FACTOR_KEYS,
  NEUTRAL_MODS,
  TERM_KEYS,
  WORKS,
  findWork,
  isCommissionable,
  workIndex,
  workMods,
  type WorkId,
  type WorkKey,
} from './work.ts'

describe('the works catalogue', () => {
  it('has twenty-five works with unique ids', () => {
    expect(WORKS).toHaveLength(25)
    expect(new Set(WORKS.map((w) => w.id)).size).toBe(25)
  })

  it('pins the catalogue order, because work.def enters a hash later', () => {
    expect(WORKS.map((w) => w.id)).toEqual([
      'irrigation',
      'plough',
      'granary',
      'calendar',
      'pottery',
      'writing',
      'roads',
      'coinage',
      'aqueduct',
      'navigation',
      'printing',
      'metallurgy',
      'steam',
      'railway',
      'sanitation',
      'electrification',
      'telegraph',
      'chemistry',
      'medicine',
      'computer',
      'rocket',
      'orbit',
      'shipyard',
      'arcology',
      'reactor',
    ])
  })

  it('never points a prerequisite at a work that does not exist', () => {
    const ids = new Set<string>(WORKS.map((w) => w.id))
    for (const work of WORKS) {
      for (const need of work.needs) expect(ids.has(need)).toBe(true)
    }
  })

  it('has no cycle, because every prerequisite comes earlier in the catalogue', () => {
    const seen = new Set<string>()
    for (const work of WORKS) {
      for (const need of work.needs) expect(seen.has(need)).toBe(true)
      seen.add(work.id)
    }
  })

  it('never needs a work from a later era than its own', () => {
    for (const work of WORKS) {
      for (const need of work.needs) expect(findWork(need).era).toBeLessThanOrEqual(work.era)
    }
  })

  it('charges every work a positive cost, left uncalibrated for now', () => {
    for (const work of WORKS) expect(work.cost).toBeGreaterThan(0)
  })

  it('has an empty effect only for the rocket, which gates the shipyard and the orbit', () => {
    const empty = WORKS.filter((w) => Object.keys(w.effect).length === 0)
    expect(empty.map((w) => w.id)).toEqual(['rocket'])

    const gated = WORKS.filter((w) => w.needs.includes('rocket' as WorkId))
      .map((w) => w.id)
      .sort()
    expect(gated).toEqual(['orbit', 'shipyard'])
  })

  const EXPECTED: Record<
    WorkId,
    { readonly needs: readonly WorkId[]; readonly effect: Partial<Record<WorkKey, number>> }
  > = {
    irrigation: { needs: [], effect: { harvest: 1.12 } },
    plough: { needs: ['irrigation'], effect: { harvest: 1.1 } },
    granary: { needs: [], effect: { spoil: -0.08 } },
    calendar: { needs: ['irrigation'], effect: { harvestNoise: -0.04 } },
    pottery: { needs: [], effect: { economy: 1.05 } },
    writing: { needs: [], effect: { research: 1.2 } },
    roads: { needs: ['writing'], effect: { economy: 1.08 } },
    coinage: { needs: ['writing'], effect: { economy: 1.12 } },
    aqueduct: { needs: ['roads'], effect: { mortality: -0.005, capacity: 1.06 } },
    navigation: { needs: ['roads'], effect: { economy: 1.1 } },
    printing: { needs: ['writing'], effect: { research: 1.35 } },
    metallurgy: { needs: ['coinage'], effect: { production: 1.15 } },
    steam: { needs: ['metallurgy'], effect: { energy: 1.8 } },
    railway: { needs: ['steam'], effect: { economy: 1.2, production: 1.1 } },
    sanitation: { needs: ['aqueduct'], effect: { mortality: -0.012 } },
    electrification: { needs: ['steam'], effect: { energy: 1.6 } },
    telegraph: { needs: ['electrification'], effect: { research: 1.15 } },
    chemistry: { needs: ['metallurgy'], effect: { harvest: 1.25, pollution: 0.04 } },
    medicine: { needs: ['sanitation'], effect: { mortality: -0.02 } },
    computer: { needs: ['telegraph'], effect: { research: 1.5 } },
    rocket: { needs: ['computer'], effect: {} },
    orbit: { needs: ['rocket'], effect: { research: 1.2 } },
    shipyard: { needs: ['rocket'], effect: { colonyCost: 0.7 } },
    arcology: { needs: ['computer'], effect: { capacity: 1.3 } },
    reactor: { needs: ['electrification', 'computer'], effect: { energy: 2.2 } },
  }

  it('pins every work to its exact needs list and its exact effect map', () => {
    for (const work of WORKS) {
      expect(work.needs).toEqual(EXPECTED[work.id].needs)
      expect(work.effect).toEqual(EXPECTED[work.id].effect)
    }
  })
})

describe('NEUTRAL_MODS', () => {
  it('is exactly 1 on every factor and exactly 0 on every term', () => {
    for (const key of FACTOR_KEYS) expect(NEUTRAL_MODS[key]).toBe(1)
    for (const key of TERM_KEYS) expect(NEUTRAL_MODS[key]).toBe(0)
  })
})

describe('workMods', () => {
  it('is the neutral element with no works', () => {
    expect(workMods([])).toEqual(NEUTRAL_MODS)
  })

  it('leaves no key undefined, so no arithmetic can produce NaN', () => {
    const mods = workMods([{ def: 0, done: 100, record: 0 }])
    for (const value of Object.values(mods)) expect(Number.isFinite(value)).toBe(true)
  })

  it('multiplies two factors on the same key and sums two terms', () => {
    const both = workMods([
      { def: 0, done: 100, record: 0 },
      { def: 1, done: 200, record: 1 },
    ])
    expect(both.harvest).toBeCloseTo(1.12 * 1.1, 10)

    const two = workMods([
      { def: 8, done: 100, record: 0 },
      { def: 14, done: 200, record: 1 },
    ])
    expect(two.mortality).toBeCloseTo(-0.017, 10)
  })

  it('does not care about the order of the list', () => {
    const a = workMods([
      { def: 0, done: 1, record: 0 },
      { def: 12, done: 2, record: 1 },
    ])
    const b = workMods([
      { def: 12, done: 2, record: 1 },
      { def: 0, done: 1, record: 0 },
    ])
    expect(a).toEqual(b)
  })
})

describe('isCommissionable', () => {
  it('refuses a work whose era has not opened', () => {
    const index = workIndex('irrigation')
    expect(isCommissionable({ eras: 0, works: [] }, index)).toBe(false)
  })

  it('accepts a work with no prerequisites once its era is open', () => {
    const index = workIndex('irrigation')
    const eras = findWork('irrigation').era
    expect(isCommissionable({ eras, works: [] }, index)).toBe(true)
  })

  it('refuses a work that is already done', () => {
    const index = workIndex('irrigation')
    const eras = findWork('irrigation').era
    const works = [{ def: index, done: 100, record: 0 }]
    expect(isCommissionable({ eras, works }, index)).toBe(false)
  })

  it('refuses a work whose prerequisite is missing', () => {
    const index = workIndex('plough')
    const eras = findWork('plough').era
    expect(isCommissionable({ eras, works: [] }, index)).toBe(false)
  })

  it('refuses with only one of two prerequisites met, and accepts once both are', () => {
    const index = workIndex('reactor')
    const eras = findWork('reactor').era
    const computerOnly = [{ def: workIndex('computer'), done: 1, record: 0 }]
    expect(isCommissionable({ eras, works: computerOnly }, index)).toBe(false)

    const both = [
      { def: workIndex('computer'), done: 1, record: 0 },
      { def: workIndex('electrification'), done: 1, record: 1 },
    ]
    expect(isCommissionable({ eras, works: both }, index)).toBe(true)
  })

  it('refuses an out-of-range index instead of throwing', () => {
    expect(isCommissionable({ eras: 0, works: [] }, 999)).toBe(false)
    expect(isCommissionable({ eras: 0, works: [] }, -1)).toBe(false)
  })
})
