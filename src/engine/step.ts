import { collectModifiers, computeMetrics, evaluateEvents, type EventRecord } from './events.ts'
import { Channel, uniform } from './rng.ts'
import { derive, integrate } from './rules.ts'
import { changedSectors, type Decision, type WorldConfig, type WorldState } from './state.ts'

export interface StepResult {
  readonly state: WorldState
  readonly started: readonly EventRecord[]
  readonly ended: readonly number[]
}

export function step(
  s: WorldState,
  world: WorldConfig,
  nextRecord: number,
  decision?: Decision,
): StepResult {
  if (s.status !== 'running') throw new Error(`worldline ended at year ${s.tick}`)
  if (decision && decision.tick !== s.tick) {
    throw new RangeError(`decision for year ${decision.tick} applied at year ${s.tick}`)
  }

  const current: WorldState = decision
    ? {
        ...s,
        allocation: decision.allocation,
        lastDecision: { tick: s.tick, sectors: changedSectors(s.allocation, decision.allocation) },
      }
    : s

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
