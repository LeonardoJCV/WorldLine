import { describe, expect, it } from 'vitest'
import { colonyCost, type Colony } from './colony.ts'
import type { Crossing, CrossingKind } from './crossing.ts'
import type { Debt, Paradox } from './debt.ts'
import { EVENTS, worldMetrics } from './events.ts'
import { genesis } from './genesis.ts'
import { hashState } from './hash.ts'
import type { Merge } from './merge.ts'
import {
  COLONY_CAPACITY,
  COLONY_SEED_POP,
  COLONY_SELF,
  COLONY_UPKEEP,
  GENESIS_FOOD_RESERVE,
  INHERIT_ECONOMY,
  INHERIT_ENERGY,
  INHERIT_ENVIRONMENT,
  INHERIT_SHOCK,
  PARADOX_GRACE,
  PARADOX_PATIENCE,
  PARAMS,
} from './params.ts'
import { step } from './step.ts'
import { Era, VARIABLES, type Allocation, type Variable, type WorldState } from './state.ts'
import { colonisable, system, type Body } from './system.ts'
import { TEST_WORLD, makeState } from './testing.ts'

const { world, state } = genesis(482913)
const shift = { agriculture: 20, industry: 50, research: 20, conservation: 10 }

describe('step', () => {
  it('advances one year deterministically', () => {
    const a = step(state, world, 0)
    const b = step(state, world, 0)
    expect(a.state.tick).toBe(1)
    expect(hashState(a.state)).toBe(hashState(b.state))
  })

  it('applies a decision and remembers which sectors changed', () => {
    const { state: next } = step(state, world, 0, { tick: 0, allocation: shift })
    expect(next.allocation).toEqual(shift)
    expect(next.lastDecision).toEqual({ tick: 0, sectors: ['agriculture', 'industry'] })
  })

  it('rejects a decision for another year', () => {
    expect(() => step(state, world, 0, { tick: 5, allocation: shift })).toThrow(RangeError)
  })

  it('refuses to advance an extinct world', () => {
    expect(() => step({ ...state, status: 'extinct' }, world, 0)).toThrow()
  })

  it('applies an event only from the following year', () => {
    const ecologicalIndex = EVENTS.findIndex((d) => d.id === 'ecological_crisis')
    const degraded = { ...state, environment: 30 }
    const blocked = {
      ...degraded,
      lastEnded: degraded.lastEnded.map((v, i) => (i === ecologicalIndex ? degraded.tick : v)),
    }
    const fires = step(degraded, world, 0)
    const quiet = step(blocked, world, 0)
    expect(fires.started.map((r) => r.event)).toContain('ecological_crisis')
    expect(quiet.started.map((r) => r.event)).not.toContain('ecological_crisis')
    for (const variable of VARIABLES) expect(fires.state[variable]).toBe(quiet.state[variable])
  })

  it('ends the worldline on extinction', () => {
    const result = step({ ...state, population: 500 }, world, 0)
    expect(result.state.status).toBe('extinct')
    expect(result.started.map((r) => r.event)).toContain('extinction')
  })
})

