import { describe, expect, it } from 'vitest'
import { causalDistance, profile } from './distance.ts'
import { genesis } from './genesis.ts'
import { Worldline } from './worldline.ts'

const base = genesis(482913).state

describe('causalDistance', () => {
  it('is zero for identical states', () => {
    expect(causalDistance(base, base)).toBe(0)
  })

  it('is symmetric and bounded', () => {
    const w = new Worldline(482913, [
      { tick: 0, allocation: { agriculture: 25, industry: 60, research: 15, conservation: 0 } },
    ])
    w.advance(1200)
    const d = causalDistance(base, w.present)
    expect(d).toBe(causalDistance(w.present, base))
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThanOrEqual(1)
  })

  it('weighs each of the seven normalized quantities equally', () => {
    const low = { ...base, technology: 0 }
    const high = { ...base, technology: 100 }
    expect(causalDistance(low, high)).toBeCloseTo(Math.sqrt(1 / 7), 12)
  })
})

describe('profile', () => {
  it('maps every quantity into 0..1', () => {
    for (const value of profile({ ...base, energy: 99, stability: -5 })) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(profile({ ...base, population: 1e8 })[0]).toBeCloseTo(1, 12)
  })
})
