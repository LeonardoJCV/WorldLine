import { describe, expect, it } from 'vitest'
import { colonisable, system, type Body } from './system.ts'

const SEEDS = Array.from({ length: 300 }, (_, i) => (i * 7919) >>> 0)

describe('system', () => {
  it('is a pure function of the seed', () => {
    expect(system(482913)).toEqual(system(482913))
  })

  it('varies with the seed', () => {
    expect(system(1)).not.toEqual(system(2))
  })

  it('rejects invalid seeds', () => {
    expect(() => system(-1)).toThrow(RangeError)
    expect(() => system(1.5)).toThrow(RangeError)
    expect(() => system(2 ** 32)).toThrow(RangeError)
  })

  it('places between four and six bodies', () => {
    for (const seed of SEEDS) {
      const bodies = system(seed)
      expect(bodies.length).toBeGreaterThanOrEqual(4)
      expect(bodies.length).toBeLessThanOrEqual(6)
    }
  })

  it('gives every body its own index, in order', () => {
    for (const seed of SEEDS) {
      const bodies = system(seed)
      bodies.forEach((body, i) => expect(body.index).toBe(i))
    }
  })

  it('has exactly one home body', () => {
    for (const seed of SEEDS) {
      const bodies = system(seed)
      expect(bodies.filter((b) => b.home).length).toBe(1)
    }
  })

  it('keeps distances strictly increasing and distinct', () => {
    for (const seed of SEEDS) {
      const bodies = system(seed)
      for (let i = 1; i < bodies.length; i++) {
        const prev = bodies[i - 1] as Body
        const curr = bodies[i] as Body
        expect(curr.distance).toBeGreaterThan(prev.distance)
      }
    }
  })

  it('keeps habitability inside [0,1] and zero for gas giants', () => {
    for (const seed of SEEDS) {
      for (const body of system(seed)) {
        expect(body.habitability).toBeGreaterThanOrEqual(0)
        expect(body.habitability).toBeLessThanOrEqual(1)
        if (body.kind === 'gas') expect(body.habitability).toBe(0)
      }
    }
  })

  it('gives the home body the highest habitability', () => {
    for (const seed of SEEDS) {
      const bodies = system(seed)
      const home = bodies.find((b) => b.home) as Body
      for (const body of bodies) {
        if (body === home) continue
        expect(home.habitability).toBeGreaterThan(body.habitability)
      }
    }
  })

  it('never makes the home body a gas giant', () => {
    for (const seed of SEEDS) {
      const home = system(seed).find((b) => b.home) as Body
      expect(home.kind).not.toBe('gas')
    }
  })
})

describe('colonisable', () => {
  it('is false for gas giants', () => {
    for (const seed of SEEDS) {
      for (const body of system(seed)) {
        if (body.kind === 'gas') expect(colonisable(body)).toBe(false)
      }
    }
  })

  it('is false for the home body', () => {
    for (const seed of SEEDS) {
      const home = system(seed).find((b) => b.home) as Body
      expect(colonisable(home)).toBe(false)
    }
  })

  it('is true for a rocky or icy body that is not home', () => {
    for (const seed of SEEDS) {
      for (const body of system(seed)) {
        if (body.kind !== 'gas' && !body.home) expect(colonisable(body)).toBe(true)
      }
    }
  })
})
