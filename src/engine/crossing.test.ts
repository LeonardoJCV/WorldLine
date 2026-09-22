import { describe, expect, it } from 'vitest'
import {
  credit,
  crossingAmounts,
  crossingCost,
  validateCrossings,
  type Crossing,
} from './crossing.ts'
import { genesis } from './genesis.ts'

const origin = genesis(482913).state

describe('crossingCost', () => {
  it('grows with the base, the dose and the causal distance', () => {
    expect(crossingCost('doctrine', 1, 0)).toBe(1)
    expect(crossingCost('knowledge', 3, 0)).toBe(9)
    expect(crossingCost('knowledge', 3, 1)).toBe(18)
    expect(crossingCost('resource', 2, 0.25)).toBe(5)
  })

  it('never returns less than one', () => {
    expect(crossingCost('doctrine', 1, 0)).toBeGreaterThanOrEqual(1)
  })
})

describe('crossingAmounts', () => {
  it('scales with the dose and the origin', () => {
    const small = crossingAmounts('knowledge', 1, origin)
    const large = crossingAmounts('knowledge', 3, origin)
    expect(large[0]).toBeCloseTo((small[0] ?? 0) * 3, 6)
    expect(small[0]).toBeCloseTo(0.08 * origin.technology, 6)
  })

  it('sends two parcels for resources and none for doctrine', () => {
    expect(crossingAmounts('resource', 1, origin)).toHaveLength(2)
    expect(crossingAmounts('doctrine', 1, origin)).toHaveLength(0)
    expect(crossingAmounts('people', 2, origin)[0]).toBeCloseTo(2 * 0.05 * origin.population, 6)
  })

  it('stays finite and never negative', () => {
    const broken = { ...origin, technology: NaN, population: -1 }
    for (const value of crossingAmounts('knowledge', 3, broken)) expect(value).toBe(0)
    for (const value of crossingAmounts('people', 3, broken)) expect(value).toBe(0)
  })
})

describe('credit', () => {
  it('grows with living worlds and with history', () => {
    expect(credit([{ tick: 0, ended: false, spent: 0 }])).toBe(2)
    expect(credit([{ tick: 2000, ended: false, spent: 0 }])).toBe(4)
    expect(
      credit([
        { tick: 1000, ended: false, spent: 0 },
        { tick: 1000, ended: false, spent: 0 },
      ]),
    ).toBe(6)
  })

  it('ignores extinct worlds for the count but keeps their history and their spending', () => {
    expect(
      credit([
        { tick: 1000, ended: false, spent: 3 },
        { tick: 1000, ended: true, spent: 2 },
      ]),
    ).toBe(2 + 0 + 2 - 5)
  })
})

describe('validateCrossings', () => {
  const one: Crossing = {
    tick: 10,
    kind: 'knowledge',
    dose: 1,
    amounts: [4],
    origin: { world: 'B', tick: 40 },
    cost: 3,
    direction: 'in',
  }

  it('copies a sorted list', () => {
    const list = validateCrossings([one])
    expect(list).toEqual([one])
    expect(list[0]).not.toBe(one)
  })

  it('refuses years out of order, outside the horizon, and broken amounts', () => {
    expect(() => validateCrossings([one, { ...one, tick: 5 }])).toThrow(RangeError)
    expect(() => validateCrossings([{ ...one, tick: 10_000 }])).toThrow(RangeError)
    expect(() => validateCrossings([{ ...one, amounts: [NaN] }])).toThrow(RangeError)
    expect(() => validateCrossings([{ ...one, amounts: [-1] }])).toThrow(RangeError)
    expect(() => validateCrossings([{ ...one, kind: 'resource', amounts: [1] }])).toThrow(
      RangeError,
    )
    expect(() => validateCrossings([{ ...one, direction: 'out' }])).toThrow(RangeError)
  })

  it('accepts two crossings in the same year', () => {
    expect(validateCrossings([one, { ...one, kind: 'people', amounts: [10] }])).toHaveLength(2)
  })
})
