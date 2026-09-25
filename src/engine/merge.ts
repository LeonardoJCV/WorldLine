import type { Colony } from './colony.ts'
import { addDebt, type Debt, type Paradox } from './debt.ts'
import type { Echo } from './echo.ts'
import { clamp } from './math.ts'
import { MERGE_SHOCK } from './params.ts'
import { NEVER, type Variable, type WorldState } from './state.ts'

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

export function mergeColonies(
  own: readonly Colony[],
  incoming: readonly Colony[],
  weights: { readonly a: number; readonly b: number },
): readonly Colony[] {
  const byBody = new Map<number, Colony>(own.map((colony) => [colony.body, colony]))
  for (const colony of incoming) {
    const there = byBody.get(colony.body)
    if (there === undefined) {
      byBody.set(colony.body, colony)
      continue
    }
    const older = there.founded <= colony.founded ? there : colony
    byBody.set(colony.body, {
      body: colony.body,
      founded: older.founded,
      population: there.population + colony.population,
      support: there.support * weights.a + colony.support * weights.b,
      record: older.record,
    })
  }
  return [...byBody.values()].sort((a, b) => a.body - b.body)
}

export function mergeStates(s: WorldState, incoming: Merge): WorldState {
  const value = (variable: Variable): number => incoming.values?.[variable] ?? 0
  const weights = mergeWeights(s.population, value('population'))
  const blend = (variable: Variable): number =>
    s[variable] * weights.a + value(variable) * weights.b
  const incomingColonies = incoming.colonies ?? []

  const ownHome = s.home ?? incoming.natal
  const otherHome = incoming.home ?? incoming.natal
  const sameHome = ownHome === otherHome
  const ownHeavier = s.population >= value('population')
  const ownLostHome = !sameHome && !ownHeavier
  const otherLostHome = !sameHome && ownHeavier

  // FEAT: lares diferentes não somam gente; a história mais leve perde a casa, não o povo — o
  // lar dela vira colônia da vencedora, com support 1 porque quem já se bastava segue se bastando
  const demoted = (body: number, population: number): Colony => ({
    body,
    founded: incoming.tick,
    population,
    support: 1,
    record: NEVER,
  })

  const ownFleet = ownLostHome ? [...s.colonies, demoted(ownHome, s.population)] : s.colonies
  const otherFleet = otherLostHome
    ? [...incomingColonies, demoted(otherHome, value('population'))]
    : incomingColonies

  return {
    ...s,
    home: sameHome || ownHeavier ? s.home : (incoming.home ?? null),
    population: sameHome
      ? s.population + value('population')
      : ownHeavier
        ? s.population
        : value('population'),
    food: s.food + value('food'),
    energy: blend('energy'),
    technology: blend('technology'),
    economy: blend('economy'),
    environment: blend('environment'),
    stability: clamp(blend('stability') - MERGE_SHOCK, 0, 100),
    colonies: mergeColonies(ownFleet, otherFleet, weights),
    debts: settleDebts(s.debts, incoming.debts ?? [], [incoming.self, incoming.other]),
    echoes: [...s.echoes, ...(incoming.echoes ?? [])],
    paradox: nearerParadox(s.paradox, incoming.paradox ?? null),
    strain: Math.max(s.strain, incoming.strain ?? 0),
  }
}
