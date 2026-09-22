import { describe, expect, it } from 'vitest'
import { cityName, cityNames } from './names.ts'

describe('cityName', () => {
  it('is deterministic and pronounceable', () => {
    expect(cityName(482913, 0)).toBe(cityName(482913, 0))
    for (let site = 0; site < 48; site++) {
      const name = cityName(482913, site)
      expect(name).toMatch(/^[A-Z][a-z]{3,11}$/)
    }
  })

  it('changes with the seed and the site', () => {
    expect(cityName(482913, 0)).not.toBe(cityName(7, 0))
    expect(cityName(482913, 0)).not.toBe(cityName(482913, 1))
  })
})

describe('cityNames', () => {
  it('names every site of a world without repeats', () => {
    for (const seed of [1, 2, 3, 482913]) {
      const names = cityNames(seed, 48)
      expect(names).toHaveLength(48)
      expect(new Set(names).size).toBe(48)
      expect(names[0]).toBe(cityName(seed, 0))
    }
  })
})
