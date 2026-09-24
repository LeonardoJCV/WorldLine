import {
  crossingAmounts,
  crossingCost,
  type Crossing,
  type CrossingKind,
  type Dose,
} from '../src/engine/crossing.ts'
import { heir, selfSufficient, type Colony } from '../src/engine/colony.ts'
import { debtRatio, leapParadox, totalOwed, worldSize } from '../src/engine/debt.ts'
import { causalDistance } from '../src/engine/distance.ts'
import { worldMetrics } from '../src/engine/events.ts'
import { genesis } from '../src/engine/genesis.ts'
import { GOLDEN_SCRIPTS } from '../src/engine/golden.ts'
import { PARADOX_RATIO } from '../src/engine/params.ts'
import { step } from '../src/engine/step.ts'
import { Era, type Allocation, type Decision, type WorldState } from '../src/engine/state.ts'
import { Worldline } from '../src/engine/worldline.ts'

const STRATEGIES: Record<string, Allocation> = {
  balanced: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
  industrial: { agriculture: 25, industry: 60, research: 15, conservation: 0 },
  starved: { agriculture: 5, industry: 50, research: 40, conservation: 5 },
  green: { agriculture: 40, industry: 15, research: 20, conservation: 25 },
  research: { agriculture: 35, industry: 20, research: 40, conservation: 5 },
}
const YEARS = [200, 600, 1500, 5000]
const fixed = (value: number, digits = 1) => value.toFixed(digits).padStart(7)

function strategyProbe(seed: number): void {
  for (const [name, allocation] of Object.entries(STRATEGIES)) {
    const w = new Worldline(seed, [{ tick: 0, allocation }])
    w.advance(Math.max(...YEARS))
    console.log(`\n${name}  (seed ${seed}, ended at ${w.present.tick}, ${w.present.status})`)
    for (const year of YEARS.filter((y) => y <= w.present.tick)) {
      const s = w.stateAt(year)
      console.log(
        `  y${String(year).padEnd(5)} P ${fixed(s.population / 1e6, 2)}M  T ${fixed(s.technology)}` +
          `  E ${fixed(s.energy, 2)}  Y ${fixed(s.economy, 2)}  N ${fixed(s.environment)}  S ${fixed(s.stability)}`,
      )
    }
    const counts = new Map<string, number>()
    for (const record of w.records) counts.set(record.event, (counts.get(record.event) ?? 0) + 1)
    const firsts = w.records
      .filter((r, i) => w.records.findIndex((o) => o.event === r.event) === i)
      .map((r) => `${r.event}@${r.start}×${counts.get(r.event)}`)
    console.log(`  events: ${firsts.join('  ')}`)
  }
}

// FEAT: a grade da dívida — semente × espécie × dose × ano × doador × postura
const DEBT_SEEDS = [1, 7, 42, 4242, 482913, 99991, 1597463007, 0xffffffff]
const DEBT_KINDS_PROBED: readonly CrossingKind[] = ['knowledge', 'resource', 'doctrine']
const DEBT_DOSES: readonly Dose[] = [1, 2, 3]
const DEBT_YEARS = [5, 1500]
const DONORS = ['twin', 'elder'] as const
const STANCES = ['invests', 'neglects'] as const
const DEBT_HORIZON = 3000
const ELDER_GAP = 2000

type Donor = (typeof DONORS)[number]
type Stance = (typeof STANCES)[number]

const DONOR_ALLOCATION: Allocation = {
  agriculture: 35,
  industry: 20,
  research: 40,
  conservation: 5,
}

// FEAT: investir na moeda devida é pesquisa para conhecimento, campo e indústria para recurso,
// e manter a alocação recebida para doutrina
const STANCE_ALLOCATION: Readonly<Record<CrossingKind, Readonly<Record<Stance, Allocation>>>> = {
  knowledge: {
    invests: { agriculture: 35, industry: 20, research: 40, conservation: 5 },
    neglects: { agriculture: 50, industry: 45, research: 0, conservation: 5 },
  },
  resource: {
    invests: { agriculture: 55, industry: 35, research: 5, conservation: 5 },
    neglects: { agriculture: 15, industry: 5, research: 50, conservation: 30 },
  },
  doctrine: {
    invests: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
    neglects: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
  },
  people: { invests: DONOR_ALLOCATION, neglects: DONOR_ALLOCATION },
}
const DROPPED_DOCTRINE: Allocation = {
  agriculture: 35,
  industry: 35,
  research: 20,
  conservation: 10,
}

