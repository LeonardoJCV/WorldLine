import { describe, expect, it } from 'vitest'
import { clamp, exp, ln, pow, smoothstep } from './math.ts'

const relativeError = (actual: number, expected: number) =>
  Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.MIN_VALUE)

describe('exp', () => {
  it('matches the native implementation across the finite range', () => {
    let worst = 0
    for (let x = -700; x <= 709.7; x += 0.731)
      worst = Math.max(worst, relativeError(exp(x), Math.exp(x)))
    expect(worst).toBeLessThan(1e-14)
  })

  it('handles the edges', () => {
    expect(exp(0)).toBe(1)
    expect(relativeError(exp(709.7), Math.exp(709.7))).toBeLessThan(1e-14)
    expect(exp(710)).toBe(Infinity)
    expect(exp(-746)).toBe(0)
    expect(exp(NaN)).toBeNaN()
  })
})

describe('ln', () => {
  it('matches the native implementation from tiny to huge values', () => {
    for (let x = 1e-300; x < 1e300; x *= 1.37) {
      const tolerance = 1e-14 * Math.max(1, Math.abs(Math.log(x)))
      expect(Math.abs(ln(x) - Math.log(x))).toBeLessThanOrEqual(tolerance)
    }
  })

  it('is precise near one', () => {
    expect(relativeError(ln(1 + 1e-10), Math.log(1 + 1e-10))).toBeLessThan(1e-12)
    expect(ln(1)).toBe(0)
  })

  it('handles the edges', () => {
    expect(ln(0)).toBe(-Infinity)
    expect(ln(-1)).toBeNaN()
    expect(ln(Infinity)).toBe(Infinity)
    expect(relativeError(ln(5e-324), Math.log(5e-324))).toBeLessThan(1e-14)
  })

  it('inverts exp', () => {
    for (let x = -50; x <= 50; x += 0.37) expect(ln(exp(x))).toBeCloseTo(x, 12)
  })
})

describe('pow', () => {
  it('matches the native implementation for the exponents the model uses', () => {
    for (const base of [0.001, 0.2, 1, 1.7, 12, 3500]) {
      for (const exponent of [0.3, 0.4, 1.5, 2]) {
        expect(relativeError(pow(base, exponent), Math.pow(base, exponent))).toBeLessThan(1e-13)
      }
    }
  })

  it('handles the edges', () => {
    expect(pow(5, 0)).toBe(1)
    expect(pow(0, 0.4)).toBe(0)
    expect(pow(-1, 0.5)).toBeNaN()
  })
})

describe('smoothstep', () => {
  it('ramps from 0 to 1 between the edges', () => {
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 0.5)).toBe(0.5)
    expect(smoothstep(0, 1, 2)).toBe(1)
  })

  it('supports descending edges', () => {
    expect(smoothstep(0.9, 0.7, 0.95)).toBe(0)
    expect(smoothstep(0.9, 0.7, 0.8)).toBeCloseTo(0.5, 12)
    expect(smoothstep(0.9, 0.7, 0.6)).toBe(1)
  })
})

describe('clamp', () => {
  it('limits values to the interval', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})
