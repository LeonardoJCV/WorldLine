import type { Crossing, Dose } from './crossing.ts'
import {
  DEBT_EPSILON,
  PARADOX_GRACE,
  PARADOX_LEAP,
  PARADOX_PATIENCE,
  PARADOX_RATIO,
  REPAY_SCALE,
} from './params.ts'
import type { Derived } from './rules.ts'
import { Era, hasEra, type WorldState } from './state.ts'

export const DEBT_KINDS = ['knowledge', 'resource', 'doctrine'] as const
export type DebtKind = (typeof DEBT_KINDS)[number]

export const PARADOX_KINDS = ['debt', 'leap', 'circular'] as const
export type ParadoxKind = (typeof PARADOX_KINDS)[number]

export interface Debt {
  readonly kind: DebtKind
  readonly owed: number
  readonly since: number
  readonly origin: string
}

export interface Paradox {
  readonly kind: ParadoxKind
  readonly since: number
  readonly deadline: number
}

export interface ParadoxResolution {
  readonly paradox: Paradox | null
  readonly collapsed: boolean
  readonly strain: number
}

// FEAT: presente cedo demais exige uma era mínima; dose 1 nunca exige (palpite calibrável na Tarefa 6)
const DOSE_ERA: Readonly<Record<Dose, number>> = {
  1: 0,
  2: Era.agricultural,
  3: Era.industrial,
}

export function debtOf(crossing: Crossing): Debt | null {
  if (crossing.kind === 'people') return null
  return {
    kind: crossing.kind,
    owed: crossing.cost,
    since: crossing.tick,
    origin: crossing.origin.world,
  }
}

export function addDebt(debts: readonly Debt[], entry: Debt): readonly Debt[] {
  const existing = debts.find((debt) => debt.kind === entry.kind && debt.origin === entry.origin)
  if (!existing) return [...debts, entry]
  return debts.map((debt) =>
    debt === existing
      ? { ...debt, owed: debt.owed + entry.owed, since: Math.min(debt.since, entry.since) }
      : debt,
  )
}

export function totalOwed(debts: readonly Debt[]): number {
  let total = 0
  for (const debt of debts) total += debt.owed
  return total
}

export function debtRatio(debts: readonly Debt[], s: WorldState): number {
  // FIX: economia nunca fica negativa de verdade, mas a razão não pode explodir se ficar perto de zero
  return totalOwed(debts) / (Math.max(0, s.economy) + DEBT_EPSILON)
}

export function repay(
  debts: readonly Debt[],
  s: WorldState,
  d: Derived,
  year: number,
): readonly Debt[] {
  const researchShare = s.allocation.research / 100
  const knowledgeGain =
    REPAY_SCALE.knowledge *
    researchShare *
    Math.sqrt(Math.max(0, s.economy)) *
    (1 - s.technology / 100)
  const foodSurplus = Math.max(0, d.foodAvailable - s.population)
  const energySurplus = Math.max(0, s.energy - d.energyTarget)
  const resourceGain = REPAY_SCALE.resource * (foodSurplus + energySurplus)

  return debts
    .map((debt) => {
      if (debt.kind === 'knowledge')
        return { ...debt, owed: Math.max(0, debt.owed - knowledgeGain) }
      if (debt.kind === 'resource') return { ...debt, owed: Math.max(0, debt.owed - resourceGain) }
      // FEAT: uma doutrina só conta como "mantida" a partir do ano seguinte ao que chegou
      const doctrineGain = year > debt.since ? REPAY_SCALE.doctrine : 0
      return { ...debt, owed: Math.max(0, debt.owed - doctrineGain) }
    })
    .filter((debt) => debt.owed >= DEBT_EPSILON)
}

function overshoot(amount: number, have: number): boolean {
  return amount > PARADOX_LEAP * have
}

function magnitudeLeap(crossing: Crossing, s: WorldState): boolean {
  const amounts = crossing.amounts
  if (crossing.kind === 'knowledge') return overshoot(amounts[0] ?? 0, s.technology)
  if (crossing.kind === 'people') return overshoot(amounts[0] ?? 0, s.population)
  if (crossing.kind === 'resource') {
    return overshoot(amounts[0] ?? 0, s.food) || overshoot(amounts[1] ?? 0, s.energy)
  }
  return false
}

function eraLeap(crossing: Crossing, s: WorldState): boolean {
  const required = DOSE_ERA[crossing.dose]
  return required !== 0 && !hasEra(s, required)
}

export function leapParadox(crossing: Crossing, s: WorldState): boolean {
  return magnitudeLeap(crossing, s) || eraLeap(crossing, s)
}

export function circularParadox(
  origin: string,
  destination: string,
  ledgers: ReadonlyMap<string, readonly Debt[]>,
): boolean {
  if (origin === destination) return false
  const visited = new Set<string>()
  let frontier = [origin]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const world of frontier) {
      if (visited.has(world)) continue
      visited.add(world)
      const debts = ledgers.get(world) ?? []
      for (const debt of debts) {
        if (debt.origin === destination) return true
        if (!visited.has(debt.origin)) next.push(debt.origin)
      }
    }
    frontier = next
  }
  return false
}

export function resolveParadox(
  current: Paradox | null,
  debts: readonly Debt[],
  ratio: number,
  strain: number,
  year: number,
): ParadoxResolution {
  if (debts.length === 0) return { paradox: null, collapsed: false, strain: 0 }

  if (current) {
    const collapsed = year >= current.deadline
    return { paradox: current, collapsed, strain }
  }

  const nextStrain = ratio > PARADOX_RATIO ? strain + 1 : 0
  if (nextStrain >= PARADOX_PATIENCE) {
    return {
      paradox: { kind: 'debt', since: year, deadline: year + PARADOX_GRACE },
      collapsed: false,
      strain: nextStrain,
    }
  }
  return { paradox: null, collapsed: false, strain: nextStrain }
}
