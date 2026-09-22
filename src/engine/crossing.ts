import { HORIZON } from './params.ts'
import { isValidAllocation, type Allocation, type WorldState } from './state.ts'

export const CROSSING_KINDS = ['knowledge', 'resource', 'doctrine', 'people'] as const
export type CrossingKind = (typeof CROSSING_KINDS)[number]
export const DOSES = [1, 2, 3] as const
export type Dose = (typeof DOSES)[number]

export interface Crossing {
  readonly tick: number
  readonly kind: CrossingKind
  readonly dose: Dose
  readonly amounts: readonly number[]
  readonly origin: { readonly world: string; readonly tick: number }
  readonly cost: number
  readonly direction: 'in' | 'out'
  readonly allocation?: Allocation
}

export interface CreditWorld {
  readonly tick: number
  readonly ended: boolean
  readonly spent: number
}

export const CROSSING_BASE: Readonly<Record<CrossingKind, number>> = {
  doctrine: 1,
  resource: 2,
  knowledge: 3,
  people: 3,
}

const SHARE: Readonly<Record<CrossingKind, number>> = {
  knowledge: 0.08,
  resource: 0.15,
  doctrine: 0,
  people: 0.05,
}

const PARCELS: Readonly<Record<CrossingKind, number>> = {
  knowledge: 1,
  resource: 2,
  doctrine: 0,
  people: 1,
}

// FEAT: descarta valores não finitos ou não positivos antes de compor uma dose
function safe(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function crossingCost(kind: CrossingKind, dose: Dose, distance: number): number {
  const spread = 1 + Math.min(1, Math.max(0, Number.isFinite(distance) ? distance : 0))
  return Math.max(1, Math.ceil(CROSSING_BASE[kind] * dose * spread))
}

export function crossingAmounts(
  kind: CrossingKind,
  dose: Dose,
  origin: Readonly<Pick<WorldState, 'technology' | 'food' | 'energy' | 'population'>>,
): number[] {
  const share = SHARE[kind] * dose
  if (kind === 'knowledge') return [share * safe(origin.technology)]
  if (kind === 'resource') return [share * safe(origin.food), share * safe(origin.energy)]
  if (kind === 'people') return [share * safe(origin.population)]
  return []
}

export function credit(worlds: readonly CreditWorld[]): number {
  let years = 0
  let living = 0
  let spent = 0
  // FIX: só realidade viva soma anos à capacidade; o que ela gastou continua gasto depois de morrer
  for (const world of worlds) {
    spent += Math.max(0, world.spent)
    if (world.ended) continue
    years += Math.max(0, world.tick)
    living++
  }
  const capacity = 2 + 2 * Math.max(0, living - 1) + Math.floor(years / 1000)
  return capacity - spent
}

export function validateCrossings(crossings: readonly Crossing[]): Crossing[] {
  let previous = -1
  for (const crossing of crossings) {
    if (
      !Number.isInteger(crossing.tick) ||
      crossing.tick < 0 ||
      crossing.tick < previous ||
      crossing.tick >= HORIZON
    ) {
      throw new RangeError('crossings must have whole years in order inside the horizon')
    }
    if (crossing.amounts.length !== PARCELS[crossing.kind]) {
      throw new RangeError(`crossing of ${crossing.kind} needs ${PARCELS[crossing.kind]} parcels`)
    }
    for (const amount of crossing.amounts) {
      if (!Number.isFinite(amount) || amount < 0)
        throw new RangeError('crossing amounts must be finite and positive')
    }
    if (!Number.isFinite(crossing.cost) || crossing.cost < 0) {
      throw new RangeError('a crossing costs a finite number of credits')
    }
    if (crossing.direction === 'out' && crossing.kind !== 'people') {
      throw new RangeError('only people leave a worldline')
    }
    if (
      crossing.kind === 'doctrine' &&
      !isValidAllocation(crossing.allocation ?? ({} as Allocation))
    ) {
      throw new RangeError('a doctrine crossing carries an allocation')
    }
    // FIX: o link não sabe escrever alocação fora da doutrina, então os dois formatos só combinam recusando-a
    if (crossing.kind !== 'doctrine' && crossing.allocation !== undefined) {
      throw new RangeError('only a doctrine crossing carries an allocation')
    }
    previous = crossing.tick
  }
  return crossings.map((c) => ({
    ...c,
    amounts: [...c.amounts],
    origin: { ...c.origin },
    ...(c.allocation ? { allocation: { ...c.allocation } } : {}),
  }))
}
