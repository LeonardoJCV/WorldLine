import type { Crossing } from './crossing.ts'
import { addEcho, assimilate } from './echo.ts'
import { collectModifiers, computeMetrics, evaluateEvents, type EventRecord } from './events.ts'
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
  const current: WorldState = { ...crossed, ...assimilated }

  // Efeitos de eventos novos só entram no ano seguinte
  const mods = collectModifiers(current.active)
  const derived = derive(current, world, mods, uniform(world.seed, s.tick, Channel.harvest))
  const outcome = evaluateEvents(current, computeMetrics(current, derived), world.seed, nextRecord)
  const integrated = integrate(current, derived, mods)

  return {
    state: {
      ...integrated,
      eras: outcome.eras,
      active: outcome.active,
      lastEnded: outcome.lastEnded,
      status: outcome.extinct ? 'extinct' : 'running',
    },
    started: outcome.started,
    ended: outcome.ended,
  }
}
