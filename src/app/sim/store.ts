import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Crossing } from '../../engine/crossing.ts'
import type { EventRecord } from '../../engine/events.ts'
import { MODEL_VERSION } from '../../engine/params.ts'
import type { Allocation, Decision } from '../../engine/state.ts'
import type {
  EndReason,
  EventUpdate,
  Snapshot,
  Speed,
  WorldlineId,
  WorldlineInfo,
} from '../../worker/protocol.ts'
import type { MultiverseLink } from '../world/link.ts'
import type { SimulationClient } from './client.ts'

export type Mode = 'observe' | 'intervene'

export interface View {
  readonly span: number
  readonly end: number | null
}

export interface WorldView {
  readonly info: WorldlineInfo
  readonly present: Snapshot
  readonly events: readonly EventRecord[]
  readonly decisions: readonly Decision[]
  readonly crossings: readonly Crossing[]
}

export interface SimulationState {
  readonly seed: number | null
  readonly now: number
  readonly credit: number
  readonly worlds: readonly WorldView[]
  readonly focus: WorldlineId
  readonly present: Snapshot | null
  readonly playing: boolean
  readonly speed: Speed
  readonly ended: EndReason | null
  readonly events: readonly EventRecord[]
  readonly error: string | null
  readonly cursor: number | null
  readonly inspected: Snapshot | null
  readonly inspectedOrigin: Snapshot | null
  readonly mode: Mode
  readonly selected: number | null
  readonly decisions: readonly Decision[]
  readonly view: View | null
  readonly linkVersion: number | null
  readonly branching: boolean
  create(seed: number): void
  open(link: MultiverseLink): void
  togglePlay(): void
  pause(): void
  setSpeed(speed: Speed): void
  step(years: number): void
  setCursor(tick: number | null): void
  setMode(mode: Mode): void
  select(index: number | null): void
  decide(allocation: Allocation): void
  branch(allocation: Allocation): void
  remove(id: WorldlineId): void
  setFocus(id: WorldlineId): void
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

function focused(worlds: readonly WorldView[], focus: WorldlineId) {
  const world = worlds.find((candidate) => candidate.info.id === focus)
  return world
    ? { present: world.present, events: world.events, decisions: world.decisions }
    : { present: null, events: [], decisions: [] }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSimulationStore(client: SimulationClient): SimulationStore {
  const store = createStore<SimulationState>()((set, get) => ({
    seed: null,
    now: 0,
    credit: 0,
    worlds: [],
    focus: 'A',
    present: null,
    playing: false,
    speed: 16,
    ended: null,
    events: [],
    error: null,
    cursor: null,
    inspected: null,
    inspectedOrigin: null,
    mode: 'observe',
    selected: null,
    decisions: [],
    view: null,
    linkVersion: null,
    branching: false,
    create(seed) {
      get().open({ version: MODEL_VERSION, seed, tick: 0, decisions: [], branches: [] })
    },
    open(link) {
      set({
        seed: link.seed,
        now: 0,
        credit: 0,
        worlds: [],
        focus: 'A',
        present: null,
        playing: false,
        ended: null,
        events: [],
        error: null,
        cursor: null,
        inspected: null,
        inspectedOrigin: null,
        mode: 'observe',
        selected: null,
        decisions: [],
        view: null,
        linkVersion: link.version,
        branching: false,
      })
      client.open(link.seed, link.tick, link.decisions, link.branches)
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
      const { present, focus, worlds } = get()
      const cursor =
        tick === null || present === null || tick >= present.tick
          ? null
          : Math.max(0, Math.round(tick))
      set({ cursor })
      if (cursor === null) {
        set({ inspected: null, inspectedOrigin: null })
        return
      }
      client.inspect(focus, cursor).then(
        (snapshot) => {
          if (get().cursor === snapshot.tick && get().focus === focus) set({ inspected: snapshot })
        },
        (error: unknown) => set({ error: messageOf(error) }),
      )
      const parent = worlds.find((world) => world.info.id === focus)?.info.parent ?? null
      const origin = parent === null ? undefined : worlds.find((w) => w.info.id === parent)
      if (!origin || cursor > origin.present.tick) {
        set({ inspectedOrigin: null })
        return
      }
      client.inspect(origin.info.id, cursor).then(
        (snapshot) => {
          if (get().cursor === snapshot.tick && get().focus === focus) {
            set({ inspectedOrigin: snapshot })
          }
        },
        (error: unknown) => set({ error: messageOf(error) }),
      )
    },
    setMode(mode) {
      set({ mode })
    },
    select(index) {
      set({ selected: index })
      const record = index === null ? undefined : get().events[index]
      if (record) get().setCursor(record.start)
    },
    decide(allocation) {
      client.decide(get().focus, allocation)
    },
    branch(allocation) {
      const { focus, cursor, present } = get()
      const tick = cursor ?? present?.tick ?? 0
      set({ branching: true })
      client.branch(focus, tick, allocation).then(
        (id) => {
          set({ branching: false })
          get().setCursor(null)
          get().setFocus(id)
        },
        (error: unknown) => set({ branching: false, error: messageOf(error) }),
      )
    },
    remove(id) {
      client.remove(id)
    },
    setFocus(id) {
      const { worlds, cursor } = get()
      if (!worlds.some((world) => world.info.id === id)) return
      set({
        focus: id,
        selected: null,
        inspected: null,
        inspectedOrigin: null,
        ...focused(worlds, id),
      })
      if (cursor !== null) get().setCursor(cursor)
    },
    setView(view) {
      set({ view })
    },
  }))

  client.subscribe((message) => {
    switch (message.type) {
      case 'progress': {
        const previous = store.getState().worlds
        const worlds = message.worlds.map((update): WorldView => {
          const old = previous.find(
            (world) =>
              world.info.id === update.info.id && world.info.generation === update.info.generation,
          )
          return {
            info: update.info,
            present: update.present,
            events: upsert(old?.events ?? [], update.events),
            decisions: update.decisions,
            crossings: update.crossings,
          }
        })
        const current = store.getState().focus
        const focus = worlds.some((world) => world.info.id === current) ? current : 'A'
        store.setState({
          now: message.now,
          credit: message.credit,
          playing: message.playing,
          ended: message.ended,
          worlds,
          focus,
          ...focused(worlds, focus),
          ...(focus === current
            ? {}
            : { selected: null, cursor: null, inspected: null, inspectedOrigin: null }),
        })
        break
      }
      case 'error':
        store.setState({ error: message.message })
        break
    }
  })

  return store
}
