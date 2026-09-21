import { describe, expect, it } from 'vitest'
import { hashState } from './hash.ts'
import { HORIZON } from './params.ts'
import { Worldline } from './worldline.ts'

const SEED = 482913
const industrial = { agriculture: 25, industry: 55, research: 20, conservation: 0 }
const green = { agriculture: 40, industry: 15, research: 20, conservation: 25 }

describe('Worldline', () => {
  it('starts at year zero with one sample', () => {
    const w = new Worldline(SEED)
    expect(w.present.tick).toBe(0)
    expect(w.valueAt('population', 0)).toBe(w.present.population)
  })

  it('advances and records every year', () => {
    const w = new Worldline(SEED)
    expect(w.advance(300)).toBe(300)
    expect(w.present.tick).toBe(300)
    expect(w.valueAt('technology', 300)).toBe(w.present.technology)
    expect(w.valueAt('environment', 150)).toBe(w.stateAt(150).environment)
  })

  it('applies a decision at the present year', () => {
    const w = new Worldline(SEED)
    w.advance(100)
    const decision = w.decide(industrial)
    expect(decision).toEqual({ tick: 100, allocation: industrial })
    w.advance(1)
    expect(w.present.allocation).toEqual(industrial)
  })

  it('replaces a decision made twice in the same year', () => {
    const w = new Worldline(SEED)
    w.decide(industrial)
    w.decide(green)
    expect(w.decisions).toEqual([{ tick: 0, allocation: green }])
  })

  it('rejects invalid allocations', () => {
    const w = new Worldline(SEED)
    expect(() => w.decide({ ...industrial, conservation: 5 })).toThrow(RangeError)
  })

  it('reproduces a live session from its decision log', () => {
    const live = new Worldline(SEED)
    live.advance(100)
    live.decide(industrial)
    live.advance(400)
    live.decide(green)
    live.advance(500)

    const replayed = new Worldline(SEED, live.decisions)
    replayed.advance(1000)
    expect(replayed.hashAt(1000)).toBe(live.hashAt(1000))
    expect(replayed.records).toEqual(live.records)
  })

  it('rebuilds any past year exactly from checkpoints', () => {
    const w = new Worldline(SEED, [{ tick: 300, allocation: industrial }])
    w.advance(1200)
    for (const tick of [0, 1, 255, 256, 257, 300, 511, 512, 999, 1200]) {
      const direct = new Worldline(SEED, [{ tick: 300, allocation: industrial }])
      direct.advance(tick)
      expect(w.hashAt(tick)).toBe(hashState(direct.present))
    }
  })

  it('closes event records when events end', () => {
    const w = new Worldline(SEED, [{ tick: 0, allocation: industrial }])
    w.advance(3000)
    for (const record of w.records) {
      if (record.end !== null) expect(record.end).toBeGreaterThanOrEqual(record.start)
    }
    const starts = w.records.map((r) => r.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('summarises a range into buckets', () => {
    const w = new Worldline(SEED)
    w.advance(99)
    const { min, max, mean } = w.range('population', 0, 99, 10)
    expect(min).toHaveLength(10)
    const firstTen = Array.from({ length: 10 }, (_, t) => w.valueAt('population', t))
    expect(min[0]).toBeCloseTo(Math.min(...firstTen), -1)
    expect(max[0]).toBeCloseTo(Math.max(...firstTen), -1)
    expect(mean[0]).toBeCloseTo(firstTen.reduce((a, b) => a + b, 0) / 10, -1)
  })

  it('never produces more buckets than years', () => {
    const w = new Worldline(SEED)
    w.advance(4)
    expect(w.range('food', 0, 4, 100).mean).toHaveLength(5)
  })

  it('stops at the horizon', () => {
    const w = new Worldline(SEED, [{ tick: 0, allocation: green }])
    const advanced = w.advance(HORIZON + 50)
    expect(w.ended).toBe(true)
    expect(advanced).toBeLessThanOrEqual(HORIZON)
  })

  it('forks a worldline that follows its parent until a new decision', () => {
    const parent = new Worldline(SEED, [{ tick: 50, allocation: industrial }])
    parent.advance(1000)
    const child = parent.fork(400)
    expect(child.lineage).toEqual({ parent, tick: 400 })
    expect(child.present.tick).toBe(400)
    child.advance(600)
    expect(child.hashAt(1000)).toBe(parent.hashAt(1000))

    const diverged = parent.fork(400)
    diverged.decide(green)
    diverged.advance(600)
    expect(diverged.hashAt(1000)).not.toBe(parent.hashAt(1000))
    expect(diverged.hashAt(400)).toBe(parent.hashAt(400))
  })

  it('rejects malformed decision logs', () => {
    expect(
      () =>
        new Worldline(SEED, [
          { tick: 10, allocation: green },
          { tick: 5, allocation: green },
        ]),
    ).toThrow(RangeError)
    expect(
      () =>
        new Worldline(SEED, [
          { tick: 10, allocation: green },
          { tick: 10, allocation: industrial },
        ]),
    ).toThrow(RangeError)
    expect(() => new Worldline(SEED, [{ tick: 3, allocation: { ...green, research: 0 } }])).toThrow(
      RangeError,
    )
  })

  it('rejects years outside the recorded history', () => {
    const w = new Worldline(SEED)
    w.advance(10)
    expect(() => w.stateAt(11)).toThrow(RangeError)
    expect(() => w.valueAt('food', -1)).toThrow(RangeError)
  })
})