describe('crossings', () => {
  const at = (kind: CrossingKind, amounts: number[], extra: Partial<Crossing> = {}): Crossing => ({
    tick: state.tick,
    kind,
    dose: 1,
    amounts,
    origin: { world: 'B', tick: 100 },
    cost: 3,
    direction: 'in',
    ...extra,
  })

  it('turns knowledge and resources into echoes instead of an instant jump', () => {
    const result = step(state, world, 0, undefined, [at('knowledge', [50])])
    expect(result.state.echoes).toEqual([{ target: 'technology', remaining: expect.any(Number) }])
    expect(result.state.technology).toBeLessThan(state.technology + 50)
    expect(result.state.technology).toBeGreaterThan(state.technology)
  })

  it('spreads a resource crossing over food and energy', () => {
    const result = step(state, world, 0, undefined, [at('resource', [200, 5])])
    expect(result.state.echoes.map((echo) => echo.target)).toEqual(['food', 'energy'])
  })

  it('moves people in and out in the same year', () => {
    const incoming = step(state, world, 0, undefined, [at('people', [1000])])
    const leaving = step(state, world, 0, undefined, [at('people', [1000], { direction: 'out' })])
    expect(incoming.state.population).toBeGreaterThan(leaving.state.population)
  })

  it('never lets a departure empty the world below zero', () => {
    const result = step(state, world, 0, undefined, [
      at('people', [state.population * 10], { direction: 'out' }),
    ])
    expect(result.state.population).toBeGreaterThanOrEqual(0)
  })

  it('keeps an emptied world finite even with no food left', () => {
    const empty = { ...state, food: 0 }
    const result = step(empty, world, 0, undefined, [
      at('people', [empty.population * 10], { direction: 'out' }),
    ])
    expect(result.state.population).toBe(0)
    for (const variable of VARIABLES) expect(result.state[variable]).toBeTypeOf('number')
    for (const variable of VARIABLES) expect(Number.isFinite(result.state[variable])).toBe(true)
  })

  it('takes the allocation of a doctrine crossing', () => {
    const allocation = { agriculture: 10, industry: 10, research: 70, conservation: 10 }
    const result = step(state, world, 0, undefined, [at('doctrine', [], { allocation })])
    expect(result.state.allocation).toEqual(allocation)
  })

  it('lands several crossings in the same year and keeps the last one', () => {
    const result = step(state, world, 0, undefined, [
      at('knowledge', [50]),
      at('knowledge', [50]),
      at('people', [1000]),
    ])
    expect(result.state.echoes).toHaveLength(1)
    expect(result.state.population).toBeGreaterThan(state.population)
    expect(result.state.lastCrossing).toEqual({ tick: state.tick, kind: 'people' })
  })

  it('remembers the last crossing for the causal chain', () => {
    const result = step(state, world, 0, undefined, [at('knowledge', [10])])
    expect(result.state.lastCrossing).toEqual({ tick: state.tick, kind: 'knowledge' })
  })

  it('rejects a crossing for another year', () => {
    expect(() => step(state, world, 0, undefined, [at('knowledge', [10], { tick: 5 })])).toThrow(
      RangeError,
    )
  })

  it('changes nothing when there is no crossing', () => {
    expect(step(state, world, 0, undefined, [])).toEqual(step(state, world, 0))
  })
})

describe('debt', () => {
  const at = (kind: CrossingKind, amounts: number[], extra: Partial<Crossing> = {}): Crossing => ({
    tick: state.tick,
    kind,
    dose: 1,
    amounts,
    origin: { world: 'B', tick: 100 },
    cost: 3,
    direction: 'in',
    ...extra,
  })

  it('a knowledge crossing enters the debt the same year it arrives', () => {
    const result = step(state, world, 0, undefined, [at('knowledge', [10])])
    expect(result.state.debts).toHaveLength(1)
    const debt = result.state.debts[0]
    expect(debt?.kind).toBe('knowledge')
    expect(debt?.origin).toBe('B')
    expect(debt?.since).toBe(state.tick)
    expect(debt?.owed).toBeGreaterThan(0)
    expect(debt?.owed).toBeLessThanOrEqual(3)
  })

  it('never charges people with a debt', () => {
    const result = step(state, world, 0, undefined, [at('people', [1000])])
    expect(result.state.debts).toEqual([])
  })

  it('shrinks on its own when the world researches; stays put when it does not', () => {
    const debts: readonly Debt[] = [{ kind: 'knowledge', owed: 5, since: 0, origin: 'B' }]
    const researching = {
      ...state,
      debts,
      allocation: { agriculture: 20, industry: 20, research: 60, conservation: 0 },
    }
    const idle = {
      ...state,
      debts,
      allocation: { agriculture: 60, industry: 20, research: 0, conservation: 20 },
    }
    const afterResearch = step(researching, world, 0)
    const afterIdle = step(idle, world, 0)
    expect(afterResearch.state.debts[0]?.owed ?? 0).toBeLessThan(5)
    expect(afterIdle.state.debts[0]?.owed).toBe(5)
  })

  it('leaves a debt-free world exactly as it was before the debt existed', () => {
    const result = step(state, world, 0)
    expect(result.state.debts).toEqual([])
    expect(result.state.paradox).toBeNull()
    expect(result.state.strain).toBe(0)
    expect(step(state, world, 0, undefined, [])).toEqual(result)
  })
})

