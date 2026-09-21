import { describe, expect, it } from 'vitest'
import { EVENTS } from './events.ts'
import { genesis } from './genesis.ts'
import { DEFAULT_ALLOCATION, GENESIS_RANGES } from './params.ts'
import { NEVER } from './state.ts'

describe('genesis', () => {
  it('is a pure function of the seed', () => {
    expect(genesis(482913)).toEqual(genesis(482913))
  })

  it('varies with the seed', () => {
    expect(genesis(1).state.population).not.toBe(genesis(2).state.population)
  })

  it('keeps initial conditions inside the documented ranges', () => {
    const inside = (value: number, [min, max]: readonly [number, number]) =>
      value >= min && value <= max
    for (let i = 0; i < 500; i++) {
      const { world, state } = genesis((i * 7919) >>> 0)
      expect(inside(state.population, GENESIS_RANGES.population)).toBe(true)
      expect(inside(state.technology, GENESIS_RANGES.technology)).toBe(true)
      expect(inside(state.environment, GENESIS_RANGES.environment)).toBe(true)
      expect(inside(state.energy, GENESIS_RANGES.energy)).toBe(true)
      expect(inside(world.fertility, GENESIS_RANGES.fertility)).toBe(true)
    }
  })

  it('starts at year zero with no history', () => {
    const { state } = genesis(7)
    expect(state.tick).toBe(0)
    expect(state.allocation).toEqual(DEFAULT_ALLOCATION)
    expect(state.active).toEqual([])
    expect(state.eras).toBe(0)
    expect(state.lastEnded).toEqual(EVENTS.map(() => NEVER))
    expect(state.recentEconomy).toEqual([1, 1, 1, 1, 1])
    expect(state.status).toBe('running')
  })

  it('rejects invalid seeds', () => {
    expect(() => genesis(-1)).toThrow(RangeError)
    expect(() => genesis(1.5)).toThrow(RangeError)
    expect(() => genesis(2 ** 32)).toThrow(RangeError)
  })
})
