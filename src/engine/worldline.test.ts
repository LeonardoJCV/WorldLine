import { describe, expect, it } from 'vitest'
import type { Crossing } from './crossing.ts'
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

describe('crossings', () => {
  const incoming = (tick: number): Crossing => ({
    tick,
    kind: 'knowledge',
    dose: 2,
    amounts: [40],
    origin: { world: 'B', tick },
    cost: 6,
    direction: 'in',
  })

  it('replays a crossed history from a checkpoint', () => {
    const line = new Worldline(SEED, [], null, [incoming(300)])
    line.advance(900)
    for (const year of [299, 300, 301, 500, 900]) {
      const short = new Worldline(SEED, [], null, [incoming(300)])
      short.advance(year)
      expect(line.hashAt(year)).toBe(short.hashAt(year))
    }
  })

  it('replays a year that carries several crossings at once', () => {
    const script = [incoming(200), incoming(200), incoming(640)]
    const line = new Worldline(SEED, [], null, script)
    line.advance(800)
    for (const year of [199, 200, 201, 639, 640, 700, 800]) {
      const short = new Worldline(SEED, [], null, script)
      short.advance(year)
      expect(line.hashAt(year)).toBe(hashState(short.present))
    }
  })

  it('keeps a fork free of later crossings', () => {
    const line = new Worldline(SEED, [], null, [incoming(100), incoming(400)])
    line.advance(600)
    const child = line.fork(200)
    expect(child.crossings.map((c) => c.tick)).toEqual([100])
    expect(child.hashAt(200)).toBe(line.hashAt(200))
  })

  it('records a crossing at the present year', () => {
    const line = new Worldline(SEED)
    line.advance(50)
    const crossing = line.cross({ ...incoming(50) })
    expect(line.crossings).toEqual([crossing])
    expect(() => line.cross({ ...incoming(10) })).toThrow(RangeError)
  })

  it('refuses a crossing the validator rejects', () => {
    const line = new Worldline(SEED)
    line.advance(20)
    expect(() => line.cross({ ...incoming(20), amounts: [] })).toThrow(RangeError)
    expect(() => line.cross({ ...incoming(20), kind: 'doctrine', amounts: [] })).toThrow(RangeError)
    expect(line.crossings).toEqual([])
  })

  it('refuses a crossing once the worldline has ended', () => {
    const line = new Worldline(SEED)
    line.advance(HORIZON)
    expect(() => line.cross(incoming(HORIZON - 1))).toThrow(Error)
  })

  it('rejects a malformed crossing log', () => {
    expect(() => new Worldline(SEED, [], null, [incoming(400), incoming(100)])).toThrow(RangeError)
  })

  it('refuses a log dated before the first year instead of replaying it differently', () => {
    expect(() => new Worldline(SEED, [], null, [incoming(-1), incoming(300)])).toThrow(RangeError)
    expect(() => new Worldline(SEED, [], null, [incoming(0.5)])).toThrow(RangeError)

    const line = new Worldline(SEED, [], null, [incoming(300)])
    line.advance(900)
    const straight = new Worldline(SEED, [], null, [incoming(300)])
    straight.advance(500)
    expect(line.hashAt(500)).toBe(hashState(straight.present))
  })

  it('leaves a world without crossings identical to a world built with an empty list', () => {
    const plain = new Worldline(SEED)
    plain.advance(1200)
    const empty = new Worldline(SEED, [], null, [])
    empty.advance(1200)
    expect(plain.hashAt(1200)).toBe(empty.hashAt(1200))
  })
})