describe('paradox and collapse', () => {
  const at = (kind: CrossingKind, amounts: number[], extra: Partial<Crossing> = {}): Crossing => ({
    tick: state.tick,
    kind,
    dose: 1,
    amounts,
    origin: { world: 'B', tick: 0 },
    cost: 3,
    direction: 'in',
    ...extra,
  })

  const heavy: Debt = { kind: 'knowledge', owed: 500, since: 0, origin: 'B' }
  const idle = { agriculture: 60, industry: 20, research: 0, conservation: 20 }

  it('installs a leap paradox the year a gift alone would unlock an era out of reach', () => {
    // FEAT: tecnologia já acima da porta industrial; só a energia falta, e o presente a vence sozinho
    const ready = { ...state, technology: 50, energy: 1, eras: 0 }
    const result = step(ready, world, 0, undefined, [at('resource', [1, 0.3])])
    expect(result.state.paradox).toEqual({ kind: 'leap', since: 0, deadline: PARADOX_GRACE })
  })

  it('leaves a gift alone when another condition of that era is still out of reach', () => {
    const early = { ...state, technology: 5, energy: 1, eras: 0 }
    const result = step(early, world, 0, undefined, [at('resource', [1, 0.3])])
    expect(result.state.paradox).toBeNull()
  })

  it('installs a circular paradox from the flag the host puts on the crossing', () => {
    const result = step(state, world, 0, undefined, [at('knowledge', [1], { circular: true })])
    expect(result.state.paradox).toEqual({ kind: 'circular', since: 0, deadline: PARADOX_GRACE })
  })

  it('installs nothing for people, flagged or not: they carry no debt to close a loop with', () => {
    const flagged = step(state, world, 0, undefined, [at('people', [1e7], { circular: true })])
    expect(flagged.state.paradox).toBeNull()
    expect(flagged.state.debts).toEqual([])
  })

  it('installs a debt paradox after PARADOX_PATIENCE years above the ratio', () => {
    const strained = {
      ...state,
      allocation: idle,
      debts: [heavy],
      strain: PARADOX_PATIENCE - 2,
    }
    const waiting = step(strained, world, 0)
    expect(waiting.state.paradox).toBeNull()
    expect(waiting.state.strain).toBe(PARADOX_PATIENCE - 1)

    const installed = step({ ...strained, strain: PARADOX_PATIENCE - 1 }, world, 0)
    expect(installed.state.paradox).toEqual({ kind: 'debt', since: 0, deadline: PARADOX_GRACE })
    expect(installed.started.map((r) => r.event)).toContain('paradox')
  })

  it('carries the strain counter from one year to the next and drops it once the debt clears', () => {
    const owing = { ...state, allocation: idle, debts: [heavy] }
    const first = step(owing, world, 0)
    expect(first.state.strain).toBe(1)
    const second = step({ ...owing, tick: first.state.tick, strain: first.state.strain }, world, 0)
    expect(second.state.strain).toBe(2)
    expect(step({ ...owing, debts: [], strain: 40 }, world, 0).state.strain).toBe(0)
  })

  it('dissolves the paradox and keeps the world alive when the debt clears before the deadline', () => {
    const nearly: Debt = { kind: 'knowledge', owed: 1e-9, since: 0, origin: 'B' }
    const installed: Paradox = { kind: 'leap', since: 0, deadline: PARADOX_GRACE }
    const result = step(
      { ...state, debts: [nearly], paradox: installed, strain: PARADOX_PATIENCE },
      world,
      0,
    )
    expect(result.state.paradox).toBeNull()
    expect(result.state.strain).toBe(0)
    expect(result.state.status).toBe('running')
  })

  it('collapses when the deadline passes with the debt still open', () => {
    const overdue: Paradox = { kind: 'debt', since: 0, deadline: 0 }
    const result = step(
      { ...state, allocation: idle, debts: [heavy], paradox: overdue, strain: PARADOX_PATIENCE },
      world,
      0,
    )
    expect(result.state.status).toBe('collapsed')
    expect(result.started.map((r) => r.event)).toContain('collapse')
  })

  it('tells a collapse apart from an extinction', () => {
    const overdue: Paradox = { kind: 'debt', since: 0, deadline: 0 }
    const doomed = {
      ...state,
      allocation: idle,
      debts: [heavy],
      paradox: overdue,
      strain: PARADOX_PATIENCE,
    }
    expect(step(doomed, world, 0).state.status).toBe('collapsed')
    expect(step({ ...doomed, population: 500 }, world, 0).state.status).toBe('extinct')
  })

  it('refuses to advance a collapsed world', () => {
    expect(() => step({ ...state, status: 'collapsed' }, world, 0)).toThrow()
  })
})