interface Trace {
  readonly cost: number
  readonly leap: boolean
  readonly repaidAt: number
  readonly peakRatio: number
  readonly longestAbove: number
  readonly paradoxAt: number
  readonly collapsedAt: number
  readonly stabilityDrop: number
  readonly stabilityEnd: number
  readonly populationShare: number
  readonly status: string
}

interface Run {
  readonly stability: readonly number[]
  readonly population: readonly number[]
  readonly ratio: readonly number[]
  readonly owed: readonly number[]
  readonly status: string
  readonly ended: number
  readonly paradoxAt: number
  readonly collapsedAt: number
}

function simulate(
  seed: number,
  decisions: readonly Decision[],
  crossings: readonly Crossing[],
  years: number,
): Run {
  const origin = genesis(seed)
  let s: WorldState = origin.state
  const stability: number[] = [s.stability]
  const population: number[] = [s.population]
  const ratio: number[] = [0]
  const owed: number[] = [0]
  let decided = 0
  let crossed = 0
  let records = 0
  let paradoxAt = -1
  while (s.tick < years && s.status === 'running') {
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
    stability.push(s.stability)
    population.push(s.population)
    if (s.paradox && paradoxAt < 0) paradoxAt = s.paradox.since
    ratio.push(debtRatio(s.debts, s))
    owed.push(totalOwed(s.debts))
  }
  return {
    stability,
    population,
    ratio,
    owed,
    status: s.status,
    ended: s.tick,
    paradoxAt,
    collapsedAt: s.status === 'collapsed' ? s.tick : -1,
  }
}

const donorCache = new Map<string, WorldState>()
function donorAt(seed: number, year: number): WorldState {
  const key = `${seed}:${year}`
  const cached = donorCache.get(key)
  if (cached) return cached
  const w = new Worldline(seed, [{ tick: 0, allocation: DONOR_ALLOCATION }])
  w.advance(year)
  const state = w.present
  donorCache.set(key, state)
  return state
}

const baselineCache = new Map<string, Run>()
function baseline(seed: number, decisions: readonly Decision[]): Run {
  const key = `${seed}:${decisions.map((d) => `${d.tick}/${Object.values(d.allocation).join('')}`).join(',')}`
  const cached = baselineCache.get(key)
  if (cached) return cached
  const run = simulate(seed, decisions, [], DEBT_HORIZON)
  baselineCache.set(key, run)
  return run
}

