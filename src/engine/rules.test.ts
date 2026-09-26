import { describe, expect, it } from 'vitest'
import { crossingAmounts, crossingCost, type Crossing } from './crossing.ts'
import type { Debt } from './debt.ts'
import { EVENTS, METRICS, worldMetrics } from './events.ts'
import { PARAMS as K } from './params.ts'
import { NEUTRAL_MODIFIERS, SimulationError, derive, integrate } from './rules.ts'
import { Era, VARIABLES } from './state.ts'
import { TEST_WORLD, makeState } from './testing.ts'
import { Worldline } from './worldline.ts'

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

  it('harvests nothing when there is nobody to work and nothing to grow on', () => {
    // FEAT: os dois zeros juntos davam 0/0; separados, cada um já dava zero e sempre deu
    const empty = derive(makeState({ population: 0, environment: 0 }), TEST_WORLD, neutral, calm)
    expect(Number.isFinite(empty.foodProduction)).toBe(true)
    expect(empty.foodProduction).toBe(0)
  })

  it('already harvested nothing with either zero alone, and still does', () => {
    const noPeople = derive(
      makeState({ population: 0, environment: 50 }),
      TEST_WORLD,
      neutral,
      calm,
    )
    const noLand = derive(makeState({ population: 1e6, environment: 0 }), TEST_WORLD, neutral, calm)
    expect(noPeople.foodProduction).toBe(0)
    expect(noLand.foodProduction).toBe(0)
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

  it('pulls the stability target down under debt, and is untouched with an empty list', () => {
    const s = makeState()
    const derived = derive(s, TEST_WORLD, neutral, calm)
    const withoutDebt = integrate(s, derived, neutral)
    const debts: readonly Debt[] = [{ kind: 'knowledge', owed: 20, since: 0, origin: 'B' }]
    const withDebt = integrate({ ...s, debts }, derived, neutral)
    expect(withDebt.stability).toBeLessThan(withoutDebt.stability)
    expect(integrate({ ...s, debts: [] }, derived, neutral).stability).toBe(withoutDebt.stability)
  })

  it('never subtracts a departure twice: the migration is already out of the population', () => {
    const s = makeState({ population: 998_000 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    const alone = integrate(s, derived, neutral)
    const leaving = integrate(s, derived, neutral, 2000)
    expect(leaving.population).toBe(alone.population)
  })

  it('reads a departure as the loss it is, so stability feels the world shrink', () => {
    const s = makeState({ population: 998_000 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    const alone = integrate(s, derived, neutral)
    const leaving = integrate(s, derived, neutral, 2000)
    expect(leaving.stability).toBeLessThan(alone.stability)
  })

  it('reads no departure from an emptied world', () => {
    const s = makeState({ population: 0 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    expect(integrate(s, derived, neutral, 0)).toEqual(integrate(s, derived, neutral))
  })

  it('penalizes by ratio, not by the absolute owed amount: a bigger economy carries the same debt more lightly', () => {
    const debts: readonly Debt[] = [{ kind: 'knowledge', owed: 50, since: 0, origin: 'B' }]
    const penaltyAt = (economy: number) => {
      const s = makeState({ economy })
      const derived = derive(s, TEST_WORLD, neutral, calm)
      const withoutDebt = integrate(s, derived, neutral)
      const withDebt = integrate({ ...s, debts }, derived, neutral)
      return withoutDebt.stability - withDebt.stability
    }
    const smallPenalty = penaltyAt(1)
    const bigPenalty = penaltyAt(50)
    expect(smallPenalty).toBeGreaterThan(0)
    expect(bigPenalty).toBeGreaterThan(0)
    expect(bigPenalty).toBeLessThan(smallPenalty)
  })
})

// FEAT: o mundo alcançado pelo revisor: semente 0, um presente de recurso no ano 0 colapsa o
// ambiente, e uma saída de gente no ano 19 leva embora exatamente a população daquele ano
describe('a world emptied by an out-crossing where the land already collapsed', () => {
  const DONOR = { technology: 40, food: 600, energy: 400, population: 900 }

  const gift: Crossing = {
    tick: 0,
    kind: 'resource',
    dose: 3,
    amounts: crossingAmounts('resource', 3, DONOR),
    origin: { world: 'donor', tick: 0 },
    cost: crossingCost('resource', 3, 0),
    direction: 'in',
  }

  it('reaches nowhere to grow on by year 19, through the public API', () => {
    const probe = new Worldline(0, [], null, [gift])
    probe.advance(19)
    expect(probe.present.environment).toBe(0)
  })

  it('harvests nothing instead of throwing, once the population that year also leaves', () => {
    const probe = new Worldline(0, [], null, [gift])
    probe.advance(19)
    const departure: Crossing = {
      tick: 19,
      kind: 'people',
      dose: 3,
      amounts: [probe.present.population],
      origin: { world: 'donor', tick: 19 },
      cost: 0,
      direction: 'out',
    }
    const w = new Worldline(0, [], null, [gift, departure])
    w.advance(20)
    expect(w.present.population).toBe(0)
    for (const variable of VARIABLES) expect(Number.isFinite(w.present[variable])).toBe(true)
    // FEAT: o mesmo 0/0 vive em crowding; a entrada do ano 19 é o estado empurrado a zero.
    // foodSecurity pode ser +Infinity por desenho (ninguém para alimentar); NaN nunca é legítimo
    const entering = { ...probe.present, population: 0 }
    const emptyMetrics = worldMetrics(entering, w.world)
    for (const metric of METRICS) expect(Number.isNaN(emptyMetrics[metric])).toBe(false)

    // FEAT: o mesmo ano, mas sem a saída: gente contra sala nenhuma é a lotação máxima, não zero
    const crowded = worldMetrics(probe.present, probe.world)
    for (const metric of METRICS) expect(Number.isNaN(crowded[metric])).toBe(false)
    const epidemic = EVENTS.find((event) => event.id === 'epidemic')
    const crowdingTrigger = epidemic?.trigger.find((condition) => condition.metric === 'crowding')
    if (!crowdingTrigger) throw new Error('epidemic must trigger on crowding')
    expect(crowdingTrigger.op).toBe('>')
    expect(crowded.crowding).toBeGreaterThan(crowdingTrigger.value)
  })
})

describe('parameter invariants', () => {
  it('keeps the carrying-capacity factor positive, or crowding loses its sign in every world', () => {
    // FEAT: carryingCapacity = capacity * (1 - 1/(laborShare*y0)); se o fator virasse negativo,
    // crowding ficaria negativo em todo mundo com ambiente, e epidemic nunca mais dispararia
    expect(K.laborShare * K.y0).toBeGreaterThan(1)
  })
})
