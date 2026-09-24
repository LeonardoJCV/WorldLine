import { foundColony, heir, inherit, tickColonies, type Colony } from './colony.ts'
import type { Crossing } from './crossing.ts'
import {
  addDebt,
  bearsDebt,
  debtOf,
  debtRatio,
  leapParadox,
  repay,
  resolveParadox,
  type Paradox,
} from './debt.ts'
import { addEcho, assimilate } from './echo.ts'
import {
  EVENTS,
  collectModifiers,
  computeMetrics,
  evaluateEvents,
  type Cause,
  type EventId,
  type EventRecord,
} from './events.ts'
import { PARADOX_GRACE } from './params.ts'
import { Channel, uniform } from './rng.ts'
import { derive, integrate } from './rules.ts'
import { Era, changedSectors, type Decision, type WorldConfig, type WorldState } from './state.ts'
import { system } from './system.ts'

export interface StepResult {
  readonly state: WorldState
  readonly started: readonly EventRecord[]
  readonly ended: readonly number[]
}

// FEAT: conhecimento e recursos viram eco; gente e doutrina entram de imediato
function applyCrossings(s: WorldState, crossings: readonly Crossing[]): WorldState {
  if (crossings.length === 0) return s
  let state = s
  for (const crossing of crossings) {
    const [first = 0, second = 0] = crossing.amounts
    if (crossing.kind === 'knowledge') {
      state = { ...state, echoes: addEcho(state.echoes, 'technology', first) }
    } else if (crossing.kind === 'resource') {
      const withFood = addEcho(state.echoes, 'food', first)
      state = { ...state, echoes: addEcho(withFood, 'energy', second) }
    } else if (crossing.kind === 'people') {
      const moved = crossing.direction === 'out' ? -first : first
      state = { ...state, population: Math.max(0, state.population + moved) }
    } else if (crossing.allocation) {
      state = { ...state, allocation: { ...crossing.allocation } }
    }
    state = { ...state, lastCrossing: { tick: crossing.tick, kind: crossing.kind } }
  }
  return state
}

// FEAT: cada travessia de conhecimento, recurso ou doutrina abre dívida no mesmo ano em que chega
function applyDebts(s: WorldState, crossings: readonly Crossing[]): WorldState {
  let debts = s.debts
  for (const crossing of crossings) {
    const debt = debtOf(crossing)
    if (debt) debts = addDebt(debts, debt)
  }
  return debts === s.debts ? s : { ...s, debts }
}

// FEAT: dois dos três caminhos do paradoxo nascem na própria travessia — o ciclo chega marcado
// pelo hospedeiro, porque a engine não conhece as outras worldlines; o terceiro é a dívida velha
function arrivingParadox(
  s: WorldState,
  world: WorldConfig,
  crossings: readonly Crossing[],
): Paradox | null {
  for (const crossing of crossings) {
    if (crossing.circular && bearsDebt(crossing.kind)) {
      return { kind: 'circular', since: s.tick, deadline: s.tick + PARADOX_GRACE }
    }
    if (leapParadox(crossing, s, world)) {
      return { kind: 'leap', since: s.tick, deadline: s.tick + PARADOX_GRACE }
    }
  }
  return null
}

interface Departure {
  readonly state: WorldState
  readonly migrated: number
  readonly started: readonly EventRecord[]
}

const NO_RECORDS: readonly EventRecord[] = []

// FEAT: uma colônia nasce e se perde dentro de um ano só, então o acontecimento já nasce fechado
function moment(event: EventId, tick: number, causes: readonly Cause[]): EventRecord {
  return { event, start: tick, end: tick, causes }
}

// FEAT: toda colônia desce da era espacial, e é por ela que a cadeia causal sobe
function spaceEra(s: WorldState): readonly Cause[] {
  const era = s.active.find((entry) => EVENTS[entry.def]?.id === 'space_era')
  return era ? [{ kind: 'event', record: era.record }] : []
}

