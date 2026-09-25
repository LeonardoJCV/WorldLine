import type { Colony } from './colony.ts'
import type { Debt, Paradox } from './debt.ts'
import type { Echo } from './echo.ts'
import { clamp } from './math.ts'
import { MERGE_SHOCK } from './params.ts'
import type { Variable, WorldState } from './state.ts'

export interface Merge {
  readonly tick: number
  // FEAT: nomes no recibo, não física — o motor nunca resolve nenhum dos dois para uma worldline
  readonly self: string
  readonly other: string
  readonly direction: 'in' | 'out'
  // FEAT: o corpo natal, igual para as duas porque o multiverso tem uma semente só
  readonly natal: number
  readonly values?: Readonly<Record<Variable, number>>
  readonly debts?: readonly Debt[]
  readonly echoes?: readonly Echo[]
  readonly paradox?: Paradox | null
  readonly strain?: number
  readonly colonies?: readonly Colony[]
  readonly home?: number | null
}

// FEAT: 0/0 nunca divide; sem gente dos dois lados a costura reparte ao meio
export function mergeWeights(a: number, b: number): { readonly a: number; readonly b: number } {
  const total = a + b
  if (total === 0) return { a: 0.5, b: 0.5 }
  return { a: a / total, b: b / total }
}

export function mergeStates(s: WorldState, incoming: Merge): WorldState {
  const value = (variable: Variable): number => incoming.values?.[variable] ?? 0
  const weights = mergeWeights(s.population, value('population'))
  const blend = (variable: Variable): number =>
    s[variable] * weights.a + value(variable) * weights.b

  return {
    ...s,
    population: s.population + value('population'),
    food: s.food + value('food'),
    energy: blend('energy'),
    technology: blend('technology'),
    economy: blend('economy'),
    environment: blend('environment'),
    stability: clamp(blend('stability') - MERGE_SHOCK, 0, 100),
  }
}
