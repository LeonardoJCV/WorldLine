import { describe, expect, it } from 'vitest'
import { changedSectors, isValidAllocation } from './state.ts'

describe('isValidAllocation', () => {
  it('accepts whole percentages summing to 100', () => {
    expect(
      isValidAllocation({ agriculture: 40, industry: 30, research: 20, conservation: 10 }),
    ).toBe(true)
    expect(isValidAllocation({ agriculture: 100, industry: 0, research: 0, conservation: 0 })).toBe(
      true,
    )
  })

  it('rejects other sums, fractions and negatives', () => {
    expect(
      isValidAllocation({ agriculture: 40, industry: 30, research: 20, conservation: 9 }),
    ).toBe(false)
    expect(
      isValidAllocation({ agriculture: 40.5, industry: 29.5, research: 20, conservation: 10 }),
    ).toBe(false)
    expect(
      isValidAllocation({ agriculture: 110, industry: -10, research: 0, conservation: 0 }),
    ).toBe(false)
  })
})

describe('changedSectors', () => {
  it('lists sectors whose share changed, in sector order', () => {
    const before = { agriculture: 40, industry: 30, research: 20, conservation: 10 }
    const after = { agriculture: 30, industry: 30, research: 20, conservation: 20 }
    expect(changedSectors(before, after)).toEqual(['agriculture', 'conservation'])
  })
})
