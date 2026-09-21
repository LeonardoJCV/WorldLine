import { describe, expect, it } from 'vitest'
import { particleCounts } from './streams.ts'

describe('particleCounts', () => {
  it('gives the focused world the largest share in whole strands', () => {
    const counts = particleCounts(30000, ['A', 'B', 'C'], 'B')
    expect((counts.get('B') ?? 0) > (counts.get('A') ?? 0)).toBe(true)
    for (const n of counts.values()) expect(n % 6).toBe(0)
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30000)
  })
})
