import { EVENTS, type EventId, type EventRecord } from '../engine/events.ts'
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

export interface Snapshot {
  readonly tick: number
  readonly values: Readonly<Record<Variable, number>>
  readonly previous: Readonly<Record<Variable, number>> | null
  readonly eras: number
  readonly active: readonly EventId[]
  readonly allocation: Allocation
  readonly status: Status
}

export interface EventUpdate {
  readonly index: number
  readonly record: EventRecord
}

export type Series = Readonly<Record<Variable, Float32Array>>

export type EndReason = 'horizon' | 'extinction'

export type ToWorker =
  | { readonly type: 'create'; readonly seed: number; readonly decisions: readonly Decision[] }
  | { readonly type: 'play'; readonly speed: Speed }
  | { readonly type: 'pause' }
  | { readonly type: 'step'; readonly years: number }
  | { readonly type: 'decide'; readonly allocation: Allocation }
  | {
      readonly type: 'range'
      readonly requestId: number
      readonly from: number
      readonly to: number
      readonly buckets: number
    }
  | { readonly type: 'inspect'; readonly requestId: number; readonly tick: number }

export type FromWorker =
  | {
      readonly type: 'progress'
      readonly present: Snapshot
      readonly playing: boolean
      readonly events: readonly EventUpdate[]
      readonly decisions: readonly Decision[]
    }
  | {
      readonly type: 'range'
      readonly requestId: number
      readonly from: number
      readonly to: number
      readonly series: Series
    }
  | { readonly type: 'inspect'; readonly requestId: number; readonly snapshot: Snapshot }
  | { readonly type: 'ended'; readonly reason: EndReason }
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
  }
}
