import { describe, expect, it } from 'vitest'
import type { Crossing, CrossingKind } from './crossing.ts'
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

  it('takes the allocation of a doctrine crossing', () => {
    const allocation = { agriculture: 10, industry: 10, research: 70, conservation: 10 }
    const result = step(state, world, 0, undefined, [at('doctrine', [], { allocation })])
    expect(result.state.allocation).toEqual(allocation)
  })

  it('lands several crossings in the same year', () => {
    const result = step(state, world, 0, undefined, [
      at('knowledge', [50]),
      at('people', [1000]),
      at('knowledge', [50]),
    ])
    expect(result.state.echoes).toHaveLength(1)
    expect(result.state.population).toBeGreaterThan(state.population)
    expect(result.state.lastCrossing).toEqual({ tick: state.tick, kind: 'knowledge' })
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
