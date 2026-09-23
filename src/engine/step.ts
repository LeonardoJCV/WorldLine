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
import { collectModifiers, computeMetrics, evaluateEvents, type EventRecord } from './events.ts'
import { PARADOX_GRACE } from './params.ts'
import { Channel, uniform } from './rng.ts'
import { derive, integrate } from './rules.ts'
import { changedSectors, type Decision, type WorldConfig, type WorldState } from './state.ts'

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

  // Efeitos de eventos novos só entram no ano seguinte
  const mods = collectModifiers(owing.active)
  const derived = derive(owing, world, mods, uniform(world.seed, s.tick, Channel.harvest))

  // FIX: a quitação usa a produção do próprio ano, então só corre depois do derive
  const repaid = repay(owing.debts, owing, derived, s.tick)
  const ratio = debtRatio(repaid, owing)
  // FEAT: um paradoxo em curso já tem prazo próprio; só um mundo livre recebe o da travessia
  const standing = owing.paradox ?? arrivingParadox(decided, world, crossings)
  const resolution = resolveParadox(standing, repaid, ratio, owing.strain, s.tick)
  const settled: WorldState = {
    ...owing,
    debts: repaid,
    paradox: resolution.paradox,
    strain: resolution.strain,
  }

  const outcome = evaluateEvents(settled, computeMetrics(settled, derived), world.seed, nextRecord)
  const integrated = integrate(settled, derived, mods)

  return {
    state: {
      ...integrated,
      eras: outcome.eras,
      active: outcome.active,
      lastEnded: outcome.lastEnded,
      status: outcome.extinct ? 'extinct' : outcome.collapsed ? 'collapsed' : 'running',
    },
    started: outcome.started,
    ended: outcome.ended,
  }
}
