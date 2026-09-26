import { totalOwed } from '../../engine/debt.ts'
import { mergeWeights } from '../../engine/merge.ts'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { Snapshot } from '../../worker/protocol.ts'

export interface SeamRow {
  readonly variable: Variable
  readonly now: number
  readonly next: number
  readonly kind: 'sum' | 'blend'
}

export interface SeamView {
  readonly rows: readonly SeamRow[]
  readonly shock: number
  readonly debtIn: number
  readonly debtSettled: number
}

// FEAT: só estas duas grandezas somam na costura; mergeStates mistura as outras cinco pelo povo
const SUMMED = new Set<Variable>(['population', 'food'])

function kindOf(variable: Variable): 'sum' | 'blend' {
  return SUMMED.has(variable) ? 'sum' : 'blend'
}

// FEAT: a tela nunca calcula a costura; ela só compara os três snapshots que o hospedeiro já rendeu
export function seamView(now: Snapshot, seamed: Snapshot, incoming: Snapshot): SeamView {
  const rows = VARIABLES.map((variable) => ({
    variable,
    now: now.values[variable],
    next: seamed.values[variable],
    kind: kindOf(variable),
  }))

  // FIX: o mesmo peso que a mistura usaria, sem repetir a mistura em si — só a estabilidade cobra abalo
  const weights = mergeWeights(now.values.population, incoming.values.population)
  const predicted = now.values.stability * weights.a + incoming.values.stability * weights.b
  const shock = predicted - seamed.values.stability

  const debtIn = totalOwed(incoming.debts)
  const debtSettled = totalOwed(now.debts) + totalOwed(incoming.debts) - totalOwed(seamed.debts)

  return { rows, shock, debtIn, debtSettled }
}
