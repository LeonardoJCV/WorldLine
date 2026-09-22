import { describe, expect, it } from 'vitest'
import { NEUTRAL_MODIFIERS, SimulationError, derive, integrate } from './rules.ts'
import { Era, VARIABLES } from './state.ts'
import { TEST_WORLD, makeState } from './testing.ts'

const neutral = NEUTRAL_MODIFIERS
const calm = 0.5

describe('derive', () => {
  it('feeds the initial world with a surplus', () => {
    const d = derive(makeState(), TEST_WORLD, neutral, calm)
    expect(d.foodSecurity).toBeGreaterThan(1.2)
    expect(d.foodSecurity).toBeLessThan(1.8)
  })

  it('produces more food with more agriculture', () => {
    const low = derive(
      makeState({ allocation: { agriculture: 10, industry: 50, research: 30, conservation: 10 } }),
      TEST_WORLD,
      neutral,
      calm,
    )
    const high = derive(makeState(), TEST_WORLD, neutral, calm)
    expect(high.foodProduction).toBeGreaterThan(low.foodProduction)
  })

  it('places carrying capacity at half the agricultural capacity', () => {
    const d = derive(makeState(), TEST_WORLD, neutral, calm)
    expect(d.carryingCapacity).toBeCloseTo(d.capacity / 2, 6)
  })

  it('raises mortality under hunger', () => {
    const fed = derive(makeState(), TEST_WORLD, neutral, calm)
    const hungry = derive(makeState({ population: 4e6, food: 0 }), TEST_WORLD, neutral, calm)
    expect(hungry.foodSecurity).toBeLessThan(1)
    expect(hungry.deathRate).toBeGreaterThan(fed.deathRate)
  })

  it('raises the energy target with industry and doubles it in the industrial era', () => {
    const base = derive(makeState(), TEST_WORLD, neutral, calm)
    const industrial = derive(makeState({ eras: Era.industrial }), TEST_WORLD, neutral, calm)
    const heavy = derive(
      makeState({ allocation: { agriculture: 20, industry: 60, research: 10, conservation: 10 } }),
      TEST_WORLD,
      neutral,
      calm,
    )
    expect(industrial.energyTarget).toBeCloseTo(base.energyTarget * 2, 10)
    expect(heavy.energyTarget).toBeGreaterThan(base.energyTarget)
  })

  it('pollutes more with energy and less with clean technology', () => {
    const dirty = derive(makeState({ energy: 4 }), TEST_WORLD, neutral, calm)
    const lighter = derive(makeState({ energy: 2 }), TEST_WORLD, neutral, calm)
    const clean = derive(makeState({ energy: 4, technology: 95 }), TEST_WORLD, neutral, calm)
    expect(dirty.pollution).toBeGreaterThan(lighter.pollution)
    expect(clean.pollution).toBeLessThan(dirty.pollution * 0.2)
  })

  it('lowers births as the economy grows', () => {
    const poor = derive(makeState({ economy: 0.5 }), TEST_WORLD, neutral, calm)
    const rich = derive(makeState({ economy: 10 }), TEST_WORLD, neutral, calm)
    expect(rich.birthRate).toBeLessThan(poor.birthRate)
  })

  it('applies harvest and mortality modifiers', () => {
    const base = derive(makeState(), TEST_WORLD, neutral, calm)
    const blighted = derive(makeState(), TEST_WORLD, { ...neutral, harvest: 0.85 }, calm)
    const sick = derive(makeState(), TEST_WORLD, { ...neutral, mortality: 0.02 }, calm)
    expect(blighted.foodProduction / base.foodProduction).toBeCloseTo(0.85, 10)
    expect(sick.deathRate - base.deathRate).toBeCloseTo(0.02, 10)
  })

  it('moves the harvest with the noise sample', () => {
    const lean = derive(makeState(), TEST_WORLD, neutral, 0)
    const rich = derive(makeState(), TEST_WORLD, neutral, 0.999)
    expect(rich.foodProduction).toBeGreaterThan(lean.foodProduction)
  })
})

describe('integrate', () => {
  it('advances one year and shifts the economy memory', () => {
    const s = makeState({ economy: 1.3, recentEconomy: [1, 1.1, 1.2, 1.25, 1.28] })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(next.tick).toBe(1)
    expect(next.recentEconomy).toEqual([1.1, 1.2, 1.25, 1.28, 1.3])
  })

  it('keeps environment and stability inside 0..100', () => {
    const s = makeState({ energy: 1000, population: 5e6 })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(next.environment).toBe(0)
    expect(next.stability).toBeGreaterThanOrEqual(0)
    expect(next.stability).toBeLessThanOrEqual(100)
  })

  it('never lets technology exceed 100', () => {
    const s = makeState({
      technology: 99.99,
      economy: 50,
      allocation: { agriculture: 0, industry: 0, research: 100, conservation: 0 },
    })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), { ...neutral, research: 5 })
    expect(next.technology).toBeLessThanOrEqual(100)
  })

  it('limits energy growth by the economy', () => {
    const poor = makeState({ economy: 0.05 })
    const rich = makeState({ economy: 5 })
    const poorNext = integrate(poor, derive(poor, TEST_WORLD, neutral, calm), neutral)
    const richNext = integrate(rich, derive(rich, TEST_WORLD, neutral, calm), neutral)
    expect(richNext.energy - rich.energy).toBeGreaterThan(poorNext.energy - poor.energy)
  })

  it('survives an emptied world', () => {
    const s = makeState({ population: 0 })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(next.population).toBe(0)
    expect(next.stability).toBeGreaterThanOrEqual(0)
  })

  it('survives an emptied world with no food left', () => {
    const s = makeState({ population: 0, food: 0 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    expect(Number.isNaN(derived.foodSecurity)).toBe(false)
    const next = integrate(s, derived, neutral)
    for (const variable of VARIABLES) expect(Number.isFinite(next[variable])).toBe(true)
  })

  it('reports the first non-finite variable', () => {
    const s = makeState({ population: NaN, tick: 42 })
    const run = () => integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(run).toThrow(SimulationError)
    try {
      run()
    } catch (error) {
      expect(error).toMatchObject({ variable: 'population', tick: 42 })
    }
  })
})
