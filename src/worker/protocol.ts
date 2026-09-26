import type { Colony } from '../engine/colony.ts'
import type { Crossing, CrossingKind, Dose } from '../engine/crossing.ts'
import type { Debt, Paradox } from '../engine/debt.ts'
import { EVENTS, type EventId, type EventRecord } from '../engine/events.ts'
import type { Merge } from '../engine/merge.ts'
import {
  VARIABLES,
  type Allocation,
  type Decision,
  type Status,
  type Variable,
  type WorldState,
} from '../engine/state.ts'

export const SPEEDS = [1, 4, 16, 64, 256] as const
export type Speed = (typeof SPEEDS)[number] | 'max'

export const WORLDLINE_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export type WorldlineId = (typeof WORLDLINE_IDS)[number]
export const MAX_WORLDLINES = WORLDLINE_IDS.length

export interface Snapshot {
  readonly tick: number
  readonly values: Readonly<Record<Variable, number>>
  readonly previous: Readonly<Record<Variable, number>> | null
  readonly eras: number
  readonly active: readonly EventId[]
  readonly allocation: Allocation
  readonly status: Status
  // FEAT: o corpo onde a história mora hoje; null enquanto ela nunca saiu do planeta natal
  readonly home: number | null
  // FEAT: o livro-razão do estado que este snapshot descreve
  readonly debts: readonly Debt[]
}

// FEAT: a comida por pessoa que o motor lê nos dois estados, porque o estoque somar não é a colheita
// crescer: a tela compara os dois números e não deriva nenhum
export interface SeamFood {
  readonly now: number
  readonly next: number
}

// FEAT: tudo o que o hospedeiro rende de uma costura especulativa — o estado previsto e os números
// que só o motor sabe calcular, para nenhuma regra da costura viver na tela
export interface SeamPreview {
  readonly seamed: Snapshot
  readonly shock: number
  readonly food: SeamFood
  readonly debtIn: number
  readonly debtSettled: number
}

export interface EventUpdate {
  readonly index: number
  readonly record: EventRecord
}

// FEAT: a costura no link é ano e nomes; o estado da outra história se recalcula no replay dela
export interface MergeSpec {
  readonly tick: number
  readonly self: string
  readonly other: string
  readonly direction: 'in' | 'out'
}

export interface BranchSpec {
  readonly parent: number
  readonly fork: number
  readonly decisions: readonly Decision[]
  readonly crossings?: readonly Crossing[]
  readonly merges?: readonly MergeSpec[]
}

export interface WorldlineInfo {
  readonly id: WorldlineId
  readonly parent: WorldlineId | null
  readonly fork: number
  readonly generation: number
}

export interface WorldProgress {
  readonly info: WorldlineInfo
  readonly present: Snapshot
  readonly events: readonly EventUpdate[]
  readonly decisions: readonly Decision[]
  readonly crossings: readonly Crossing[]
  readonly merges: readonly Merge[]
  readonly debts: readonly Debt[]
  readonly paradox: Paradox | null
  readonly colonies: readonly Colony[]
}

export type Series = Readonly<Record<Variable, Float32Array>>

// FEAT: um mundo colapsado terminou, mas não do mesmo jeito que um extinto — o motivo é distinto
export type EndReason = 'horizon' | 'extinction' | 'collapse' | 'merge'

export type ToWorker =
  | {
      readonly type: 'open'
      readonly seed: number
      readonly tick: number
      readonly root: readonly Decision[]
      readonly branches: readonly BranchSpec[]
      readonly crossings?: readonly Crossing[]
      // FEAT: as costuras da raiz, no mesmo formato que cada galho carrega as suas
      readonly merges?: readonly MergeSpec[]
    }
  | { readonly type: 'play'; readonly speed: Speed }
  | { readonly type: 'pause' }
  | { readonly type: 'step'; readonly years: number }
  | { readonly type: 'decide'; readonly world: WorldlineId; readonly allocation: Allocation }
  | {
      readonly type: 'branch'
      readonly requestId: number
      readonly parent: WorldlineId
      readonly tick: number
      readonly allocation: Allocation
    }
  | {
      readonly type: 'cross'
      readonly requestId: number
      readonly origin: WorldlineId
      readonly destination: WorldlineId
      readonly kind: CrossingKind
      readonly dose: Dose
    }
  | {
      readonly type: 'crossBranch'
      readonly requestId: number
      readonly parent: WorldlineId
      readonly tick: number
      readonly origin: WorldlineId
      readonly kind: CrossingKind
      readonly dose: Dose
    }
  | {
      readonly type: 'merge'
      readonly requestId: number
      readonly survivor: WorldlineId
      readonly other: WorldlineId
    }
  | {
      readonly type: 'mergePreview'
      readonly requestId: number
      readonly survivor: WorldlineId
      readonly other: WorldlineId
    }
  | { readonly type: 'remove'; readonly world: WorldlineId }
  | {
      readonly type: 'range'
      readonly requestId: number
      readonly world: WorldlineId
      readonly from: number
      readonly to: number
      readonly buckets: number
    }
  | {
      readonly type: 'inspect'
      readonly requestId: number
      readonly world: WorldlineId
      readonly tick: number
    }
  | {
      readonly type: 'distance'
      readonly requestId: number
      readonly world: WorldlineId
      readonly reference: WorldlineId
      readonly from: number
      readonly to: number
      readonly buckets: number
    }

export type FromWorker =
  | {
      readonly type: 'progress'
      readonly now: number
      readonly credit: number
      readonly playing: boolean
      readonly ended: EndReason | null
      readonly worlds: readonly WorldProgress[]
    }
  | {
      readonly type: 'range'
      readonly requestId: number
      readonly from: number
      readonly to: number
      readonly series: Series
    }
  | { readonly type: 'inspect'; readonly requestId: number; readonly snapshot: Snapshot }
  | { readonly type: 'branched'; readonly requestId: number; readonly world: WorldlineId }
  | { readonly type: 'merged'; readonly requestId: number; readonly world: WorldlineId }
  // FEAT: abalo, comida e dívida são regra do motor; a tela nunca as conhece, então chegam prontas
  | ({ readonly type: 'mergePreview'; readonly requestId: number } & SeamPreview)
  | {
      readonly type: 'crossed'
      readonly requestId: number
      readonly world: WorldlineId
      readonly crossing: Crossing
    }
  | {
      readonly type: 'distance'
      readonly requestId: number
      readonly from: number
      readonly to: number
      readonly values: Float32Array
    }
  | { readonly type: 'error'; readonly message: string; readonly requestId?: number }

export function toSnapshot(
  state: WorldState,
  previous: Readonly<Record<Variable, number>> | null = null,
): Snapshot {
  const values = {} as Record<Variable, number>
  for (const variable of VARIABLES) values[variable] = state[variable]
  return {
    tick: state.tick,
    values,
    previous,
    eras: state.eras,
    active: state.active.flatMap((entry) => {
      const def = EVENTS[entry.def]
      return def ? [def.id] : []
    }),
    allocation: state.allocation,
    status: state.status,
    home: state.home,
    debts: state.debts,
  }
}
