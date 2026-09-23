import { describe, expect, it } from 'vitest'
import {
  crossingAmounts,
  crossingCost,
  type Crossing,
  type CrossingKind,
  type Dose,
} from './crossing.ts'
import { debtRatio, totalOwed, worldSize } from './debt.ts'
import { causalDistance } from './distance.ts'
import type { EventId } from './events.ts'
import { genesis } from './genesis.ts'
import { PARADOX_GRACE, PARADOX_PATIENCE, PARADOX_RATIO } from './params.ts'
import { step } from './step.ts'
import type { Allocation, Decision, WorldState } from './state.ts'
import { Worldline } from './worldline.ts'

const balanced: Allocation = { agriculture: 40, industry: 30, research: 20, conservation: 10 }
const industrial: Allocation = { agriculture: 25, industry: 60, research: 15, conservation: 0 }
const starved: Allocation = { agriculture: 5, industry: 50, research: 40, conservation: 5 }
const research: Allocation = { agriculture: 35, industry: 20, research: 40, conservation: 5 }

function run(seed: number, allocation: Allocation, years: number): Worldline {
  const w = new Worldline(seed, [{ tick: 0, allocation }])
  w.advance(years)
  return w
}

const firstStart = (w: Worldline, event: EventId) =>
  w.records.find((r) => r.event === event)?.start ?? Infinity
const count = (w: Worldline, event: EventId) => w.records.filter((r) => r.event === event).length

describe('model behaviour', () => {
  it.each([1, 7, 482913])('a balanced civilisation survives five millennia (seed %i)', (seed) => {
    const w = run(seed, balanced, 5000)
    expect(w.present.status).toBe('running')
    expect(w.present.population).toBeGreaterThan(1e6)
  })

  it('heavy industry without conservation degrades the environment into crisis', () => {
    const heavy = run(482913, industrial, 5000)
    const calm = run(482913, balanced, 5000)
    expect(firstStart(heavy, 'ecological_crisis')).toBeLessThan(5000)
    expect(count(calm, 'ecological_crisis')).toBe(0)
  })

  it('neglecting agriculture brings famine within a century', () => {
    expect(firstStart(run(482913, starved, 200), 'famine')).toBeLessThan(100)
  })

  it('research-first worlds reach advanced technology before year 2000', () => {
    const w = run(482913, research, 2000)
    expect(w.present.technology).toBeGreaterThan(75)
  })

  it('eras arrive in historical order in a balanced world', () => {
    const w = run(482913, balanced, 5000)
    const agricultural = firstStart(w, 'agricultural_revolution')
    const industrialEra = firstStart(w, 'industrial_revolution')
    expect(agricultural).toBeLessThan(industrialEra)
    expect(industrialEra).toBeLessThan(5000)
  })

  it('a balanced world does not live in permanent famine', () => {
    const w = run(482913, balanced, 5000)
    expect(count(w, 'famine')).toBeLessThanOrEqual(25)
  })
})

// FEAT: a grade da dívida, a mesma de `npm run probe debt`, reduzida para caber num teste
const DEBT_SEEDS = [1, 482913, 99991, 0xffffffff]
const DEBT_KINDS: readonly CrossingKind[] = ['knowledge', 'resource', 'doctrine']
const DEBT_HORIZON = 2000
const ELDER_GAP = 2000

const donorAllocation: Allocation = { agriculture: 35, industry: 20, research: 40, conservation: 5 }
const invests: Readonly<Record<CrossingKind, Allocation>> = {
  knowledge: { agriculture: 35, industry: 20, research: 40, conservation: 5 },
  resource: { agriculture: 55, industry: 35, research: 5, conservation: 5 },
  doctrine: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
  people: donorAllocation,
}
const neglects: Readonly<Record<CrossingKind, Allocation>> = {
  knowledge: { agriculture: 50, industry: 45, research: 0, conservation: 5 },
  resource: { agriculture: 15, industry: 5, research: 50, conservation: 30 },
  doctrine: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
  people: donorAllocation,
}
const droppedDoctrine: Allocation = {
  agriculture: 35,
  industry: 35,
  research: 20,
  conservation: 10,
}

