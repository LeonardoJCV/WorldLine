import { VARIABLES, type Allocation, type Decision, type Variable } from '../engine/state.ts'
import { Worldline } from '../engine/worldline.ts'
import {
  toSnapshot,
  type EventUpdate,
  type FromWorker,
  type Speed,
  type ToWorker,
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

export class SimulationHost {
  readonly #send: Send
  readonly #clock: Clock
  #worldline: Worldline | null = null
  #speed: Speed = 1
  #playing = false
  #timer: number | null = null
  #last = 0
  #carry = 0
  #reported = 0
  #open: number[] = []
  #endReported = false

  constructor(send: Send, clock: Clock) {
    this.#send = send
    this.#clock = clock
  }

  handle(message: ToWorker): void {
    try {
      switch (message.type) {
        case 'create':
          this.#create(message.seed, message.decisions)
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
          this.#decide(message.allocation)
          break
        case 'range':
          this.#range(message.requestId, message.from, message.to, message.buckets)
          break
        case 'inspect':
          this.#inspect(message.requestId, message.tick)
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

  #require(): Worldline {
    if (!this.#worldline) throw new Error('no worldline created')
    return this.#worldline
  }

  #create(seed: number, decisions: readonly Decision[]): void {
    this.#stop()
    this.#worldline = new Worldline(seed, decisions)
    this.#reported = 0
    this.#open = []
    this.#endReported = false
    this.#report()
  }

  #play(speed: Speed): void {
    const worldline = this.#require()
    this.#speed = speed
    if (!worldline.ended && !this.#playing) {
      this.#playing = true
      this.#last = this.#clock.now()
      this.#carry = 0
      this.#schedule()
    }
    this.#report()
  }

  #pause(): void {
    this.#stop()
    if (this.#worldline) this.#report()
  }

  #step(years: number): void {
    const worldline = this.#require()
    this.#stop()
    worldline.advance(years)
    this.#report()
  }

  #decide(allocation: Allocation): void {
    const worldline = this.#require()
    worldline.decide(allocation)
    if (!worldline.ended) worldline.advance(1)
    this.#report()
  }

  #range(requestId: number, from: number, to: number, buckets: number): void {
    const worldline = this.#require()
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

  #inspect(requestId: number, tick: number): void {
    const worldline = this.#require()
    const clamped = Math.max(0, Math.min(Math.round(tick), worldline.present.tick))
    this.#send({ type: 'inspect', requestId, snapshot: toSnapshot(worldline.stateAt(clamped)) })
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
    const worldline = this.#worldline
    if (!worldline || !this.#playing) return
    const now = this.#clock.now()
    if (this.#speed === 'max') {
      let advanced = 0
      while (!worldline.ended && advanced < MAX_SLICE_YEARS && this.#clock.now() - now < SLICE_MS) {
        advanced += worldline.advance(SLICE_STEP)
      }
    } else {
      this.#carry += ((now - this.#last) / 1000) * this.#speed
      const years = Math.floor(this.#carry)
      this.#carry -= years
      worldline.advance(years)
    }
    this.#last = now
    if (worldline.ended) this.#playing = false
    this.#report()
    if (this.#playing) this.#schedule()
  }

  #report(): void {
    const worldline = this.#worldline
    if (!worldline) return
    const events: EventUpdate[] = []
    const open: number[] = []
    for (const index of this.#open) {
      const record = worldline.records[index]
      if (!record) continue
      if (record.end === null) open.push(index)
      else events.push({ index, record: { ...record } })
    }
    for (let index = this.#reported; index < worldline.records.length; index++) {
      const record = worldline.records[index]
      if (!record) continue
      events.push({ index, record: { ...record } })
      if (record.end === null) open.push(index)
    }
    this.#reported = worldline.records.length
    this.#open = open
    this.#send({
      type: 'progress',
      present: toSnapshot(worldline.present),
      playing: this.#playing,
      events,
    })
    if (worldline.ended && !this.#endReported) {
      this.#endReported = true
      this.#send({
        type: 'ended',
        reason: worldline.present.status === 'extinct' ? 'extinction' : 'horizon',
      })
    }
  }
}