describe('colonies', () => {
  const free = system(TEST_WORLD.seed).filter(colonisable)
  const best = free.reduce((a, b) => (b.habitability > a.habitability ? b : a))
  const spacefaring = (overrides: Partial<WorldState> = {}): WorldState =>
    makeState({
      eras: Era.space,
      energy: 14,
      technology: 95,
      economy: 9,
      population: 4e6,
      food: 8e6,
      ...overrides,
    })
  const settled = (support: number): Colony[] =>
    free.map((body) => ({ body: body.index, founded: -50, population: 5000, support, record: 0 }))

  it('founds the first colony the year the world has energy to spare', () => {
    const result = step(spacefaring(), TEST_WORLD, 0)
    expect(result.state.colonies).toHaveLength(1)
    expect(result.state.colonies[0]?.founded).toBe(0)
    expect(result.state.colonies[0]?.body).toBe(best.index)
  })

  it('founds nothing in the very year the era opens: the door comes first', () => {
    const opening = step(spacefaring({ eras: 0 }), TEST_WORLD, 0)
    expect(opening.started.map((r) => r.event)).toContain('space_era')
    expect(opening.state.colonies).toEqual([])
    expect(opening.state.eras & Era.space).toBe(Era.space)
  })

  it('runs the year exactly as a grounded world would when there is nothing to spare', () => {
    const grounded = step({ ...state, eras: 0 }, world, 0)
    const reached = step({ ...state, eras: Era.space }, world, 0)
    expect(reached.state.colonies).toEqual([])
    expect({ ...reached.state, eras: grounded.state.eras }).toEqual(grounded.state)
  })

  it('charges the home world a flow, not a hoard, for every colony that cannot support itself', () => {
    const dear = step(spacefaring({ colonies: settled(0) }), TEST_WORLD, 0)
    const cheap = step(spacefaring({ colonies: settled(1) }), TEST_WORLD, 0)
    expect(dear.state.energy).toBeLessThan(cheap.state.energy)
    // FIX: o preço entra no alvo, então um ano cobra `rE` dele — não o preço inteiro do nível
    const price = colonyCost(dear.state.colonies) - colonyCost(cheap.state.colonies)
    expect(price).toBeGreaterThan(0)
    expect(cheap.state.energy - dear.state.energy).toBeCloseTo(PARAMS.rE * price, 6)
    expect(cheap.state.energy - dear.state.energy).toBeLessThan(COLONY_UPKEEP * free.length)
  })

  it('loses a colony that falls under the floor and leaves the world alone', () => {
    const dying: Colony = { body: best.index, founded: -50, population: 200, support: 0, record: 0 }
    const result = step(spacefaring({ energy: 9.5, colonies: [dying] }), TEST_WORLD, 0)
    expect(result.state.colonies).toEqual([])
  })

  it('takes people off the planet, and the planet is emptier for it', () => {
    const sized = (population: number): Colony[] =>
      free.map((body) => ({ body: body.index, founded: -50, population, support: 1, record: 0 }))
    const few = step(spacefaring({ colonies: sized(300) }), TEST_WORLD, 0)
    const many = step(spacefaring({ colonies: sized(2e4) }), TEST_WORLD, 0)
    expect(many.state.energy).toBe(few.state.energy)
    expect(many.state.population).toBeLessThan(few.state.population)
  })
})

