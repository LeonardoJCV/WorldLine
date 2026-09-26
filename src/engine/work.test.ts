import { describe, expect, it } from 'vitest'
import { NEUTRAL_MODS, WORKS, findWork, workMods, type WorkId } from './work.ts'

describe('the works catalogue', () => {
  it('has twenty-five works with unique ids', () => {
    expect(WORKS).toHaveLength(25)
    expect(new Set(WORKS.map((w) => w.id)).size).toBe(25)
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

  it('charges every work a positive cost', () => {
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
      { def: 0, done: 100, record: 0 }, // irrigation, harvest 1.12
      { def: 1, done: 200, record: 1 }, // plough, harvest 1.10
    ])
    expect(both.harvest).toBeCloseTo(1.12 * 1.1, 10)

    const two = workMods([
      { def: 8, done: 100, record: 0 }, // aqueduct, mortality -0.005
      { def: 14, done: 200, record: 1 }, // sanitation, mortality -0.012
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
