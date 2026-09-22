import { causalDistance } from '../../engine/distance.ts'
import {
  crossingAmounts,
  crossingCost,
  DOSES,
  type CrossingKind,
  type Dose,
} from '../../engine/crossing.ts'
import { MAX_WORLDLINES, type Snapshot } from '../../worker/protocol.ts'
import type { MessageKey } from '../i18n/en.ts'
import type { Params } from '../i18n/index.ts'

// FEAT: doutrina só tem sentido em dose 1, o efeito não escala com a dose
export function DOSES_FOR(kind: CrossingKind): readonly Dose[] {
  return kind === 'doctrine' ? [1] : DOSES
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
  readonly worlds: number
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
  const { kind, dose, cursor, credit, worlds, origin, destination, originEnded, destinationEnded } =
    input
  if (worlds < 2) return { key: 'cross.needsWorlds', params: {} }
  if (origin === null) return { key: 'cross.pickOrigin', params: {} }
  if (originEnded) return { key: 'cross.originExtinct', params: {} }
  if (destinationEnded) return { key: 'cross.destinationEnded', params: {} }
  const isPast = cursor !== null
  if (isPast && kind === 'people') return { key: 'cross.peopleOnlyNow', params: {} }
  if (isPast && worlds >= MAX_WORLDLINES) return { key: 'cross.limit', params: {} }
  const distance = destination ? causalDistance(origin.values, destination.values) : 0
  const cost = crossingCost(kind, dose, distance)
  if (cost > credit) return { key: 'cross.credit', params: { cost, missing: cost - credit } }
  return null
}
