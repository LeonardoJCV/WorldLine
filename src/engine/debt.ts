import type { Crossing } from './crossing.ts'
import { EVENTS } from './events.ts'
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
import { Era, changedSectors, hasEra, type Allocation, type WorldState } from './state.ts'

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

// FIX: os limiares de era vêm do gatilho real do evento em events.ts, não de um palpite novo;
// se o evento não existir ou não tiver a condição, o limiar vira infinito e nunca dispara por era
function eraGate(
  id: 'agricultural_revolution' | 'industrial_revolution',
  metric: 'technology' | 'energy',
): number {
  const def = EVENTS.find((event) => event.id === id)
  const condition = def?.trigger.find((c) => c.metric === metric)
  return condition?.value ?? Number.POSITIVE_INFINITY
}

// FIX: adiado para a primeira chamada, não para a carga do módulo — rules.ts passou a importar
// debt.ts (Tarefa 3), fechando um ciclo com events.ts que deixaria EVENTS indefinido nesse ponto
let eraGates: { agricultural: number; industrialTech: number; industrialEnergy: number } | null =
  null
function getEraGates() {
  if (!eraGates) {
    eraGates = {
      agricultural: eraGate('agricultural_revolution', 'technology'),
      industrialTech: eraGate('industrial_revolution', 'technology'),
      industrialEnergy: eraGate('industrial_revolution', 'energy'),
    }
  }
  return eraGates
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

function magnitudeLeap(crossing: Crossing, s: WorldState): boolean {
  const amounts = crossing.amounts
  if (crossing.kind === 'knowledge') return overshoot(amounts[0] ?? 0, s.technology)
  if (crossing.kind === 'people') return overshoot(amounts[0] ?? 0, s.population)
  if (crossing.kind === 'resource') {
    return overshoot(amounts[0] ?? 0, s.food) || overshoot(amounts[1] ?? 0, s.energy)
  }
  return false
}

// FIX: só é salto quem atravessa o limiar; um mundo que já passou daquela grandeza e não alcançou
// a era está preso por outra condição, e receber mais da mesma grandeza não adianta a história
function crossesGate(have: number, arriving: number, gate: number): boolean {
  return have <= gate && have + arriving > gate
}

function eraLeap(crossing: Crossing, s: WorldState): boolean {
  const gates = getEraGates()
  if (crossing.kind === 'knowledge') {
    const arriving = crossing.amounts[0] ?? 0
    return (
      (!hasEra(s, Era.agricultural) && crossesGate(s.technology, arriving, gates.agricultural)) ||
      (!hasEra(s, Era.industrial) && crossesGate(s.technology, arriving, gates.industrialTech))
    )
  }
  if (crossing.kind === 'resource') {
    return (
      !hasEra(s, Era.industrial) &&
      crossesGate(s.energy, crossing.amounts[1] ?? 0, gates.industrialEnergy)
    )
  }
  // FEAT: doutrina e pessoas não têm uma grandeza ligada a um gatilho de era em events.ts
  return false
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
