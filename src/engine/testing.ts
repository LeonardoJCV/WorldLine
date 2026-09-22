import { DEFAULT_ALLOCATION } from './params.ts'
import type { WorldConfig, WorldState } from './state.ts'
import type { Metrics } from './events.ts'

export const TEST_WORLD: WorldConfig = { seed: 1, fertility: 1 }

export function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: 0,
    population: 1e6,
    food: 3e5,
    energy: 0.5,
    technology: 5,
    economy: 1,
    environment: 85,
    stability: 60,
    allocation: DEFAULT_ALLOCATION,
    recentEconomy: [1, 1, 1, 1, 1],
    eras: 0,
    active: [],
    lastEnded: [],
    lastDecision: null,
    echoes: [],
    lastCrossing: null,
    status: 'running',
    ...overrides,
  }
}

export function makeMetrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    population: 1e6,
    food: 3e5,
    energy: 1,
    technology: 10,
    economy: 1,
    environment: 80,
    stability: 60,
    foodSecurity: 1.2,
    crowding: 0.5,
    energyRatio: 0.9,
    economyTrend: 1.01,
    birthRate: 0.03,
    ...overrides,
  }
}
