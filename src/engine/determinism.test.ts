import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { hashState } from './hash.ts'
import { HORIZON } from './params.ts'
import { VARIABLES, type Allocation, type Decision } from './state.ts'
import { Worldline } from './worldline.ts'

const SCRIPTS: Record<string, Decision[]> = {
  steady: [],
  shifting: [
    { tick: 100, allocation: { agriculture: 25, industry: 55, research: 20, conservation: 0 } },
    { tick: 600, allocation: { agriculture: 50, industry: 10, research: 20, conservation: 20 } },
    { tick: 1500, allocation: { agriculture: 30, industry: 20, research: 40, conservation: 10 } },
  ],
}

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
  it('pins the timeline for reference seeds and scripts', () => {
    const golden: Record<string, string> = {}
    for (const s of [1, 482913, 0xffffffff]) {
      for (const [name, decisions] of Object.entries(SCRIPTS)) {
        const w = new Worldline(s, decisions)
        w.advance(5000)
        const last = w.present.tick
        golden[`${s}/${name}`] = `${w.hashAt(Math.min(1000, last))} ${w.hashAt(last)}@${last}`
      }
    }
    expect(golden).toMatchInlineSnapshot(`
      {
        "1/shifting": "aeb1cbca ddcfedc9@5000",
        "1/steady": "177ac51d 537a5d92@5000",
        "4294967295/shifting": "ae5e39c0 795871e1@5000",
        "4294967295/steady": "648dbea4 68b49e5f@5000",
        "482913/shifting": "4f80c4a1 1c51ab0d@5000",
        "482913/steady": "470d2965 a42a4111@5000",
      }
    `)
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

  it('a fork without new decisions stays on its parent', () => {
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
