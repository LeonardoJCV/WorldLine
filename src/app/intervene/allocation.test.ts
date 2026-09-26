import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ALLOCATION } from '../../engine/params.ts'
import { SECTORS, isValidAllocation, type Allocation } from '../../engine/state.ts'
import { rebalance, sameAllocation } from './allocation.ts'

const allocation = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
  )
  .map((cuts): Allocation => {
    const [a, b, c, d] = [...cuts].sort((x, y) => x - y) as [number, number, number, number]
    return {
      agriculture: a,
      industry: b - a,
      research: c - b,
      conservation: d - c,
      works: 100 - d,
    }
  })

describe('rebalance', () => {
  it('always yields whole percentages summing to 100 with the chosen value', () => {
    fc.assert(
      fc.property(
        allocation,
        fc.constantFrom(...SECTORS),
        fc.integer({ min: -20, max: 120 }),
        (start, sector, value) => {
          const next = rebalance(start, sector, value)
          return isValidAllocation(next) && next[sector] === Math.min(100, Math.max(0, value))
        },
      ),
    )
  })

  it('keeps the other sectors in proportion', () => {
    expect(
      rebalance(
        { agriculture: 40, industry: 25, research: 20, conservation: 10, works: 5 },
        'agriculture',
        70,
      ),
    ).toEqual({ agriculture: 70, industry: 13, research: 10, conservation: 5, works: 2 })
  })

  it('redistributes into and out of the works sector like any other', () => {
    const next = rebalance(DEFAULT_ALLOCATION, 'works', 25)
    expect(next.works).toBe(25)
    expect(SECTORS.reduce((total, sector) => total + next[sector], 0)).toBe(100)
  })

  it('splits evenly when the other sectors are empty', () => {
    expect(
      rebalance(
        { agriculture: 100, industry: 0, research: 0, conservation: 0, works: 0 },
        'agriculture',
        40,
      ),
    ).toEqual({ agriculture: 40, industry: 15, research: 15, conservation: 15, works: 15 })
  })
})

describe('sameAllocation', () => {
  it('compares every sector', () => {
    const a = { agriculture: 40, industry: 25, research: 20, conservation: 10, works: 5 }
    expect(sameAllocation(a, { ...a })).toBe(true)
    expect(sameAllocation(a, { ...a, research: 19, conservation: 11 })).toBe(false)
  })
})
