import { causalDistance } from '../engine/distance.ts'
import { HORIZON } from '../engine/params.ts'
import {
  VARIABLES,
  isValidAllocation,
  type Allocation,
  type Decision,
  type Variable,
  type WorldState,
} from '../engine/state.ts'
import { Worldline } from '../engine/worldline.ts'
import {
  MAX_WORLDLINES,
  WORLDLINE_IDS,
  toSnapshot,
  type BranchSpec,
  type EndReason,
  type EventUpdate,
  type FromWorker,
  type Snapshot,
  type Speed,
  type ToWorker,
  type WorldProgress,
  type WorldlineId,
  type WorldlineInfo,
} from './protocol.ts'

export interface Clock {
  now(): number
  setTimeout(callback: () => void, ms: number): number
  clearTimeout(handle: number): void
}

export type Send = (message: FromWorker, transfer?: Transferable[]) => void

export const FRAME_MS = 16
export const SLICE_MS = 8
export const MAX_SLICE_YEARS = 2000
const SLICE_STEP = 64

interface Entry {
  readonly info: WorldlineInfo
  readonly worldline: Worldline
  reported: number
  open: number[]
}

export class SimulationHost {
  readonly #send: Send
  readonly #clock: Clock
  #seed = 0
  #entries: Entry[] = []
  #generation = 0
  #now = 0
  #speed: Speed = 1
  #playing = false
  #timer: number | null = null
  #last = 0
  #carry = 0

  constructor(send: Send, clock: Clock) {
    this.#send = send
    this.#clock = clock
  }

