import { totalOwed, type Debt, type DebtKind, type Paradox } from '../../engine/debt.ts'

export type DebtTrend = 'rising' | 'falling' | 'steady'

export interface DebtView {
  readonly total: number
  readonly trend: DebtTrend
  readonly kinds: readonly DebtKind[] // espécies em aberto, para dizer como quitar
  readonly origins: readonly string[] // de quem se deve, sem repetição
}

export interface ParadoxView {
  readonly kind: Paradox['kind']
  readonly yearsLeft: number // até o prazo, a partir do ano observado
  readonly owed: number
}

// FEAT: sem lista anterior não há o que comparar, então a tendência fica parada
function trendOf(total: number, previous: readonly Debt[] | null): DebtTrend {
  if (previous === null) return 'steady'
  const before = totalOwed(previous)
  if (total > before) return 'rising'
  if (total < before) return 'falling'
  return 'steady'
}

// FEAT: primeira aparição decide a ordem, para a lista não embaralhar entre quadros
function stableUnique<T>(values: readonly T[]): readonly T[] {
  const seen = new Set<T>()
  const unique: T[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    unique.push(value)
  }
  return unique
}

export function debtView(
  debts: readonly Debt[],
  previous: readonly Debt[] | null,
): DebtView | null {
  if (debts.length === 0) return null
  return {
    total: totalOwed(debts),
    trend: trendOf(totalOwed(debts), previous),
    kinds: stableUnique(debts.map((debt) => debt.kind)),
    origins: stableUnique(debts.map((debt) => debt.origin)),
  }
}

export function paradoxView(
  paradox: Paradox | null,
  debts: readonly Debt[],
  observed: number,
): ParadoxView | null {
  if (paradox === null) return null
  return {
    kind: paradox.kind,
    yearsLeft: Math.max(0, paradox.deadline - observed),
    owed: totalOwed(debts),
  }
}

const REPAY_HINTS: Record<DebtKind, 'research' | 'production' | 'doctrine'> = {
  knowledge: 'research',
  resource: 'production',
  doctrine: 'doctrine',
}

export function repayHint(
  kinds: readonly DebtKind[],
): 'research' | 'production' | 'doctrine' | 'mixed' | null {
  const unique = stableUnique(kinds)
  if (unique.length === 0) return null
  if (unique.length > 1) return 'mixed'
  const [kind] = unique
  return kind ? REPAY_HINTS[kind] : null
}