function trace(
  seed: number,
  kind: CrossingKind,
  dose: Dose,
  year: number,
  donor: Donor,
  stance: Stance,
): Trace {
  const own = STANCE_ALLOCATION[kind][stance]
  const decisions: Decision[] = [{ tick: 0, allocation: own }]
  if (kind === 'doctrine' && stance === 'neglects') {
    decisions.push({ tick: year + 1, allocation: DROPPED_DOCTRINE })
  }
  const base = baseline(seed, decisions)
  const donorState = donorAt(seed, donor === 'elder' ? year + ELDER_GAP : year)

  const here = simulate(seed, decisions, [], year)
  if (here.ended < year) {
    return {
      cost: 0,
      leap: false,
      repaidAt: -1,
      peakRatio: 0,
      longestAbove: 0,
      paradoxAt: -1,
      collapsedAt: -1,
      stabilityDrop: 0,
      stabilityEnd: 0,
      populationShare: 1,
      status: 'skipped',
    }
  }
  const destination = new Worldline(seed, decisions.slice(0, 1))
  destination.advance(year)
  const state = destination.present
  const distance = causalDistance(donorState, state)
  const cost = crossingCost(kind, dose, distance)
  const crossing: Crossing = {
    tick: year,
    kind,
    dose,
    amounts: crossingAmounts(kind, dose, donorState),
    origin: { world: 'D', tick: year },
    cost,
    direction: 'in',
    ...(kind === 'doctrine' ? { allocation: donorState.allocation } : {}),
  }
  const run = simulate(seed, decisions, [crossing], DEBT_HORIZON)

  let repaidAt = -1
  let peakRatio = 0
  let longestAbove = 0
  let above = 0
  for (let y = year; y < run.ratio.length; y++) {
    const r = run.ratio[y] ?? 0
    if (r > peakRatio) peakRatio = r
    above = r > PARADOX_RATIO ? above + 1 : 0
    if (above > longestAbove) longestAbove = above
    if (repaidAt < 0 && y > year && (run.owed[y] ?? 0) === 0) repaidAt = y
  }
  const window = Math.min(year + 100, run.stability.length - 1, base.stability.length - 1)
  const last = Math.min(run.stability.length - 1, base.stability.length - 1)
  return {
    cost,
    leap: leapParadox(crossing, state, destination.world),
    repaidAt: repaidAt < 0 ? -1 : repaidAt - year,
    peakRatio,
    longestAbove,
    paradoxAt: run.paradoxAt < 0 ? -1 : run.paradoxAt - year,
    collapsedAt: run.collapsedAt < 0 ? -1 : run.collapsedAt - year,
    stabilityDrop: (base.stability[window] ?? 0) - (run.stability[window] ?? 0),
    stabilityEnd: (base.stability[last] ?? 0) - (run.stability[last] ?? 0),
    populationShare: (run.population[last] ?? 0) / Math.max(1, base.population[last] ?? 1),
    status: run.status,
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? NaN
}
const share = (values: readonly boolean[]) =>
  values.length === 0 ? 0 : values.filter((v) => v).length / values.length

interface Cell {
  readonly kind: CrossingKind
  readonly dose: Dose
  readonly stance: Stance
  readonly traces: readonly Trace[]
}

function summarise(cells: readonly Cell[]): void {
  const all = cells.flatMap((c) => c.traces)
  const pick = (dose: Dose | null, stance?: Stance, kind?: CrossingKind) =>
    cells
      .filter(
        (c) =>
          (dose === null || c.dose === dose) &&
          (!stance || c.stance === stance) &&
          (!kind || c.kind === kind),
      )
      .flatMap((c) => c.traces)
  const line = (label: string, traces: readonly Trace[]) => {
    const repaid = traces.filter((t) => t.repaidAt >= 0).map((t) => t.repaidAt)
    console.log(
      `${label.padEnd(30)} n=${String(traces.length).padStart(3)}` +
        `  paradox ${(share(traces.map((t) => t.paradoxAt >= 0)) * 100).toFixed(0).padStart(3)}%` +
        `  collapse ${(share(traces.map((t) => t.collapsedAt >= 0)) * 100).toFixed(0).padStart(3)}%` +
        `  repaid ${(share(traces.map((t) => t.repaidAt >= 0)) * 100).toFixed(0).padStart(3)}%` +
        `  peak<=${Math.max(...traces.map((t) => t.peakRatio)).toFixed(2)}` +
        `  above<=${Math.max(...traces.map((t) => t.longestAbove))}` +
        `  drop<=${Math.max(...traces.map((t) => t.stabilityDrop)).toFixed(1)}` +
        `  repay med ${(repaid.length === 0 ? 'never' : median(repaid).toFixed(0)).padStart(5)}` +
        `  leap ${(share(traces.map((t) => t.leap)) * 100).toFixed(0).padStart(3)}%`,
    )
  }
  console.log('\n-- summary --')
  line('small gift (dose 1)', pick(1))
  line('small gift, neglecting', pick(1, 'neglects'))
  line('medium gift (dose 2)', pick(2))
  line('large gift (dose 3), investing', pick(3, 'invests'))
  line('large gift (dose 3), neglecting', pick(3, 'neglects'))
  line('  of it: knowledge', pick(3, 'neglects', 'knowledge'))
  line('  of it: resource', pick(3, 'neglects', 'resource'))
  line('  of it: doctrine', pick(3, 'neglects', 'doctrine'))
  line('every investing world', pick(null, 'invests'))
  line('whole grid', all)

  // FEAT: a mesma dívida pesa menos num mundo maior — a prova de escala da razão
  const owed = [{ kind: 'knowledge' as const, owed: 10, since: 0, origin: 'D' }]
  for (const [label, year] of [
    ['young (y5)', 5],
    ['middling (y500)', 500],
    ['mature (y3000)', 3000],
  ] as const) {
    const ratios = DEBT_SEEDS.map((s) => {
      const w = new Worldline(s, [{ tick: 0, allocation: DONOR_ALLOCATION }])
      w.advance(year)
      return debtRatio(owed, w.present)
    })
    console.log(
      `  10 credits on a ${label.padEnd(16)} ratio ${median(ratios).toFixed(3)}` +
        `   size ${median(
          DEBT_SEEDS.map((s) => {
            const w = new Worldline(s, [{ tick: 0, allocation: DONOR_ALLOCATION }])
            w.advance(year)
            return worldSize(w.present)
          }),
        ).toFixed(1)}`,
    )
  }
}

function debtProbe(): void {
  console.log(
    `\n== debt grid ==  ${DEBT_SEEDS.length} seeds × kind × dose × year × donor × stance` +
      `  (horizon ${DEBT_HORIZON})`,
  )
  console.log(
    'kind      dose year  donor stance     cost  repaid   peak   above  parad  colps    dS100    dSend      pop%  leap%',
  )
  const cells: Cell[] = []
  for (const kind of DEBT_KINDS_PROBED) {
    for (const dose of DEBT_DOSES) {
      for (const year of DEBT_YEARS) {
        for (const donor of DONORS) {
          for (const stance of STANCES) {
            const traces = DEBT_SEEDS.map((seed) => trace(seed, kind, dose, year, donor, stance))
            const alive = traces.filter((t) => t.status !== 'skipped')
            if (alive.length === 0) continue
            cells.push({ kind, dose, stance, traces: alive })
            const repaid = alive.filter((t) => t.repaidAt >= 0).map((t) => t.repaidAt)
            console.log(
              `${kind.padEnd(10)}${String(dose).padEnd(5)}${String(year).padEnd(6)}` +
                `${donor.padEnd(6)}${stance.padEnd(10)}` +
                `${median(alive.map((t) => t.cost))
                  .toFixed(0)
                  .padStart(5)}` +
                `${(repaid.length === 0 ? 'never' : median(repaid).toFixed(0)).padStart(8)}` +
                `${median(alive.map((t) => t.peakRatio))
                  .toFixed(2)
                  .padStart(7)}` +
                `${median(alive.map((t) => t.longestAbove))
                  .toFixed(0)
                  .padStart(8)}` +
                `${(share(alive.map((t) => t.paradoxAt >= 0)) * 100).toFixed(0).padStart(6)}%` +
                `${(share(alive.map((t) => t.collapsedAt >= 0)) * 100).toFixed(0).padStart(6)}%` +
                `${median(alive.map((t) => t.stabilityDrop))
                  .toFixed(1)
                  .padStart(9)}` +
                `${median(alive.map((t) => t.stabilityEnd))
                  .toFixed(1)
                  .padStart(9)}` +
                `${(median(alive.map((t) => t.populationShare)) * 100).toFixed(0).padStart(9)}%` +
                `${(share(alive.map((t) => t.leap)) * 100).toFixed(0).padStart(6)}%`,
            )
          }
        }
      }
    }
  }
  summarise(cells)
}

// FEAT: a grade do espaço — semente × alocação, com o mesmo mundo de porta fechada como controle
const SPACE_SEEDS = [1, 7, 42, 4242, 482913, 99991, 1597463007, 0xffffffff]
const SPACE_HORIZON = 5000
const SPACE_STRATEGIES: Record<string, readonly Decision[]> = {
  balanced: [{ tick: 0, allocation: STRATEGIES.balanced ?? DONOR_ALLOCATION }],
  industrial: [{ tick: 0, allocation: STRATEGIES.industrial ?? DONOR_ALLOCATION }],
  research: [{ tick: 0, allocation: STRATEGIES.research ?? DONOR_ALLOCATION }],
  spacer: [
    { tick: 0, allocation: { agriculture: 20, industry: 50, research: 30, conservation: 0 } },
  ],
  turning: [
    { tick: 0, allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 } },
    { tick: 400, allocation: { agriculture: 25, industry: 45, research: 30, conservation: 0 } },
  ],
  tended: [
    { tick: 0, allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 } },
    { tick: 400, allocation: { agriculture: 25, industry: 45, research: 25, conservation: 5 } },
  ],
  late: [
    { tick: 0, allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 } },
    { tick: 1200, allocation: { agriculture: 25, industry: 45, research: 25, conservation: 5 } },
  ],
  reaching: [
    { tick: 0, allocation: { agriculture: 30, industry: 40, research: 25, conservation: 5 } },
  ],
  wavering: [
    { tick: 0, allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 } },
    { tick: 400, allocation: { agriculture: 25, industry: 45, research: 30, conservation: 0 } },
    { tick: 3000, allocation: { agriculture: 35, industry: 25, research: 25, conservation: 15 } },
    { tick: 3800, allocation: { agriculture: 25, industry: 45, research: 25, conservation: 5 } },
  ],
  abandons: [
    { tick: 0, allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 } },
    { tick: 400, allocation: { agriculture: 25, industry: 45, research: 30, conservation: 0 } },
    { tick: 3200, allocation: { agriculture: 40, industry: 15, research: 20, conservation: 25 } },
  ],
}

