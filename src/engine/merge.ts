import type { Colony } from './colony.ts'
import { addDebt, type Debt, type Paradox } from './debt.ts'
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

// FEAT: dívida cuja origem é uma das duas que se mesclam virou interna, e interna não é dívida
export function settleDebts(
  own: readonly Debt[],
  incoming: readonly Debt[],
  between: readonly [string, string],
): readonly Debt[] {
  const external = [...own, ...incoming].filter((debt) => !between.includes(debt.origin))
  return external.reduce<readonly Debt[]>((debts, debt) => addDebt(debts, debt), [])
}

// FEAT: o prazo mais próximo é o que mata primeiro, então é ele que sobrevive à costura
function nearerParadox(a: Paradox | null, b: Paradox | null): Paradox | null {
  if (!a) return b
  if (!b) return a
  return a.deadline <= b.deadline ? a : b
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
    debts: settleDebts(s.debts, incoming.debts ?? [], [incoming.self, incoming.other]),
    echoes: [...s.echoes, ...(incoming.echoes ?? [])],
    paradox: nearerParadox(s.paradox, incoming.paradox ?? null),
    strain: Math.max(s.strain, incoming.strain ?? 0),
  }
}
