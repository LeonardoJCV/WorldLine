import { describe, expect, it } from 'vitest'
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
