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
import { GOLDEN_CASES, GOLDEN_SCRIPTS, INHERITANCE_CASE } from './golden.ts'
import { hashState } from './hash.ts'
import { HORIZON } from './params.ts'
import { Era, VARIABLES, hasEra, type Allocation, type Decision } from './state.ts'
import { step } from './step.ts'
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

const departureAt = (tick: number, amount: number): Crossing => ({
  tick,
  kind: 'people',
  dose: 3,
  amounts: [amount],
  origin: { world: 'donor', tick },
  cost: 0,
  direction: 'out',
})

// FEAT: mistura chegadas com partidas, inclusive uma grande o bastante para esvaziar o mundo
const drainScript = (maxTick: number) =>
  fc
    .array(
      fc.tuple(
        fc.integer({ min: 0, max: maxTick }),
        fc.constantFrom(...CROSSING_KINDS),
        fc.constantFrom(...DOSES),
        fc.oneof(fc.constant(0), fc.double({ min: 1, max: 1e12, noNaN: true })),
      ),
      { maxLength: 6 },
    )
    .map((entries) =>
      entries
        .sort(([a], [b]) => a - b)
        .map(([tick, kind, dose, drain]) =>
          drain > 0 ? departureAt(tick, drain) : crossingAt(tick, kind, dose),
        ),
    )

describe('golden hashes', () => {
  it.each(GOLDEN_CASES)('seed $seed, $script, year $year', ({ seed, script, year, hash }) => {
    const plan = GOLDEN_SCRIPTS[script]
    const w = new Worldline(seed, plan.decisions, null, plan.crossings)
    w.advance(year)
    expect(w.hashAt(year)).toBe(hash)
  })
})

describe('the inheritance fingerprint', () => {
  it('reproduces the first year of a history that outlived its own world', () => {
    const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
    const w = new Worldline(INHERITANCE_CASE.seed, plan.decisions, null, plan.crossings)
    w.advance(INHERITANCE_CASE.year)
    expect(w.present.tick).toBe(INHERITANCE_CASE.year)
    expect(w.present.status).toBe('running')
    expect(w.present.home).not.toBeNull()
    expect(w.hashAt(INHERITANCE_CASE.year)).toBe(INHERITANCE_CASE.hash)
  })

  it('leaves the twelve original fingerprints alone, which is the whole point', () => {
    // FEAT: nenhum roteiro de referência chega ao espaço, então nenhum deles sente esta tarefa
    for (const { seed, script, year, hash } of GOLDEN_CASES) {
      const plan = GOLDEN_SCRIPTS[script]
      const w = new Worldline(seed, plan.decisions, null, plan.crossings)
      w.advance(year)
      expect(w.present.colonies).toEqual([])
      expect(w.present.home).toBeNull()
      expect(w.hashAt(year)).toBe(hash)
    }
  })
})

describe('space era gate', () => {
  it('never opens for any reference script, over the whole horizon', () => {
    // FEAT: prova exigida pela Tarefa 3 — o portão exige energia além da que as referências alcançam
    const seen = new Set<string>()
    for (const { seed, script } of GOLDEN_CASES) {
      const key = `${seed}:${script}`
      if (seen.has(key)) continue
      seen.add(key)
      const plan = GOLDEN_SCRIPTS[script]
      const w = new Worldline(seed, plan.decisions, null, plan.crossings)
      w.advance(HORIZON)
      for (let t = 0; t <= w.present.tick; t += 25) {
        expect(hasEra(w.stateAt(t), Era.space)).toBe(false)
      }
    }
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

  it('a people crossing moves into the destination exactly what it takes out of the origin', () => {
    fc.assert(
      fc.property(
        seed,
        seed,
        fc.integer({ min: 1, max: 600 }),
        fc.constantFrom(...DOSES),
        (from, to, at, dose) => {
          const origin = new Worldline(from)
          const destination = new Worldline(to)
          origin.advance(at)
          destination.advance(at)
          if (origin.ended || destination.ended) return true
          const [moved = 0] = crossingAmounts('people', dose, origin.present)
          if (moved <= 0) return false
          const leaving = departureAt(at, moved)
          const arriving: Crossing = { ...leaving, direction: 'in', cost: 1, dose }
          const left = step(origin.present, origin.world, origin.records.length, undefined, [
            leaving,
          ])
          const emptier = step(
            { ...origin.present, population: origin.present.population - moved },
            origin.world,
            origin.records.length,
          )
          const arrived = step(
            destination.present,
            destination.world,
            destination.records.length,
            undefined,
            [arriving],
          )
          const fuller = step(
            { ...destination.present, population: destination.present.population + moved },
            destination.world,
            destination.records.length,
          )
          return (
            left.state.population === emptier.state.population &&
            arrived.state.population === fuller.state.population
          )
        },
      ),
      { numRuns: 25 },
    )
  })

  it('never lets a stock go negative in a crossed history', () => {
    fc.assert(
      fc.property(seed, script(2999), drainScript(2999), (s, decisions, crossings) => {
        const w = new Worldline(s, decisions, null, crossings)
        w.advance(3000)
        for (let t = 0; t <= w.present.tick; t += 31) {
          for (const variable of VARIABLES) if (w.valueAt(variable, t) < 0) return false
        }
        return true
      }),
      { numRuns: 25 },
    )
  })

  it('never installs a paradox, strain or collapse in a world that never crossed anything', () => {
    fc.assert(
      fc.property(seed, script(2999), (s, decisions) => {
        const w = new Worldline(s, decisions)
        w.advance(3000)
        for (let t = 0; t <= w.present.tick; t += 37) {
          const state = w.stateAt(t)
          if (state.paradox !== null || state.strain !== 0 || state.status === 'collapsed') {
            return false
          }
        }
        return true
      }),
      { numRuns: 20 },
    )
  })

  it('never produces non-finite values over the whole horizon', () => {
    fc.assert(
      fc.property(
        seed,
        script(HORIZON - 1),
        crossScript(HORIZON - 1),
        (s, decisions, crossings) => {
          const w = new Worldline(s, decisions, null, crossings)
          w.advance(HORIZON)
          for (let t = 0; t <= w.present.tick; t += 97) {
            for (const variable of VARIABLES)
              if (!Number.isFinite(w.valueAt(variable, t))) return false
          }
          return true
        },
      ),
      { numRuns: 30 },
    )
  })
})
