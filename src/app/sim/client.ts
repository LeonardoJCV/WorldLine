import type { Crossing, CrossingKind, Dose } from '../../engine/crossing.ts'
import type { Allocation, Decision } from '../../engine/state.ts'
import type {
  BranchSpec,
  FromWorker,
  Series,
  Snapshot,
  Speed,
  ToWorker,
  WorldlineId,
} from '../../worker/protocol.ts'

export interface Port {
  send(message: ToWorker): void
  listen(handler: (message: FromWorker) => void, onFailure: (message: string) => void): void
}

export function workerPort(worker: Worker): Port {
  return {
    send: (message) => worker.postMessage(message),
    listen: (handler, onFailure) => {
      worker.onmessage = (event: MessageEvent<FromWorker>) => handler(event.data)
      worker.onerror = (event) => onFailure(event.message || 'worker failed')
      worker.onmessageerror = () => onFailure('worker message could not be read')
    },
  }
}

export interface RangeResult {
  readonly from: number
  readonly to: number
  readonly series: Series
}

export interface DistanceResult {
  readonly from: number
  readonly to: number
  readonly values: Float32Array
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
    port.listen(
      (message) => this.#receive(message),
      (message) => this.#fail(message),
    )
  }

  open(
    seed: number,
    tick: number,
    root: readonly Decision[],
    branches: readonly BranchSpec[],
    crossings: readonly Crossing[] = [],
  ): void {
    this.#port.send({ type: 'open', seed, tick, root, branches, crossings })
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

  decide(world: WorldlineId, allocation: Allocation): void {
    this.#port.send({ type: 'decide', world, allocation })
  }

  async branch(parent: WorldlineId, tick: number, allocation: Allocation): Promise<WorldlineId> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, {
      type: 'branch',
      requestId,
      parent,
      tick,
      allocation,
    })
    if (reply.type !== 'branched') throw new Error(`unexpected ${reply.type} reply`)
    return reply.world
  }

  async cross(
    origin: WorldlineId,
    destination: WorldlineId,
    kind: CrossingKind,
    dose: Dose,
  ): Promise<Crossing> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, {
      type: 'cross',
      requestId,
      origin,
      destination,
      kind,
      dose,
    })
    if (reply.type !== 'crossed') throw new Error(`unexpected ${reply.type} reply`)
    return reply.crossing
  }

  async crossBranch(
    parent: WorldlineId,
    tick: number,
    origin: WorldlineId,
    kind: CrossingKind,
    dose: Dose,
  ): Promise<WorldlineId> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, {
      type: 'crossBranch',
      requestId,
      parent,
      tick,
      origin,
      kind,
      dose,
    })
    if (reply.type !== 'branched') throw new Error(`unexpected ${reply.type} reply`)
    return reply.world
  }

  remove(world: WorldlineId): void {
    this.#port.send({ type: 'remove', world })
  }

  async range(world: WorldlineId, from: number, to: number, buckets: number): Promise<RangeResult> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, {
      type: 'range',
      requestId,
      world,
      from,
      to,
      buckets,
    })
    if (reply.type !== 'range') throw new Error(`unexpected ${reply.type} reply`)
    return { from: reply.from, to: reply.to, series: reply.series }
  }

  async inspect(world: WorldlineId, tick: number): Promise<Snapshot> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, { type: 'inspect', requestId, world, tick })
    if (reply.type !== 'inspect') throw new Error(`unexpected ${reply.type} reply`)
    return reply.snapshot
  }

  async distance(
    world: WorldlineId,
    reference: WorldlineId,
    from: number,
    to: number,
    buckets: number,
  ): Promise<DistanceResult> {
    const requestId = this.#nextId++
    const reply = await this.#request(requestId, {
      type: 'distance',
      requestId,
      world,
      reference,
      from,
      to,
      buckets,
    })
    if (reply.type !== 'distance') throw new Error(`unexpected ${reply.type} reply`)
    return { from: reply.from, to: reply.to, values: reply.values }
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

  #fail(message: string): void {
    for (const pending of this.#pending.values()) pending.reject(new Error(message))
    this.#pending.clear()
    for (const listener of this.#listeners) listener({ type: 'error', message })
  }

  #receive(message: FromWorker): void {
    if (
      (message.type === 'range' ||
        message.type === 'inspect' ||
        message.type === 'branched' ||
        message.type === 'crossed' ||
        message.type === 'distance' ||
        message.type === 'error') &&
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
