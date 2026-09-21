import { createStore, type StoreApi } from 'zustand/vanilla'
import { MODEL_VERSION } from '../../engine/params.ts'
import type { EventRecord } from '../../engine/events.ts'
import type { Allocation, Decision } from '../../engine/state.ts'
import type { EndReason, EventUpdate, Snapshot, Speed } from '../../worker/protocol.ts'
import type { WorldLink } from '../world/link.ts'
import type { SimulationClient } from './client.ts'

export type Mode = 'observe' | 'intervene'

export interface View {
  readonly span: number
  readonly end: number | null
}

export interface SimulationState {
  readonly seed: number | null
  readonly present: Snapshot | null
  readonly playing: boolean
  readonly speed: Speed
  readonly ended: EndReason | null
  readonly events: readonly EventRecord[]
  readonly error: string | null
  readonly cursor: number | null
  readonly inspected: Snapshot | null
  readonly mode: Mode
  readonly selected: number | null
  readonly decisions: readonly Decision[]
  readonly view: View | null
  readonly linkVersion: number | null
  create(seed: number): void
  open(link: WorldLink): void
  togglePlay(): void
  pause(): void
  setSpeed(speed: Speed): void
  step(years: number): void
  setCursor(tick: number | null): void
  setMode(mode: Mode): void
  select(index: number | null): void
  decide(allocation: Allocation): void
  setView(view: View | null): void
}

export type SimulationStore = StoreApi<SimulationState>

function upsert(
  current: readonly EventRecord[],
  updates: readonly EventUpdate[],
): readonly EventRecord[] {
  if (updates.length === 0) return current
  const next = current.slice()
  for (const { index, record } of updates) next[index] = record
  return next
}

export function createSimulationStore(client: SimulationClient): SimulationStore {
  const store = createStore<SimulationState>()((set, get) => ({
    seed: null,
    present: null,
    playing: false,
    speed: 16,
    ended: null,
    events: [],
    error: null,
    cursor: null,
    inspected: null,
    mode: 'observe',
    selected: null,
    decisions: [],
    view: null,
    linkVersion: null,
    create(seed) {
      get().open({ version: MODEL_VERSION, seed, tick: 0, decisions: [] })
    },
    open(link) {
      set({
        seed: link.seed,
        present: null,
        playing: false,
        ended: null,
        events: [],
        error: null,
        cursor: null,
        inspected: null,
        mode: 'observe',
        selected: null,
        decisions: [],
        view: null,
        linkVersion: link.version,
      })
      client.create(link.seed, link.decisions)
      if (link.tick > 0) client.step(link.tick)
    },
    togglePlay() {
      const { playing, speed, ended } = get()
      if (playing) client.pause()
      else if (ended === null) client.play(speed)
    },
    pause() {
      client.pause()
    },
    setSpeed(speed) {
      set({ speed })
      if (get().playing) client.play(speed)
    },
    step(years) {
      client.step(years)
    },
    setCursor(tick) {
      const present = get().present
      const cursor =
        tick === null || present === null || tick >= present.tick
          ? null
          : Math.max(0, Math.round(tick))
      set({ cursor })
      if (cursor === null) {
        set({ inspected: null })
        return
      }
      client.inspect(cursor).then(
        (snapshot) => {
          if (get().cursor === snapshot.tick) set({ inspected: snapshot })
        },
        (error: unknown) => set({ error: error instanceof Error ? error.message : String(error) }),
      )
    },
    setMode(mode) {
      set({ mode })
      if (mode === 'intervene') get().setCursor(null)
    },
    select(index) {
      set({ selected: index })
      const record = index === null ? undefined : get().events[index]
      if (record) get().setCursor(record.start)
    },
    decide(allocation) {
      client.decide(allocation)
    },
    setView(view) {
      set({ view })
    },
  }))

  client.subscribe((message) => {
    switch (message.type) {
      case 'progress':
        store.setState({
          present: message.present,
          playing: message.playing,
          events: upsert(store.getState().events, message.events),
          decisions: message.decisions,
        })
        break
      case 'ended':
        store.setState({ ended: message.reason, playing: false })
        break
      case 'error':
        store.setState({ error: message.message })
        break
    }
  })

  return store
}
