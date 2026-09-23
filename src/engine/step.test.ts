import { describe, expect, it } from 'vitest'
import type { Crossing, CrossingKind } from './crossing.ts'
import type { Debt, Paradox } from './debt.ts'
import { EVENTS } from './events.ts'
import { genesis } from './genesis.ts'
import { hashState } from './hash.ts'
import { PARADOX_GRACE, PARADOX_PATIENCE } from './params.ts'
import { step } from './step.ts'
import { VARIABLES } from './state.ts'

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
