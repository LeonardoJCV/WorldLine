import { causalDistance } from '../../engine/distance.ts'
import {
  crossingAmounts,
  crossingCost,
  DOSES,
  type Crossing,
  type CrossingKind,
  type Dose,
} from '../../engine/crossing.ts'
import type { EventRecord } from '../../engine/events.ts'
import { HORIZON } from '../../engine/params.ts'
import type { Decision } from '../../engine/state.ts'
import { MAX_WORLDLINES, type Snapshot, type WorldlineId } from '../../worker/protocol.ts'
import type { MessageKey } from '../i18n/en.ts'
import type { Params } from '../i18n/index.ts'
import type { Mode } from '../sim/store.ts'

// FEAT: doutrina só tem sentido em dose 1, o efeito não escala com a dose
export function DOSES_FOR(kind: CrossingKind): readonly Dose[] {
  return kind === 'doctrine' ? [1] : DOSES
}

// FEAT: uma realidade acabou quando se extinguiu, colapsou ou chegou ao horizonte
export function worldEnded(present: Snapshot): boolean {
  return present.status !== 'running' || present.tick >= HORIZON
}

export interface OriginCandidate {
  readonly info: { readonly id: WorldlineId }
  readonly present: Snapshot
}

// FIX: só realidade viva que não é o destino pode ser origem, e é essa conta que diz se há travessia possível
export function crossOrigins<T extends OriginCandidate>(
  worlds: readonly T[],
  focus: WorldlineId,
): readonly T[] {
  return worlds.filter((world) => world.info.id !== focus && !worldEnded(world.present))
}

// FEAT: a cena decide igual à tira e ao painel; clicar uma corrente inutilizável só troca o foco
export function streamClick<T extends OriginCandidate>(
  mode: Mode,
  id: WorldlineId,
  focus: WorldlineId,
  worlds: readonly T[],
): 'origin' | 'focus' {
  if (mode !== 'cross') return 'focus'
  return crossOrigins(worlds, focus).some((world) => world.info.id === id) ? 'origin' : 'focus'
}

export type HistoryRow =
  | {
      readonly kind: 'event'
      readonly year: number
      readonly index: number
      readonly record: EventRecord
    }
  | { readonly kind: 'crossing'; readonly year: number; readonly crossing: Crossing }

// FEAT: a travessia entra na mesma lista dos eventos, sem mexer no índice que o painel causal usa
export function historyRows(
  events: readonly EventRecord[],
  crossings: readonly Crossing[],
  limit: number,
): readonly HistoryRow[] {
  const rows: HistoryRow[] = []
  // FIX: eventos já vêm em ordem crescente; só os últimos `limit` podem estar entre os mais recentes
  const start = Math.max(0, events.length - limit)
  for (let i = events.length - 1; i >= start; i--) {
    const record = events[i]
    if (record) rows.push({ kind: 'event', year: record.start, index: i, record })
  }
  for (const crossing of crossings) {
    rows.push({ kind: 'crossing', year: crossing.tick, crossing })
  }
  return rows.sort((a, b) => b.year - a.year).slice(0, limit)
}

export interface CrossQuoteInput {
  readonly kind: CrossingKind
  readonly dose: Dose
  readonly origin: Snapshot
  readonly destination: Snapshot
}

export interface CrossQuote {
  readonly cost: number
  readonly amounts: readonly number[]
}

export function crossQuote({ kind, dose, origin, destination }: CrossQuoteInput): CrossQuote {
  const distance = causalDistance(origin.values, destination.values)
  return {
    cost: crossingCost(kind, dose, distance),
    amounts: crossingAmounts(kind, dose, origin.values),
  }
}

export interface CrossBlockInput {
  readonly kind: CrossingKind
  readonly dose: Dose
  readonly cursor: number | null
  readonly credit: number
  // FIX: a origem só olha para quem está vivo; o teto de seis conta toda worldline, viva ou não
  readonly usableOrigins: number
  readonly totalWorlds: number
  readonly origin: Snapshot | null
  readonly destination: Snapshot | null
  readonly originEnded: boolean
  readonly destinationEnded: boolean
}

export interface CrossBlock {
  readonly key: MessageKey
  readonly params: Params
}

// FEAT: a ordem das recusas é o contrato do painel, cada uma pega a mais grave primeiro
export function crossBlock(input: CrossBlockInput): CrossBlock | null {
  const {
    kind,
    dose,
    cursor,
    credit,
    usableOrigins,
    totalWorlds,
    origin,
    destination,
    originEnded,
    destinationEnded,
  } = input
  if (usableOrigins < 1) return { key: 'cross.needsWorlds', params: {} }
  if (origin === null) return { key: 'cross.pickOrigin', params: {} }
  if (originEnded) return { key: 'cross.originExtinct', params: {} }
  if (destinationEnded) return { key: 'cross.destinationEnded', params: {} }
  const isPast = cursor !== null
  if (isPast && kind === 'people') return { key: 'cross.peopleOnlyNow', params: {} }
  if (isPast && totalWorlds >= MAX_WORLDLINES) return { key: 'cross.limit', params: {} }
  const distance = destination ? causalDistance(origin.values, destination.values) : 0
  const cost = crossingCost(kind, dose, distance)
  if (cost > credit) return { key: 'cross.credit', params: { cost, missing: cost - credit } }
  return null
}

// FEAT: decisão do mesmo ano ainda não vale; a travessia de doutrina leva a alocação anterior
export function crossCarriesPreviousAllocation(
  kind: CrossingKind,
  year: number | null,
  decisions: readonly Decision[],
): boolean {
  return (
    kind === 'doctrine' && year !== null && decisions.some((decision) => decision.tick === year)
  )
}