describe('leaving the planet, end to end', () => {
  const SPACER: Allocation = { agriculture: 20, industry: 50, research: 30, conservation: 0 }
  const YEARS = 3000

  function run(grounded: boolean): { world: typeof world; state: WorldState } {
    const born = genesis(482913)
    let current: WorldState = { ...born.state, allocation: SPACER }
    let records = 0
    for (let year = 0; year < YEARS && current.status === 'running'; year++) {
      const input = grounded ? { ...current, eras: current.eras & ~Era.space } : current
      const result = step(input, born.world, records)
      records += result.started.length
      current = result.state
    }
    return { world: born.world, state: current }
  }

  const spaced = run(false)
  const stuck = run(true)

  it('reaches the space era and founds a colony', () => {
    expect(spaced.state.eras & Era.space).toBe(Era.space)
    expect(spaced.state.colonies.length).toBeGreaterThan(0)
    expect(stuck.state.colonies).toEqual([])
  })

  it('leaves fewer people on the home world than the same world that never left', () => {
    expect(spaced.state.population).toBeLessThan(stuck.state.population)
  })

  it('shows the relief in the crowding the engine already measures', () => {
    const left = worldMetrics(spaced.state, spaced.world).crowding
    const stayed = worldMetrics(stuck.state, stuck.world).crowding
    expect(left).toBeLessThan(stayed)
  })
})

describe('the events a colony writes', () => {
  const spaceIndex = EVENTS.findIndex((def) => def.id === 'space_era')
  const free = system(TEST_WORLD.seed).filter(colonisable)
  const best = free.reduce((a, b) => (b.habitability > a.habitability ? b : a))
  const reached = (overrides: Partial<WorldState> = {}): WorldState =>
    makeState({
      eras: Era.space,
      energy: 14,
      technology: 95,
      economy: 9,
      population: 4e6,
      food: 8e6,
      active: [{ def: spaceIndex, record: 9, start: 0 }],
      ...overrides,
    })

  it('writes the founding down, and hangs it on the era that opened the door', () => {
    const result = step(reached(), TEST_WORLD, 12)
    const founding = result.started.find((record) => record.event === 'colony_founded')
    expect(founding).toEqual({
      event: 'colony_founded',
      start: 0,
      end: 0,
      causes: [{ kind: 'event', record: 9 }],
    })
    expect(result.state.colonies[0]?.record).toBe(12)
  })

  it('writes the loss down, pointing back at the founding it undoes', () => {
    const doomedColony: Colony = {
      body: best.index,
      founded: -50,
      population: 200,
      support: 0,
      record: 6,
    }
    const result = step(reached({ energy: 9.5, colonies: [doomedColony] }), TEST_WORLD, 20)
    expect(result.state.colonies).toEqual([])
    expect(result.started.find((record) => record.event === 'colony_lost')).toEqual({
      event: 'colony_lost',
      start: 0,
      end: 0,
      causes: [{ kind: 'event', record: 6 }],
    })
  })

  it('leaves both moments out of a world that never left the planet', () => {
    const grounded = step({ ...state, eras: 0 }, world, 0)
    expect(grounded.started.map((record) => record.event)).not.toContain('colony_founded')
    expect(grounded.started.map((record) => record.event)).not.toContain('colony_lost')
  })
})