  handle(message: ToWorker): void {
    try {
      switch (message.type) {
        case 'open':
          this.#open(message.seed, message.tick, message.root, message.branches)
          break
        case 'play':
          this.#play(message.speed)
          break
        case 'pause':
          this.#pause()
          break
        case 'step':
          this.#step(message.years)
          break
        case 'decide':
          this.#decide(message.world, message.allocation)
          break
        case 'branch':
          this.#branch(message.requestId, message.parent, message.tick, message.allocation)
          break
        case 'remove':
          this.#remove(message.world)
          break
        case 'range':
          this.#range(message.requestId, message.world, message.from, message.to, message.buckets)
          break
        case 'inspect':
          this.#inspect(message.requestId, message.world, message.tick)
          break
        case 'distance':
          this.#distance(
            message.requestId,
            message.world,
            message.reference,
            message.from,
            message.to,
            message.buckets,
          )
          break
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      this.#send(
        'requestId' in message
          ? { type: 'error', message: text, requestId: message.requestId }
          : { type: 'error', message: text },
      )
    }
  }

  #entry(id: WorldlineId): Entry {
    if (this.#entries.length === 0) throw new Error('no worldline created')
    const entry = this.#entries.find((candidate) => candidate.info.id === id)
    if (!entry) throw new Error(`unknown worldline ${id}`)
    return entry
  }

  #add(id: WorldlineId, parent: WorldlineId | null, fork: number, worldline: Worldline): void {
    this.#generation += 1
    this.#entries.push({
      info: { id, parent, fork, generation: this.#generation },
      worldline,
      reported: 0,
      open: [],
    })
  }

  #freeId(): WorldlineId {
    const id = WORLDLINE_IDS.find(
      (candidate) => !this.#entries.some((e) => e.info.id === candidate),
    )
    if (!id) throw new RangeError('worldline limit reached')
    return id
  }

  #grow(parent: Entry, fork: number, own: readonly Decision[], target: number): Worldline {
    if (!Number.isInteger(fork) || fork < 0 || fork > parent.worldline.present.tick) {
      throw new RangeError('fork outside the parent history')
    }
    const inherited = parent.worldline.decisions.filter((decision) => decision.tick < fork)
    const line = new Worldline(this.#seed, [...inherited, ...own], {
      parent: parent.worldline,
      tick: fork,
    })
    line.advance(target)
    return line
  }

  #latest(): number {
    return Math.max(0, ...this.#entries.map((entry) => entry.worldline.present.tick))
  }

  #allEnded(): boolean {
    return this.#entries.length > 0 && this.#entries.every((entry) => entry.worldline.ended)
  }

  #advanceAll(years: number): number {
    const before = this.#now
    const target = Math.min(HORIZON, this.#now + years)
    for (const entry of this.#entries) {
      const line = entry.worldline
      if (!line.ended && line.present.tick < target) line.advance(target - line.present.tick)
    }
    this.#now = this.#latest()
    return this.#now - before
  }

  #open(
    seed: number,
    tick: number,
    root: readonly Decision[],
    branches: readonly BranchSpec[],
  ): void {
    this.#stop()
    if (branches.length >= MAX_WORLDLINES) throw new RangeError('worldline limit reached')
    this.#seed = seed
    this.#entries = []
    const origin = new Worldline(seed, root)
    origin.advance(tick)
    this.#add('A', null, 0, origin)
    for (const spec of branches) {
      const parent = this.#entries[spec.parent]
      if (!parent) throw new RangeError('unknown parent worldline')
      const line = this.#grow(parent, spec.fork, spec.decisions, tick)
      this.#add(this.#freeId(), parent.info.id, spec.fork, line)
    }
    this.#now = this.#latest()
    this.#report()
  }

  #play(speed: Speed): void {
    this.#entry('A')
    this.#speed = speed
    if (!this.#allEnded() && !this.#playing) {
      this.#playing = true
      this.#last = this.#clock.now()
      this.#carry = 0
      this.#schedule()
    }
    this.#report()
  }

  #pause(): void {
    this.#stop()
    if (this.#entries.length > 0) this.#report()
  }

  #step(years: number): void {
    this.#entry('A')
    this.#stop()
    this.#advanceAll(years)
    this.#report()
  }

  #decide(world: WorldlineId, allocation: Allocation): void {
    this.#entry(world).worldline.decide(allocation)
    this.#report()
  }

  #branch(requestId: number, parentId: WorldlineId, tick: number, allocation: Allocation): void {
    const parent = this.#entry(parentId)
    if (this.#entries.length >= MAX_WORLDLINES) throw new RangeError('worldline limit reached')
    if (!isValidAllocation(allocation)) {
      throw new RangeError('allocation must be whole percentages summing to 100')
    }
    const id = this.#freeId()
    this.#add(id, parentId, tick, this.#grow(parent, tick, [{ tick, allocation }], this.#now))
    this.#report()
    this.#send({ type: 'branched', requestId, world: id })
  }

  #remove(id: WorldlineId): void {
    this.#entry(id)
    if (id === 'A') throw new RangeError('the original worldline cannot be removed')
    const doomed = new Set<WorldlineId>([id])
    for (const entry of this.#entries) {
      if (entry.info.parent !== null && doomed.has(entry.info.parent)) doomed.add(entry.info.id)
    }
    this.#entries = this.#entries.filter((entry) => !doomed.has(entry.info.id))
    this.#now = this.#latest()
    this.#report()
  }

  #range(requestId: number, world: WorldlineId, from: number, to: number, buckets: number): void {
    const worldline = this.#entry(world).worldline
    const last = worldline.present.tick
    const start = Math.max(0, Math.min(from, last))
    const end = Math.max(start, Math.min(to, last))
    const series = {} as Record<Variable, Float32Array>
    const transfer: Transferable[] = []
    for (const variable of VARIABLES) {
      const { mean } = worldline.range(variable, start, end, buckets)
      series[variable] = mean
      transfer.push(mean.buffer as ArrayBuffer)
    }
    this.#send({ type: 'range', requestId, from: start, to: end, series }, transfer)
  }

  #inspect(requestId: number, world: WorldlineId, tick: number): void {
    const entry = this.#entry(world)
    const clamped = Math.max(0, Math.min(Math.round(tick), entry.worldline.present.tick))
    this.#send({
      type: 'inspect',
      requestId,
      snapshot: this.#snapshot(entry, entry.worldline.stateAt(clamped)),
    })
  }

  #row(worldline: Worldline, tick: number): Record<Variable, number> {
    const row = {} as Record<Variable, number>
    for (const variable of VARIABLES) row[variable] = worldline.valueAt(variable, tick)
    return row
  }

  #distance(
    requestId: number,
    world: WorldlineId,
    reference: WorldlineId,
    from: number,
    to: number,
    buckets: number,
  ): void {
    if (!Number.isInteger(buckets) || buckets < 1) throw new RangeError('invalid range request')
    const a = this.#entry(world).worldline
    const b = this.#entry(reference).worldline
    const last = Math.min(a.present.tick, b.present.tick)
    const start = Math.max(0, Math.min(from, last))
    const end = Math.max(start, Math.min(to, last))
    const span = end - start + 1
    const count = Math.min(buckets, span)
    const values = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const tick = Math.min(end, start + Math.floor(((i + 0.5) * span) / count))
      values[i] = causalDistance(this.#row(a, tick), this.#row(b, tick))
    }
    this.#send({ type: 'distance', requestId, from: start, to: end, values }, [
      values.buffer as ArrayBuffer,
    ])
  }

  #snapshot(entry: Entry, state: WorldState): Snapshot {
    if (state.tick === 0) return toSnapshot(state, null)
    return toSnapshot(state, this.#row(entry.worldline, state.tick - 1))
  }

  #schedule(): void {
    this.#timer = this.#clock.setTimeout(() => this.#frame(), this.#speed === 'max' ? 0 : FRAME_MS)
  }

  #stop(): void {
    this.#playing = false
    if (this.#timer !== null) {
      this.#clock.clearTimeout(this.#timer)
      this.#timer = null
    }
  }

  #frame(): void {
    this.#timer = null
    if (this.#entries.length === 0 || !this.#playing) return
    try {
      const now = this.#clock.now()
      if (this.#speed === 'max') {
        let advanced = 0
        while (
          !this.#allEnded() &&
          advanced < MAX_SLICE_YEARS &&
          this.#clock.now() - now < SLICE_MS
        ) {
          const moved = this.#advanceAll(SLICE_STEP)
          if (moved === 0) break
          advanced += moved
        }
      } else {
        this.#carry += ((now - this.#last) / 1000) * this.#speed
        const years = Math.floor(this.#carry)
        this.#carry -= years
        this.#advanceAll(years)
      }
      this.#last = now
      if (this.#allEnded()) this.#playing = false
      this.#report()
      if (this.#playing) this.#schedule()
    } catch (error) {
      this.#stop()
      const message = error instanceof Error ? error.message : String(error)
      this.#send({ type: 'error', message })
    }
  }

  #progressOf(entry: Entry): WorldProgress {
    const { worldline } = entry
    const events: EventUpdate[] = []
    const open: number[] = []
    for (const index of entry.open) {
      const record = worldline.records[index]
      if (!record) continue
      if (record.end === null) open.push(index)
      else events.push({ index, record: { ...record } })
    }
    for (let index = entry.reported; index < worldline.records.length; index++) {
      const record = worldline.records[index]
      if (!record) continue
      events.push({ index, record: { ...record } })
      if (record.end === null) open.push(index)
    }
    entry.reported = worldline.records.length
    entry.open = open
    return {
      info: entry.info,
      present: this.#snapshot(entry, worldline.present),
      events,
      decisions: worldline.decisions.map((d) => ({
        tick: d.tick,
        allocation: { ...d.allocation },
      })),
    }
  }

  #report(): void {
    if (this.#entries.length === 0) return
    let ended: EndReason | null = null
    if (this.#allEnded()) {
      ended = this.#entries.some((entry) => entry.worldline.present.status === 'running')
        ? 'horizon'
        : 'extinction'
    }
    this.#send({
      type: 'progress',
      now: this.#now,
      playing: this.#playing,
      ended,
      worlds: this.#entries.map((entry) => this.#progressOf(entry)),
    })
  }
}
