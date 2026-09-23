import type { Crossing } from './crossing.ts'
import { EVENTS, holds, worldDerived, worldMetrics, type Metrics } from './events.ts'
import {
  DEBT_EPSILON,
  DEBT_POP_UNIT,
  DEBT_SIZE_FLOOR,
  PARADOX_GRACE,
  PARADOX_LEAP,
  PARADOX_PATIENCE,
  PARADOX_RATIO,
  REPAY_SCALE,
} from './params.ts'
import type { Derived } from './rules.ts'
import {
  changedSectors,
  hasEra,
  type Allocation,
  type WorldConfig,
  type WorldState,
} from './state.ts'

export const DEBT_KINDS = ['knowledge', 'resource', 'doctrine'] as const
export type DebtKind = (typeof DEBT_KINDS)[number]

export const PARADOX_KINDS = ['debt', 'leap', 'circular'] as const
export type ParadoxKind = (typeof PARADOX_KINDS)[number]

export interface Debt {
  readonly kind: DebtKind
  readonly owed: number
  readonly since: number
  readonly origin: string
  // FEAT: só a doutrina carrega a alocação recebida, para a quitação saber o que "manter" significa
  readonly allocation?: Allocation
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

export function debtOf(crossing: Crossing): Debt | null {
  if (crossing.kind === 'people') return null
  const debt: Debt = {
    kind: crossing.kind,
    owed: crossing.cost,
    since: crossing.tick,
    origin: crossing.origin.world,
  }
  if (crossing.kind === 'doctrine' && crossing.allocation) {
    return { ...debt, allocation: crossing.allocation }
  }
  return debt
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

// FEAT: o "tamanho do mundo" da spec é a produção inteira — riqueza por pessoa vezes gente —,
// não a economia sozinha, que satura perto de 10 e é sempre menor que o custo de uma travessia
export function worldSize(s: WorldState): number {
  return (Math.max(0, s.economy) * Math.max(0, s.population)) / DEBT_POP_UNIT
}

export function debtRatio(debts: readonly Debt[], s: WorldState): number {
  // FIX: o piso impede que um mundo recém-nascido tenha razão infinita por ser pequeno
  return totalOwed(debts) / (DEBT_SIZE_FLOOR + worldSize(s))
}

// FEAT: nunca deixa a quitação passar de zero, mesmo que o ganho do ano supere o que falta
export function clampRepayment(owed: number, gain: number): number {
  return Math.max(0, owed - gain)
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
  // FIX: foodProduction e energyTarget são funções da capacidade/mão-de-obra/indústria do próprio
  // mundo — não do estoque de comida ou energia, que é exatamente o que uma travessia de recurso
  // alimenta pelos ecos. Usar d.foodAvailable ou s.energy faria o presente quitar a si mesmo.
  const foodSurplus = Math.max(0, d.foodProduction - s.population)
  const resourceGain = REPAY_SCALE.resource * (foodSurplus + d.energyTarget)

  return debts
    .map((debt) => {
      if (debt.kind === 'knowledge')
        return { ...debt, owed: clampRepayment(debt.owed, knowledgeGain) }
      if (debt.kind === 'resource')
        return { ...debt, owed: clampRepayment(debt.owed, resourceGain) }
      // FEAT: uma doutrina só conta como "mantida" a partir do ano seguinte ao que chegou, e só
      // enquanto o mundo, por decisão própria, ainda roda a alocação exata que recebeu
      const kept =
        year > debt.since &&
        debt.allocation !== undefined &&
        changedSectors(debt.allocation, s.allocation).length === 0
      const doctrineGain = kept ? REPAY_SCALE.doctrine : 0
      return { ...debt, owed: clampRepayment(debt.owed, doctrineGain) }
    })
    .filter((debt) => debt.owed >= DEBT_EPSILON)
}

function overshoot(amount: number, have: number): boolean {
  return amount > PARADOX_LEAP * have
}

// FIX: comida e energia são estoques que um mundo vivendo do que colhe carrega perto de zero, e
// contra eles qualquer ajuda parecia desmedida; a grandeza honesta é o que o mundo produz num ano,
// a mesma que a quitação de recurso já usa. Tecnologia e gente não são estoques desse feitio.
function magnitudeLeap(crossing: Crossing, s: WorldState, world: WorldConfig): boolean {
  const amounts = crossing.amounts
  if (crossing.kind === 'knowledge') return overshoot(amounts[0] ?? 0, s.technology)
  if (crossing.kind === 'people') return overshoot(amounts[0] ?? 0, s.population)
  if (crossing.kind === 'resource') {
    const d = worldDerived(s, world)
    return (
      overshoot(amounts[0] ?? 0, d.foodProduction) || overshoot(amounts[1] ?? 0, d.energyTarget)
    )
  }
  return false
}

// FEAT: o mundo que existiria se a travessia caísse inteira de uma vez, para perguntar o que ela
// sozinha destrancaria; a doutrina não move nenhuma grandeza e devolve o mundo como está
function landed(s: WorldState, crossing: Crossing): WorldState {
  const [first = 0, second = 0] = crossing.amounts
  if (crossing.kind === 'knowledge') return { ...s, technology: s.technology + first }
  if (crossing.kind === 'resource') {
    return { ...s, food: s.food + first, energy: s.energy + second }
  }
  if (crossing.kind === 'people') {
    const moved = crossing.direction === 'out' ? -first : first
    return { ...s, population: Math.max(0, s.population + moved) }
  }
  return s
}

// FIX: só é salto de era o presente que sozinho vence TODAS as condições ainda não cumpridas do
// evento daquela era; vencer uma delas enquanto outra segue séculos longe não adianta a história
function eraLeap(crossing: Crossing, s: WorldState, world: WorldConfig): boolean {
  if (crossing.kind === 'doctrine') return false
  let before: Metrics | null = null
  let after: Metrics | null = null
  for (const def of EVENTS) {
    const era = def.era
    if (era === undefined || hasEra(s, era)) continue
    before ??= worldMetrics(s, world)
    if (holds(def.trigger, before)) continue
    after ??= worldMetrics(landed(s, crossing), world)
    if (holds(def.trigger, after)) return true
  }
  return false
}

export function leapParadox(crossing: Crossing, s: WorldState, world: WorldConfig): boolean {
  return magnitudeLeap(crossing, s, world) || eraLeap(crossing, s, world)
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
