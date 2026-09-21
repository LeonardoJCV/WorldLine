import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GOLDEN_CASES, GOLDEN_SCRIPTS } from './golden.ts'
import { hashState } from './hash.ts'
import { HORIZON } from './params.ts'
import { VARIABLES, type Allocation, type Decision } from './state.ts'
import { Worldline } from './worldline.ts'

const allocation = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
  )
  .map((cuts): Allocation => {
    const [a, b, c] = [...cuts].sort((x, y) => x - y) as [number, number, number]
    return { agriculture: a, industry: b - a, research: c - b, conservation: 100 - c }
  })

const script = (maxTick: number) =>
  fc
    .uniqueArray(fc.tuple(fc.integer({ min: 0, max: maxTick }), allocation), {
      maxLength: 6,
      selector: ([tick]) => tick,
    })
    .map((entries) =>
      entries
        .sort(([a], [b]) => a - b)
        .map(([tick, alloc]): Decision => ({ tick, allocation: alloc })),
    )

const seed = fc.integer({ min: 0, max: 0xffffffff })

describe('golden hashes', () => {
  it.each(GOLDEN_CASES)('seed $seed, $script, year $year', ({ seed, script, year, hash }) => {
    const w = new Worldline(seed, GOLDEN_SCRIPTS[script])
    w.advance(year)
    expect(w.hashAt(year)).toBe(hash)
  })
})

describe('determinism properties', () => {
  it('same seed and decisions give the same timeline', () => {
    fc.assert(
      fc.property(seed, script(2999), (s, decisions) => {
        const a = new Worldline(s, decisions)
        const b = new Worldline(s, decisions)
        a.advance(3000)
        b.advance(3000)
        return hashState(a.present) === hashState(b.present)
      }),
      { numRuns: 20 },
    )
  })

  it('replaying from a checkpoint equals running straight', () => {
    fc.assert(
      fc.property(seed, script(1199), fc.integer({ min: 0, max: 1200 }), (s, decisions, tick) => {
        const full = new Worldline(s, decisions)
        full.advance(1200)
        const straight = new Worldline(s, decisions)
        straight.advance(tick)
        return full.hashAt(Math.min(tick, full.present.tick)) === hashState(straight.present)
      }),
      { numRuns: 30 },
    )
  })

  it("a fork that replays its parent's decisions stays on its parent", () => {
    fc.assert(
      fc.property(seed, script(1999), fc.integer({ min: 0, max: 1500 }), (s, decisions, at) => {
        const parent = new Worldline(s, decisions)
        parent.advance(2000)
        const forkAt = Math.min(at, parent.present.tick)
        const child = parent.fork(forkAt)
        for (const d of decisions.filter((d) => d.tick >= forkAt)) {
          child.advance(d.tick - child.present.tick)
          if (child.ended) break
          child.decide(d.allocation)
        }
        child.advance(parent.present.tick - child.present.tick)
        return child.hashAt(child.present.tick) === parent.hashAt(child.present.tick)
      }),
      { numRuns: 15 },
    )
  })

  it('never produces non-finite values over the whole horizon', () => {
    fc.assert(
      fc.property(seed, script(HORIZON - 1), (s, decisions) => {
        const w = new Worldline(s, decisions)
        w.advance(HORIZON)
        for (let t = 0; t <= w.present.tick; t += 97) {
          for (const variable of VARIABLES)
            if (!Number.isFinite(w.valueAt(variable, t))) return false
        }
        return true
      }),
      { numRuns: 30 },
    )
  })
})