interface Borrowed {
  readonly cost: number
  readonly repaidAfter: number
  readonly peakRatio: number
  readonly longestAbove: number
  readonly paradox: boolean
  readonly debtParadox: boolean
  readonly collapsed: boolean
  readonly stabilityDrop: number
  readonly alive: boolean
}

function series(
  seed: number,
  decisions: readonly Decision[],
  crossings: readonly Crossing[],
): {
  ratio: number[]
  owed: number[]
  stability: number[]
  alive: boolean
  paradox: boolean
  debtParadox: boolean
  collapsed: boolean
} {
  const origin = genesis(seed)
  let s: WorldState = origin.state
  const ratio = [0]
  const owed = [0]
  const stability = [s.stability]
  let decided = 0
  let crossed = 0
  let records = 0
  let paradox = false
  let debtParadox = false
  while (s.tick < DEBT_HORIZON && s.status === 'running') {
    const pending = decisions[decided]
    const due = pending?.tick === s.tick ? pending : undefined
    if (due) decided++
    const arriving: Crossing[] = []
    while (crossings[crossed]?.tick === s.tick) {
      const entry = crossings[crossed]
      if (entry) arriving.push(entry)
      crossed++
    }
    const result = step(s, origin.world, records, due, arriving)
    records += result.started.length
    s = result.state
    if (s.paradox) {
      paradox = true
      if (s.paradox.kind === 'debt') debtParadox = true
    }
    ratio.push(debtRatio(s.debts, s))
    owed.push(totalOwed(s.debts))
    stability.push(s.stability)
  }
  return {
    ratio,
    owed,
    stability,
    alive: s.status === 'running',
    paradox,
    debtParadox,
    collapsed: s.status === 'collapsed',
  }
}

function borrow(
  seed: number,
  kind: CrossingKind,
  dose: Dose,
  year: number,
  keeps: boolean,
): Borrowed {
  const own = keeps ? invests[kind] : neglects[kind]
  const decisions: Decision[] = [{ tick: 0, allocation: own }]
  if (kind === 'doctrine' && !keeps) decisions.push({ tick: year + 1, allocation: droppedDoctrine })

  const donor = new Worldline(seed, [{ tick: 0, allocation: donorAllocation }])
  donor.advance(year + ELDER_GAP)
  const here = new Worldline(seed, [{ tick: 0, allocation: own }])
  here.advance(year)
  const cost = crossingCost(kind, dose, causalDistance(donor.present, here.present))
  const crossing: Crossing = {
    tick: year,
    kind,
    dose,
    amounts: crossingAmounts(kind, dose, donor.present),
    origin: { world: 'D', tick: year },
    cost,
    direction: 'in',
    ...(kind === 'doctrine' ? { allocation: donor.present.allocation } : {}),
  }
  const base = series(seed, decisions, [])
  const run = series(seed, decisions, [crossing])

  let repaidAfter = -1
  let peakRatio = 0
  let longestAbove = 0
  let above = 0
  for (let y = year; y < run.ratio.length; y++) {
    const r = run.ratio[y] ?? 0
    if (r > peakRatio) peakRatio = r
    above = r > PARADOX_RATIO ? above + 1 : 0
    if (above > longestAbove) longestAbove = above
    if (repaidAfter < 0 && y > year && (run.owed[y] ?? 0) === 0) repaidAfter = y - year
  }
  const window = Math.min(year + 100, run.stability.length - 1, base.stability.length - 1)
  return {
    cost,
    repaidAfter,
    peakRatio,
    longestAbove,
    paradox: run.paradox,
    debtParadox: run.debtParadox,
    collapsed: run.collapsed,
    stabilityDrop: (base.stability[window] ?? 0) - (run.stability[window] ?? 0),
    alive: run.alive,
  }
}

function grid(doses: readonly Dose[], stances: readonly boolean[]): Borrowed[] {
  const out: Borrowed[] = []
  for (const seed of DEBT_SEEDS) {
    for (const kind of DEBT_KINDS) {
      for (const dose of doses) {
        for (const year of [5, 1500]) {
          for (const keeps of stances) out.push(borrow(seed, kind, dose, year, keeps))
        }
      }
    }
  }
  return out
}

const shareOf = (values: readonly boolean[]) =>
  values.filter((value) => value).length / values.length