describe('inheritance', () => {
  // FEAT: o sistema da semente 482913 tem um corpo que comporta uma colônia do tamanho de um herdeiro
  const free = system(world.seed).filter(colonisable)
  const best = free.reduce((a, b) => (b.habitability > a.habitability ? b : a))
  const standing = (overrides: Partial<Colony> = {}): Colony => ({
    body: best.index,
    founded: 100,
    population: 5e5,
    support: 1,
    record: 4,
    ...overrides,
  })
  // FEAT: energia sem folga nenhuma, para o ano do fim ser só o ano do fim: nada se funda nele
  const doomed = (colonies: readonly Colony[], overrides: Partial<WorldState> = {}): WorldState =>
    makeState({
      tick: 2400,
      eras: Era.space,
      energy: 9,
      technology: 95,
      economy: 9,
      population: 500,
      food: 1e6,
      colonies,
      ...overrides,
    })
  const events = (result: ReturnType<typeof step>) => result.started.map((record) => record.event)

  it('ends the history exactly as it does today when no colony stands on its own', () => {
    const alone = step(doomed([]), world, 0)
    const young = step(doomed([standing({ population: 1000 })]), world, 0)
    const failing = step(doomed([standing({ support: 0.5 })]), world, 0)
    for (const result of [alone, young, failing]) {
      expect(result.state.status).toBe('extinct')
      expect(events(result)).toContain('extinction')
      expect(events(result)).not.toContain('inheritance')
      expect(result.state.home).toBeNull()
    }
  })

  it('continues the history on the colony that stands on its own', () => {
    // FEAT: a mesma gente de menos um, o mesmo ano no mundo natal, e nenhum herdeiro: a régua
    const lacking = step(doomed([standing({ population: COLONY_SEED_POP / 2 })]), world, 0)
    const result = step(doomed([standing()]), world, 0)
    const moved = result.state
    expect(moved.status).toBe('running')
    expect(events(result)).toContain('extinction')
    expect(events(result)).toContain('inheritance')
    // FEAT: a gente é a da colônia, contada depois do ano dela
    expect(moved.population).toBeGreaterThan(5e5)
    expect(lacking.state.status).toBe('extinct')
    expect(moved.technology).toBe(lacking.state.technology)
    expect(moved.environment).toBeCloseTo(INHERIT_ENVIRONMENT * best.habitability, 9)
    expect(moved.stability).toBeCloseTo(lacking.state.stability - INHERIT_SHOCK, 9)
    expect(moved.food).toBeCloseTo(moved.population * GENESIS_FOOD_RESERVE, 6)
    expect(moved.energy).toBe(INHERIT_ENERGY)
    expect(moved.economy).toBe(INHERIT_ECONOMY)
    expect(moved.colonies).toEqual([])
    expect(moved.home).toBe(best.index)
  })

  it('reads the heir in the year the world ends, not in the year it first stood alone', () => {
    // FEAT: uma colônia que cruza o limiar no próprio ano do fim ainda herda
    const late = step(doomed([standing({ population: COLONY_SEED_POP - 1 })]), world, 0)
    expect(late.state.status).toBe('running')
    // FEAT: e uma que já esteve de pé, mas perdeu o sustento no caminho, não herda
    const faded = step(doomed([standing({ support: COLONY_SELF - 0.05 })]), world, 0)
    expect(faded.state.status).toBe('extinct')
  })

  it('saves a collapsing world as readily as a dying one, and takes the paradox off it', () => {
    const idle: Allocation = { agriculture: 40, industry: 60, research: 0, conservation: 0 }
    const heavy: Debt = { kind: 'knowledge', owed: 40, since: 0, origin: 'B' }
    const overdue: Paradox = { kind: 'debt', since: 0, deadline: 0 }
    const falling = (colonies: readonly Colony[]) =>
      doomed(colonies, {
        population: 4e6,
        allocation: idle,
        debts: [heavy],
        paradox: overdue,
        strain: PARADOX_PATIENCE,
      })
    expect(step(falling([]), world, 0).state.status).toBe('collapsed')
    const result = step(falling([standing()]), world, 0)
    expect(events(result)).toContain('collapse')
    expect(result.state.status).toBe('running')
    expect(result.state.paradox).toBeNull()
    expect(result.state.strain).toBe(0)
  })

  it('lands the moment in the year the world ended, and reaches back to the founding', () => {
    const result = step(doomed([standing({ record: 4 })]), world, 7)
    const moment = result.started.at(-1)
    const terminal = result.started.findIndex((record) => record.event === 'extinction')
    expect(moment?.event).toBe('inheritance')
    expect(moment?.start).toBe(2400)
    expect(moment?.end).toBe(2400)
    expect(moment?.causes).toEqual([
      { kind: 'event', record: 7 + terminal },
      { kind: 'event', record: 4 },
    ])
  })

  // FEAT: a semente 5 tem dois corpos que comportam um herdeiro, então a segunda herança é possível
  const twin = genesis(5)
  const pair = system(twin.world.seed)
    .filter(colonisable)
    .filter((body) => COLONY_CAPACITY * body.habitability >= COLONY_SEED_POP)
    .sort((a, b) => b.habitability - a.habitability)
  const richer = pair[0] as Body
  const poorer = pair[1] as Body
  const settler = (body: number, record: number, population = 5e5): Colony => ({
    body,
    founded: 100,
    population,
    support: 1,
    record,
  })
  const doomedTwin = (
    colonies: readonly Colony[],
    overrides: Partial<WorldState> = {},
  ): WorldState =>
    makeState({
      tick: 2400,
      eras: Era.space,
      energy: 9,
      technology: 95,
      economy: 9,
      population: 500,
      food: 1e6,
      colonies,
      ...overrides,
    })

  it('loses the sibling colonies with the world that paid for them, and writes each loss down', () => {
    expect(pair).toHaveLength(2)
    const result = step(
      doomedTwin([settler(richer.index, 4), settler(poorer.index, 6, 3e5)]),
      twin.world,
      30,
    )
    expect(events(result)).toContain('inheritance')
    expect(result.state.home).toBe(richer.index)
    expect(result.state.colonies).toEqual([])
    // FEAT: só a irmã se perde; a herdeira não é uma colônia perdida, é a casa nova
    expect(result.started.filter((record) => record.event === 'colony_lost')).toEqual([
      { event: 'colony_lost', start: 2400, end: 2400, causes: [{ kind: 'event', record: 6 }] },
    ])
  })

  it('happens once for each world that ends, and the body left behind never becomes home again', () => {
    const moved = step(doomedTwin([settler(richer.index, 4)]), twin.world, 0)
    expect(moved.started.filter((record) => record.event === 'inheritance')).toHaveLength(1)
    expect(moved.state.home).toBe(richer.index)

    let current = moved.state
    let records = moved.started.length
    for (let year = 0; year < 300 && current.status === 'running'; year++) {
      const result = step(current, twin.world, records)
      records += result.started.length
      const seen = result.started.map((record) => record.event)
      const moves = seen.filter((event) => event === 'inheritance')
      // FEAT: a história só muda de casa no ano em que um mundo acaba, e nunca duas vezes num ano
      expect(moves.length).toBeLessThanOrEqual(1)
      if (moves.length === 1) {
        expect(seen.some((event) => event === 'extinction' || event === 'collapse')).toBe(true)
      }
      current = result.state
      expect(current.colonies.some((colony) => colony.body === richer.index)).toBe(false)
    }
    expect(current.status).toBe('running')
    expect(current.home).toBe(richer.index)

    // FEAT: sobreviver a um mundo não gasta o direito de sobreviver ao seguinte
    const again = step(
      doomedTwin([settler(poorer.index, 9, 3e5)], { home: richer.index }),
      twin.world,
      0,
    )
    expect(again.started.filter((record) => record.event === 'inheritance')).toHaveLength(1)
    expect(again.state.status).toBe('running')
    expect(again.state.home).toBe(poorer.index)
  })
})

