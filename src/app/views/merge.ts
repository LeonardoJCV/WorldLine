import { totalOwed } from '../../engine/debt.ts'
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

// FIX: população nem sempre soma — quando os lares divergem, mergeStates mantém só a história mais
// pesada, então o rótulo lê o que a costura FEZ desta vez (os três números), não uma lista fixa
const SUM_TOLERANCE = 1e-6

function kindOf(now: number, next: number, incoming: number): 'sum' | 'blend' {
  const scale = Math.max(1, Math.abs(now), Math.abs(incoming))
  return Math.abs(next - (now + incoming)) <= SUM_TOLERANCE * scale ? 'sum' : 'blend'
}

// FEAT: a tela nunca calcula a costura; ela só compara os snapshots e o abalo que o hospedeiro já rendeu
export function seamView(
  now: Snapshot,
  seamed: Snapshot,
  incoming: Snapshot,
  shock: number,
): SeamView {
  const rows = VARIABLES.map((variable) => {
    const before = now.values[variable]
    const next = seamed.values[variable]
    const arriving = incoming.values[variable]
    return { variable, now: before, next, kind: kindOf(before, next, arriving) }
  })

  const debtIn = totalOwed(incoming.debts)
  const debtSettled = totalOwed(now.debts) + totalOwed(incoming.debts) - totalOwed(seamed.debts)

  return { rows, shock, debtIn, debtSettled }
}
