import type { CrossingKind } from './crossing.ts'
import type { Echo } from './echo.ts'

export const SECTORS = ['agriculture', 'industry', 'research', 'conservation'] as const
export type Sector = (typeof SECTORS)[number]
export type Allocation = Readonly<Record<Sector, number>>

export const VARIABLES = [
  'population',
  'food',
  'energy',
  'technology',
  'economy',
  'environment',
  'stability',
] as const
export type Variable = (typeof VARIABLES)[number]

export const Era = { agricultural: 1, industrial: 2, demographic: 4 } as const

export const NEVER = -1_000_000

export interface Decision {
  readonly tick: number
  readonly allocation: Allocation
}

export interface ActiveEvent {
  readonly def: number
  readonly record: number
  readonly start: number
}

export type Status = 'running' | 'extinct'

export interface WorldConfig {
  readonly seed: number
  readonly fertility: number
}

export interface WorldState {
  readonly tick: number
  readonly population: number
  readonly food: number
  readonly energy: number
  readonly technology: number
  readonly economy: number
  readonly environment: number
  readonly stability: number
  readonly allocation: Allocation
  readonly recentEconomy: readonly number[]
  readonly eras: number
  readonly active: readonly ActiveEvent[]
  readonly lastEnded: readonly number[]
  readonly lastDecision: { readonly tick: number; readonly sectors: readonly Sector[] } | null
  readonly echoes: readonly Echo[]
  readonly lastCrossing: { readonly tick: number; readonly kind: CrossingKind } | null
  readonly status: Status
}

export function isValidAllocation(allocation: Allocation): boolean {
  let total = 0
  for (const sector of SECTORS) {
    const value = allocation[sector]
    if (!Number.isInteger(value) || value < 0 || value > 100) return false
    total += value
  }
  return total === 100
}

export function changedSectors(before: Allocation, after: Allocation): Sector[] {
  return SECTORS.filter((sector) => before[sector] !== after[sector])
}

export function hasEra(state: WorldState, era: number): boolean {
  return (state.eras & era) !== 0
}