// FEAT: a camada das colônias corre antes do derive: quem parte e a frota que o ano cobra mudam ele
function colonise(s: WorldState, world: WorldConfig, nextRecord: number): Departure {
  if ((s.eras & Era.space) === 0 && s.colonies.length === 0) {
    return { state: s, migrated: 0, started: NO_RECORDS }
  }
  const bodies = system(world.seed)
  const started: EventRecord[] = []
  const born = foundColony(s, bodies, s.tick, nextRecord)
  if (born) started.push(moment('colony_founded', s.tick, spaceEra(s)))
  const fleet: readonly Colony[] = born ? [...s.colonies, born] : s.colonies
  const year = tickColonies(fleet, s, bodies)
  for (const gone of fleet) {
    if (year.colonies.some((colony) => colony.body === gone.body)) continue
    started.push(moment('colony_lost', s.tick, [{ kind: 'event', record: gone.record }]))
  }
  return {
    state: {
      ...s,
      colonies: year.colonies,
      population: Math.max(0, s.population - year.migrated),
    },
    migrated: year.migrated,
    started,
  }
}

export function step(
  s: WorldState,
  world: WorldConfig,
  nextRecord: number,
  decision?: Decision,
  crossings: readonly Crossing[] = [],
): StepResult {
  if (s.status !== 'running') throw new Error(`worldline ended at year ${s.tick}`)
  if (decision && decision.tick !== s.tick) {
    throw new RangeError(`decision for year ${decision.tick} applied at year ${s.tick}`)
  }
  for (const crossing of crossings) {
    if (crossing.tick !== s.tick) {
      throw new RangeError(`crossing for year ${crossing.tick} applied at year ${s.tick}`)
    }
  }

  const decided: WorldState = decision
    ? {
        ...s,
        allocation: decision.allocation,
        lastDecision: { tick: s.tick, sectors: changedSectors(s.allocation, decision.allocation) },
      }
    : s
  const crossed = applyCrossings(decided, crossings)
  const assimilated = assimilate(crossed)
  const owing = applyDebts({ ...crossed, ...assimilated }, crossings)
  const departure = colonise(owing, world, nextRecord)
  const peopled = departure.state

  // Efeitos de eventos novos só entram no ano seguinte
  const mods = collectModifiers(peopled.active)
  const derived = derive(peopled, world, mods, uniform(world.seed, s.tick, Channel.harvest))

  // FIX: a quitação usa a produção do próprio ano, então só corre depois do derive
  const repaid = repay(peopled.debts, peopled, derived, s.tick)
  const ratio = debtRatio(repaid, peopled)
  // FEAT: um paradoxo em curso já tem prazo próprio; só um mundo livre recebe o da travessia
  const standing = peopled.paradox ?? arrivingParadox(decided, world, crossings)
  const resolution = resolveParadox(standing, repaid, ratio, peopled.strain, s.tick)
  const settled: WorldState = {
    ...peopled,
    debts: repaid,
    paradox: resolution.paradox,
    strain: resolution.strain,
  }

  const first = nextRecord + departure.started.length
  const outcome = evaluateEvents(settled, computeMetrics(settled, derived), world.seed, first)
  const integrated = integrate(settled, derived, mods, departure.migrated)
  const ending: WorldState = {
    ...integrated,
    eras: outcome.eras,
    active: outcome.active,
    lastEnded: outcome.lastEnded,
    status: outcome.extinct ? 'extinct' : outcome.collapsed ? 'collapsed' : 'running',
  }
  const started = [...departure.started, ...outcome.started]

  // FEAT: o herdeiro é lido no instante em que o mundo natal acaba, porque a autossuficiência
  // pode ter sido perdida no caminho; sem ele a realidade termina exatamente como sempre terminou
  const successor = ending.status === 'running' ? null : heir(ending.colonies)
  if (successor === null) return { state: ending, started, ended: outcome.ended }

  const terminal = outcome.started.findIndex(
    (r) => r.event === 'extinction' || r.event === 'collapse',
  )
  const causes: Cause[] = [{ kind: 'event', record: successor.record }]
  if (terminal >= 0) causes.unshift({ kind: 'event', record: first + terminal })
  // FEAT: as irmãs se perdem com o mundo que as pagava, e a história do mundo registra cada uma
  const orphans = ending.colonies
    .filter((colony) => colony.body !== successor.body)
    .map((colony) => moment('colony_lost', s.tick, [{ kind: 'event', record: colony.record }]))
  return {
    state: inherit(ending, successor, system(world.seed)[successor.body]),
    started: [...started, ...orphans, moment('inheritance', s.tick, causes)],
    ended: outcome.ended,
  }
}