interface SpaceRun {
  readonly eraAt: number
  readonly founded: number
  readonly lost: number
  readonly selfAt: number
  readonly selfCount: number
  readonly colonies: number
  readonly support: number
  readonly offworld: number
  readonly population: number
  readonly crowding: readonly number[]
  readonly peakEnergy: number
  readonly status: string
  readonly ended: number
}

const SAMPLE = 50

function spaceRun(
  seed: number,
  decisions: readonly Decision[],
  crossings: readonly Crossing[],
  years: number,
  grounded: boolean,
): SpaceRun {
  const origin = genesis(seed)
  let s: WorldState = origin.state
  let decided = 0
  let crossed = 0
  let records = 0
  let eraAt = -1
  let founded = 0
  let lost = 0
  let selfAt = -1
  let peakEnergy = 0
  let seen: readonly Colony[] = []
  const crowding: number[] = []
  const key = (c: Colony) => `${c.body}:${c.founded}`
  while (s.tick < years && s.status === 'running') {
    const pending = decisions[decided]
    const due = pending?.tick === s.tick ? pending : undefined
    if (due) decided++
    const arriving: Crossing[] = []
    while (crossings[crossed]?.tick === s.tick) {
      const entry = crossings[crossed]
      if (entry) arriving.push(entry)
      crossed++
    }
    const input = grounded ? { ...s, eras: s.eras & ~Era.space } : s
    const result = step(input, origin.world, records, due, arriving)
    records += result.started.length
    s = result.state
    if (eraAt < 0 && (s.eras & Era.space) !== 0) eraAt = s.tick
    if (s.energy > peakEnergy) peakEnergy = s.energy
    const now = new Set(s.colonies.map(key))
    for (const old of seen) if (!now.has(key(old))) lost++
    const before = new Set(seen.map(key))
    for (const fresh of s.colonies) if (!before.has(key(fresh))) founded++
    if (selfAt < 0 && heir(s.colonies)) selfAt = s.tick
    seen = s.colonies
    if (s.tick % SAMPLE === 0) crowding.push(worldMetrics(s, origin.world).crowding)
  }
  return {
    eraAt,
    founded,
    lost,
    selfAt,
    selfCount: s.colonies.filter(selfSufficient).length,
    colonies: s.colonies.length,
    support: s.colonies.reduce((a, c) => Math.max(a, c.support), 0),
    offworld: s.colonies.reduce((a, c) => a + c.population, 0),
    population: s.population,
    crowding,
    peakEnergy,
    status: s.status,
    ended: s.tick,
  }
}

