import { describe, expect, it } from 'vitest'
import { fbm, hash3, valueNoise } from './noise.ts'

describe('noise', () => {
  it('hashes lattice points deterministically into [0, 1)', () => {
    expect(hash3(7, 1, 2, 3)).toBe(hash3(7, 1, 2, 3))
    expect(hash3(7, 1, 2, 3)).not.toBe(hash3(8, 1, 2, 3))
    for (let i = -50; i < 50; i++) {
      const h = hash3(3, i, -i, i * 7)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(1)
    }
  })

  it('interpolates smoothly between lattice points', () => {
    expect(valueNoise(5, 2, 3, 4)).toBeCloseTo(hash3(5, 2, 3, 4), 12)
    const a = valueNoise(5, 2.5, 3.5, 4.5)
    const b = valueNoise(5, 2.5001, 3.5, 4.5)
    expect(Math.abs(a - b)).toBeLessThan(0.01)
  })

  it('sums octaves into a bounded value', () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(11, i * 0.37, i * 0.11, i * 0.53, 6)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
