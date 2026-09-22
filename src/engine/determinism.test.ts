import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CROSSING_KINDS,
  DOSES,
  crossingAmounts,
  crossingCost,
  type Crossing,
  type CrossingKind,
  type Dose,
} from './crossing.ts'
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

const DONOR = { technology: 40, food: 600, energy: 400, population: 900 }
const CREED: Allocation = { agriculture: 30, industry: 30, research: 20, conservation: 20 }

const crossingAt = (tick: number, kind: CrossingKind, dose: Dose): Crossing => ({
  tick,
  kind,
  dose,
  amounts: crossingAmounts(kind, dose, DONOR),
  origin: { world: 'donor', tick },
  cost: crossingCost(kind, dose, 0.5),
  direction: 'in',
  ...(kind === 'doctrine' ? { allocation: CREED } : {}),
})

const crossScript = (maxTick: number) =>
  fc
    .array(
      fc.tuple(
        fc.integer({ min: 0, max: maxTick }),
        fc.constantFrom(...CROSSING_KINDS),
        fc.constantFrom(...DOSES),
      ),
      { maxLength: 4 },
    )
    .map((entries) =>
      entries.sort(([a], [b]) => a - b).map(([tick, kind, dose]) => crossingAt(tick, kind, dose)),
    )

describe('golden hashes', () => {
  it.each(GOLDEN_CASES)('seed $seed, $script, year $year', ({ seed, script, year, hash }) => {
    const plan = GOLDEN_SCRIPTS[script]
    const w = new Worldline(seed, plan.decisions, null, plan.crossings)
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

  it('same seed, decisions and crossings give the same timeline', () => {
    fc.assert(
      fc.property(seed, script(2999), crossScript(2999), (s, decisions, crossings) => {
        const a = new Worldline(s, decisions, null, crossings)
        const b = new Worldline(s, decisions, null, crossings)
        a.advance(3000)
        b.advance(3000)
        return hashState(a.present) === hashState(b.present)
      }),
      { numRuns: 20 },
    )
  })

  it('replaying a crossed history from a checkpoint equals running straight', () => {
    fc.assert(
      fc.property(
        seed,
        script(1199),
        crossScript(1199),
        fc.integer({ min: 0, max: 1200 }),
        (s, decisions, crossings, tick) => {
          const full = new Worldline(s, decisions, null, crossings)
          full.advance(1200)
          const straight = new Worldline(s, decisions, null, crossings)
          straight.advance(tick)
          return full.hashAt(Math.min(tick, full.present.tick)) === hashState(straight.present)
        },
      ),
      { numRuns: 30 },
    )
  })

  it("a fork that replays its parent's crossings stays on its parent", () => {
    fc.assert(
      fc.property(
        seed,
        script(1999),
        crossScript(1999),
        fc.integer({ min: 0, max: 1500 }),
        (s, decisions, crossings, at) => {
          const parent = new Worldline(s, decisions, null, crossings)
          parent.advance(2000)
          const forkAt = Math.min(at, parent.present.tick)
          const child = parent.fork(forkAt)
          if (child.crossings.some((c) => c.tick >= forkAt)) return false
          const pending = [
            ...decisions
              .filter((d) => d.tick >= forkAt)
              .map((d) => ({ tick: d.tick, apply: () => child.decide(d.allocation) })),
            ...crossings
              .filter((c) => c.tick >= forkAt)
              .map((c) => ({ tick: c.tick, apply: () => child.cross(c) })),
          ].sort((a, b) => a.tick - b.tick)
          for (const entry of pending) {
            child.advance(entry.tick - child.present.tick)
            if (child.ended) break
            entry.apply()
          }
          child.advance(parent.present.tick - child.present.tick)
          return child.hashAt(child.present.tick) === parent.hashAt(child.present.tick)
        },
      ),
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
