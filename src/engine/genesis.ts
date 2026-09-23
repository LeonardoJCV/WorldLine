import { EVENTS } from './events.ts'
import {
  DEFAULT_ALLOCATION,
  GENESIS_ECONOMY,
  GENESIS_FOOD_RESERVE,
  GENESIS_RANGES,
  GENESIS_STABILITY,
  MAX_SEED,
} from './params.ts'
import { Channel, uniform } from './rng.ts'
import { NEVER, type WorldConfig, type WorldState } from './state.ts'

export function genesis(seed: number): { readonly world: WorldConfig; readonly state: WorldState } {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`seed must be an integer between 0 and ${MAX_SEED}`)
  }
  const draw = (offset: number, [min, max]: readonly [number, number]) =>
    min + (max - min) * uniform(seed, 0, Channel.genesis + offset)

  const population = draw(0, GENESIS_RANGES.population)
  return {
    world: { seed, fertility: draw(4, GENESIS_RANGES.fertility) },
    state: {
      tick: 0,
      population,
      food: population * GENESIS_FOOD_RESERVE,
      energy: draw(3, GENESIS_RANGES.energy),
      technology: draw(1, GENESIS_RANGES.technology),
      economy: GENESIS_ECONOMY,
      environment: draw(2, GENESIS_RANGES.environment),
      stability: GENESIS_STABILITY,
      allocation: DEFAULT_ALLOCATION,
      recentEconomy: new Array<number>(5).fill(GENESIS_ECONOMY),
      eras: 0,
      active: [],
      lastEnded: EVENTS.map(() => NEVER),
      lastDecision: null,
      echoes: [],
      lastCrossing: null,
      debts: [],
      paradox: null,
      status: 'running',
    },
  }
}
