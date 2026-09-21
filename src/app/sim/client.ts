import type { Allocation, Decision } from '../../engine/state.ts'
import type { FromWorker, Series, Snapshot, Speed, ToWorker } from '../../worker/protocol.ts'

export interface Port {
  send(message: ToWorker): void
  listen(handler: (message: FromWorker) => void): void
}

export function workerPort(worker: Worker): Port {
  return {
    send: (message) => worker.postMessage(message),
    listen: (handler) => {
      worker.onmessage = (event: MessageEvent<FromWorker>) => handler(event.data)
    },
  }
}

export interface RangeResult {
  readonly from: number
  readonly to: number
  readonly series: Series
}

type Listener = (message: FromWorker) => void

interface Pending {
  readonly resolve: (message: FromWorker) => void
  readonly reject: (error: Error) => void
}

export class SimulationClient {
  readonly #port: Port
  readonly #listeners = new Set<Listener>()
  readonly #pending = new Map<number, Pending>()
  #nextId = 1

  constructor(port: Port) {
    this.#port = port
    port.listen((message) => this.#receive(message))
  }

  create(seed: number, decisions: readonly Decision[] = []): void {
    this.#port.send({ type: 'create', seed, decisions })
  }

  play(speed: Speed): void {
    this.#port.send({ type: 'play', speed })
  }

  pause(): void {
    this.#port.send({ type: 'pause' })
  }

  step(years: number): void {
    this.#port.send({ type: 'step', years })
  }

  decide(allocation: Allocation): void {
    this.#port.send({ type: 'decide', allocation })
  }

  async range(from: number, to: number, buckets: number): Promise<RangeResult> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, { type: 'range', requestId, from, to, buckets })
    if (reply.type !== 'range') throw new Error(`unexpected ${reply.type} reply`)
    return { from: reply.from, to: reply.to, series: reply.series }
  }

  async inspect(tick: number): Promise<Snapshot> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, { type: 'inspect', requestId, tick })
    if (reply.type !== 'inspect') throw new Error(`unexpected ${reply.type} reply`)
    return reply.snapshot
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #request(requestId: number, message: ToWorker): Promise<FromWorker> {
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject })
      this.#port.send(message)
    })
  }

  #receive(message: FromWorker): void {
    if (
      (message.type === 'range' || message.type === 'inspect' || message.type === 'error') &&
      message.requestId !== undefined
    ) {
      const pending = this.#pending.get(message.requestId)
      if (pending) {
        this.#pending.delete(message.requestId)
        if (message.type === 'error') pending.reject(new Error(message.message))
        else pending.resolve(message)
        return
      }
    }
    for (const listener of this.#listeners) listener(message)
  }
}