describe('step, with a merge', () => {
  const config = TEST_WORLD
  const running = (overrides: Partial<WorldState> = {}): WorldState => makeState(overrides)

  function debt(overrides: Partial<Debt> = {}): Debt {
    return { kind: 'resource', owed: 10, since: 0, origin: 'C', ...overrides }
  }

  function mergeIn(values: Partial<Record<Variable, number>>, rest: Partial<Merge> = {}): Merge {
    const full = {} as Record<Variable, number>
    for (const variable of VARIABLES) full[variable] = values[variable] ?? 0
    return { tick: 0, self: 'A', other: 'B', direction: 'in', natal: 0, values: full, ...rest }
  }

  function mergeOut(rest: Partial<Merge> = {}): Merge {
    return { tick: 0, self: 'A', other: 'B', direction: 'out', natal: 0, ...rest }
  }

  it('seams the other history in and keeps running', () => {
    const result = step(
      running({ population: 3_000_000 }),
      config,
      0,
      undefined,
      [],
      mergeIn({ population: 1_000_000 }),
    )
    expect(result.state.status).toBe('running')
    expect(result.state.lastMerge?.tick).toBe(running().tick)
    expect(result.started.map((r) => r.event)).toContain('merge')
  })

  it('ends the history that flows away, and says so in its own record', () => {
    const result = step(running(), config, 0, undefined, [], mergeOut())
    expect(result.state.status).toBe('merged')
    expect(result.started.map((r) => r.event)).toContain('merged_away')
  })

  it('records a settlement only when there was mutual debt to settle', () => {
    const withMutual = step(
      running({ debts: [debt({ owed: 40, origin: 'B' })] }),
      config,
      0,
      undefined,
      [],
      mergeIn({}, { other: 'B' }),
    )
    expect(withMutual.started.map((r) => r.event)).toContain('debt_settled')
    const without = step(
      running({ debts: [] }),
      config,
      0,
      undefined,
      [],
      mergeIn({}, { other: 'B' }),
    )
    expect(without.started.map((r) => r.event)).not.toContain('debt_settled')
  })

  it('refuses a merge dated in another year, like it refuses a crossing', () => {
    expect(() =>
      step(running({ tick: 1000 }), config, 0, undefined, [], mergeIn({}, { tick: 999 })),
    ).toThrow(RangeError)
  })

  it('never runs a year on a history that already flowed away', () => {
    const merged = step(running(), config, 0, undefined, [], mergeOut()).state
    expect(() => step(merged, config, 0)).toThrow()
  })

  it('points the causal chain at the other history by name', () => {
    const result = step(running(), config, 0, undefined, [], mergeIn({}, { other: 'C' }))
    const record = result.started.find((r) => r.event === 'merge')
    expect(record?.causes).toContainEqual({ kind: 'merge', tick: running().tick, other: 'C' })
  })

  it('leaves a year without a merge byte-identical to before', () => {
    // FEAT: a prova de que o parâmetro novo é inerte quando ninguém mescla
    const plain = step(running(), config, 0)
    const withUndefined = step(running(), config, 0, undefined, [], undefined)
    expect(hashState(withUndefined.state)).toBe(hashState(plain.state))
  })
})
