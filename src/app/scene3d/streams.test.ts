import { describe, expect, it } from 'vitest'
import { MAX_INTENSITY, MIN_INTENSITY, particleCounts, streamIntensity } from './streams.ts'

describe('particleCounts', () => {
  it('gives the focused world the largest share in whole strands', () => {
    const counts = particleCounts(30000, ['A', 'B', 'C'], 'B')
    expect((counts.get('B') ?? 0) > (counts.get('A') ?? 0)).toBe(true)
    for (const n of counts.values()) expect(n % 6).toBe(0)
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30000)
  })
})

describe('streamIntensity', () => {
  it('brightens sparse streams and dims dense ones, within bounds', () => {
    expect(streamIntensity(4000)).toBeGreaterThan(1)
    expect(streamIntensity(30000)).toBeLessThan(1)
    expect(streamIntensity(80000)).toBeLessThan(streamIntensity(30000))
    expect(streamIntensity(80000)).toBeGreaterThanOrEqual(MIN_INTENSITY)
    expect(streamIntensity(1)).toBeLessThanOrEqual(MAX_INTENSITY)
  })
})