const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN

describe('debt calibration', () => {
  it('a small gift is a burden a world carries, never a death sentence', () => {
    const small = grid([1], [true, false])
    expect(small.every((b) => b.alive)).toBe(true)
    expect(Math.max(...small.map((b) => b.peakRatio))).toBeLessThan(PARADOX_RATIO)
    expect(Math.max(...small.map((b) => b.stabilityDrop))).toBeLessThan(15)
    expect(shareOf(small.map((b) => b.debtParadox))).toBe(0)
    expect(shareOf(small.map((b) => b.collapsed))).toBe(0)
  })

  it('a world that invests in the currency it owes repays it and never reaches a paradox', () => {
    const investing = grid([1, 2, 3], [true])
    expect(shareOf(investing.map((b) => b.repaidAfter >= 0))).toBeGreaterThan(0.7)
    const repaid = investing.filter((b) => b.repaidAfter >= 0).map((b) => b.repaidAfter)
    expect(median(repaid)).toBeGreaterThan(5)
    expect(median(repaid)).toBeLessThan(250)
    expect(Math.max(...investing.map((b) => b.longestAbove))).toBeLessThan(PARADOX_PATIENCE)
    expect(shareOf(investing.map((b) => b.debtParadox))).toBe(0)
    // FEAT: um presente grande demais ainda instala o paradoxo do salto no ato, mas quem investe
    // quita dentro do prazo e o desfaz — nenhum mundo que investe morre por ter recebido
    expect(investing.every((b) => b.alive)).toBe(true)
    expect(shareOf(investing.map((b) => b.collapsed))).toBe(0)
  })

  it('a large gift into a world that never invests turns into a paradox', () => {
    const stranded = DEBT_SEEDS.flatMap((seed) =>
      [5, 1500].map((year) => borrow(seed, 'knowledge', 3, year, false)),
    )
    expect(shareOf(stranded.map((b) => b.repaidAfter >= 0))).toBe(0)
    expect(Math.min(...stranded.map((b) => b.longestAbove))).toBeGreaterThanOrEqual(
      PARADOX_PATIENCE,
    )
    expect(shareOf(stranded.map((b) => b.paradox))).toBeGreaterThan(0.9)
    expect(Math.max(...stranded.map((b) => b.stabilityDrop))).toBeGreaterThan(8)
  })

  it('the deadline leaves a paradoxed world room to work its way out', () => {
    const large = grid([3], [true]).filter((b) => b.repaidAfter >= 0)
    expect(median(large.map((b) => b.repaidAfter))).toBeLessThan(PARADOX_GRACE)
  })

  it('collapse exists across the grid without being the common fate', () => {
    const everything = grid([1, 2, 3], [true, false])
    const collapse = shareOf(everything.map((b) => b.collapsed))
    expect(collapse).toBeGreaterThan(0)
    expect(collapse).toBeLessThan(0.25)
  })

  it('the same debt weighs less on a bigger world', () => {
    const owed = [{ kind: 'knowledge' as const, owed: 10, since: 0, origin: 'D' }]
    const at = (year: number) =>
      DEBT_SEEDS.map((seed) => {
        const w = new Worldline(seed, [{ tick: 0, allocation: donorAllocation }])
        w.advance(year)
        return { ratio: debtRatio(owed, w.present), size: worldSize(w.present) }
      })
    const young = at(5)
    const middling = at(500)
    const mature = at(3000)
    expect(median(young.map((s) => s.size))).toBeLessThan(median(mature.map((s) => s.size)))
    expect(median(young.map((s) => s.ratio))).toBeGreaterThan(median(middling.map((s) => s.ratio)))
    expect(median(middling.map((s) => s.ratio))).toBeGreaterThan(median(mature.map((s) => s.ratio)))
    // FEAT: um presente grande pesa num mundo jovem sem jamais saturar o termo da estabilidade
    expect(median(young.map((s) => s.ratio))).toBeGreaterThan(PARADOX_RATIO)
    expect(median(young.map((s) => s.ratio))).toBeLessThan(1)
    expect(median(mature.map((s) => s.ratio))).toBeLessThan(PARADOX_RATIO / 2)
  })
})