interface SpaceCell {
  readonly name: string
  readonly seed: number
  readonly left: SpaceRun
  readonly stayed: SpaceRun
  readonly relief: number
  readonly reliefEnd: number
}

function reliefOf(left: SpaceRun, stayed: SpaceRun): readonly number[] {
  const n = Math.min(left.crowding.length, stayed.crowding.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((stayed.crowding[i] ?? 0) - (left.crowding[i] ?? 0))
  return out
}

function spaceLine(cell: SpaceCell): void {
  const { left, stayed } = cell
  const at = (year: number) => (year < 0 ? 'never' : String(year)).padStart(6)
  console.log(
    `${`${cell.name} ${cell.seed}`.padEnd(26)}${at(left.eraAt)}${String(left.founded).padStart(5)}` +
      `${String(left.lost).padStart(5)}${String(left.selfCount).padStart(5)}${at(left.selfAt)}` +
      `${left.support.toFixed(2).padStart(7)}${(left.offworld / 1e3).toFixed(0).padStart(9)}k` +
      `${(100 * cell.relief).toFixed(2).padStart(8)}${(100 * cell.reliefEnd).toFixed(2).padStart(8)}` +
      `${(100 * (left.population / Math.max(1, stayed.population) - 1)).toFixed(1).padStart(8)}%` +
      `${left.peakEnergy.toFixed(2).padStart(7)}  ${left.status}@${left.ended}`,
  )
}

function spaceProbe(): void {
  console.log(
    `\n== space grid ==  ${SPACE_SEEDS.length} seeds × allocation  (horizon ${SPACE_HORIZON})`,
  )
  console.log(
    'cell                        era  fnd  lst self  selfAt support offworld  relief% endRel%   dPop%  peakE  status',
  )
  const cells: SpaceCell[] = []
  for (const [name, decisions] of Object.entries(SPACE_STRATEGIES)) {
    for (const seed of SPACE_SEEDS) {
      const left = spaceRun(seed, decisions, [], SPACE_HORIZON, false)
      const stayed = spaceRun(seed, decisions, [], SPACE_HORIZON, true)
      const gap = reliefOf(left, stayed)
      const cell: SpaceCell = {
        name,
        seed,
        left,
        stayed,
        relief: gap.length === 0 ? 0 : Math.max(...gap),
        reliefEnd: gap[gap.length - 1] ?? 0,
      }
      cells.push(cell)
      spaceLine(cell)
    }
  }

  console.log('\n-- reference scripts (none of these may reach the era) --')
  let reached = 0
  for (const script of ['steady', 'shifting', 'crossed'] as const) {
    const plan = GOLDEN_SCRIPTS[script]
    for (const seed of SPACE_SEEDS) {
      const left = spaceRun(seed, plan.decisions, plan.crossings, SPACE_HORIZON, false)
      if (left.eraAt >= 0) reached++
      console.log(
        `  ${script.padEnd(10)}${String(seed).padStart(11)}   era ${
          left.eraAt < 0 ? 'never' : left.eraAt
        }   peak energy ${left.peakEnergy.toFixed(2)}   ${left.status}@${left.ended}`,
      )
    }
  }

  const living = cells.filter((c) => c.left.status === 'running')
  const arrived = living.filter((c) => c.left.eraAt >= 0)
  const tried = arrived.filter((c) => c.left.founded > 0)
  const founded = arrived.reduce((a, c) => a + c.left.founded, 0)
  const lost = arrived.reduce((a, c) => a + c.left.lost, 0)
  console.log('\n-- summary --')
  console.log(`  reference scripts reaching the era   ${reached}  (must be 0)`)
  console.log(`  cells                                ${cells.length}, ${living.length} alive`)
  console.log(
    `  alive cells reaching the era         ${arrived.length}` +
      `   era med ${median(arrived.map((c) => c.left.eraAt)).toFixed(0)}` +
      `   earliest ${Math.min(...arrived.map((c) => c.left.eraAt))}`,
  )
  console.log(
    `  colonies founded ${founded}   lost ${lost}   loss share ${
      founded === 0 ? 'n/a' : (100 * (lost / founded)).toFixed(0) + '%'
    }   founded med ${median(tried.map((c) => c.left.founded)).toFixed(0)}`,
  )
  const selves = arrived.filter((c) => c.left.selfAt >= 0)
  console.log(
    `  cells with a self-sufficient colony  ${selves.length}/${arrived.length}` +
      `   selfAt med ${selves.length === 0 ? 'never' : median(selves.map((c) => c.left.selfAt)).toFixed(0)}` +
      `   wait med ${
        selves.length === 0
          ? 'n/a'
          : median(selves.map((c) => c.left.selfAt - c.left.eraAt)).toFixed(0)
      }`,
  )
  console.log(
    `  crowding relief (pp)  med ${(100 * median(arrived.map((c) => c.relief))).toFixed(2)}` +
      `   max ${(100 * Math.max(0, ...arrived.map((c) => c.relief))).toFixed(2)}` +
      `   at end med ${(100 * median(arrived.map((c) => c.reliefEnd))).toFixed(2)}`,
  )
  console.log(
    `  offworld share of the species  med ${(
      100 *
      median(arrived.map((c) => c.left.offworld / Math.max(1, c.left.offworld + c.left.population)))
    ).toFixed(1)}%`,
  )
}

const args = process.argv.slice(2)
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? 482913)
const mode = args.find((a) => a === 'debt' || a === 'strategies' || a === 'space') ?? 'all'
if (mode === 'space') spaceProbe()
else {
  if (mode !== 'debt') strategyProbe(seed)
  if (mode !== 'strategies') debtProbe()
}
