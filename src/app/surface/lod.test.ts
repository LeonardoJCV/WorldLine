import { describe, expect, it } from 'vitest'
import { ALTITUDE, LEVEL_ALTITUDE, levelOf } from './camera.ts'
import { BUDGET, focalPixels, lodOf } from './lod.ts'

describe('lodOf', () => {
  it('caches at least one and a half budgets of chunks', () => {
    for (const tier of ['low', 'high', 'ultra'] as const) {
      expect(lodOf(tier).cached).toBeGreaterThanOrEqual(BUDGET[tier] * 1.5)
    }
  })

  it('keeps the low tier camera above what its depth resolves', () => {
    expect(lodOf('high').minAltitude).toBe(ALTITUDE.min)
    expect(lodOf('ultra').minAltitude).toBe(ALTITUDE.min)
    expect(lodOf('low').minAltitude).toBeGreaterThan(ALTITUDE.min * 4)
    expect(lodOf('high').regionAltitude).toBe(LEVEL_ALTITUDE.region)
    expect(lodOf('low').regionAltitude).toBeGreaterThan(LEVEL_ALTITUDE.region)
    for (const tier of ['low', 'high', 'ultra'] as const) {
      expect(levelOf(lodOf(tier).regionAltitude)).toBe('region')
    }
  })
})

describe('focalPixels', () => {
  it('turns the viewport height into pixels per unit at distance one', () => {
    expect(focalPixels(900, 90)).toBeCloseTo(450, 9)
  })
})
