import { describe, expect, it } from 'vitest'
import type { Crossing, CrossingKind } from './crossing.ts'
import type { Debt } from './debt.ts'
import { EVENTS } from './events.ts'
import { genesis } from './genesis.ts'
import { hashState } from './hash.ts'
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
    expect(step(state, world, 0, undefined, [])).toEqual(result)
  })
})
