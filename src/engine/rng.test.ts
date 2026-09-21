import { describe, expect, it } from 'vitest'
import { Channel, uniform } from './rng.ts'

function correlation(a: number[], b: number[]): number {
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
  const ma = mean(a)
  const mb = mean(b)
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < a.length; i++) {
    const da = (a[i] ?? 0) - ma
    const db = (b[i] ?? 0) - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  return cov / Math.sqrt(va * vb)
}

describe('uniform', () => {
  it('is a pure function of seed, tick and channel', () => {
    expect(uniform(42, 7, Channel.harvest)).toBe(uniform(42, 7, Channel.harvest))
  })

  it('changes with every coordinate', () => {
    const base = uniform(42, 7, Channel.harvest)
    expect(uniform(43, 7, Channel.harvest)).not.toBe(base)
    expect(uniform(42, 8, Channel.harvest)).not.toBe(base)
    expect(uniform(42, 7, Channel.harvest + 1)).not.toBe(base)
  })

  it('stays in [0, 1) and spreads evenly', () => {
    const buckets = new Array<number>(10).fill(0)
    let min = 1
    let max = 0
    for (let tick = 0; tick < 100_000; tick++) {
      const u = uniform(482913, tick, Channel.harvest)
      min = Math.min(min, u)
      max = Math.max(max, u)
      const bucket = Math.floor(u * 10)
      buckets[bucket] = (buckets[bucket] ?? 0) + 1
    }
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThan(1)
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThan(400)
  })

  it('keeps channels and neighbouring seeds uncorrelated', () => {
    const ticks = Array.from({ length: 50_000 }, (_, t) => t)
    const harvest = ticks.map((t) => uniform(1, t, Channel.harvest))
    const event = ticks.map((t) => uniform(1, t, Channel.event))
    const nextSeed = ticks.map((t) => uniform(2, t, Channel.harvest))
    expect(Math.abs(correlation(harvest, event))).toBeLessThan(0.02)
    expect(Math.abs(correlation(harvest, nextSeed))).toBeLessThan(0.02)
  })
})
