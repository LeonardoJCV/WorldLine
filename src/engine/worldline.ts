import type { EventRecord } from './events.ts'
import { genesis } from './genesis.ts'
import { hashState } from './hash.ts'
import { CHECKPOINT_INTERVAL, HORIZON } from './params.ts'
import {
  VARIABLES,
  isValidAllocation,
  type Allocation,
  type Decision,
  type Variable,
  type WorldConfig,
  type WorldState,
} from './state.ts'
import { step } from './step.ts'

export interface Lineage {
  readonly parent: Worldline
  readonly tick: number
}

export interface Bucketed {
  readonly min: Float32Array
  readonly max: Float32Array
  readonly mean: Float32Array
}

interface Checkpoint {
  readonly state: WorldState
  readonly records: number
}

type Columns = Record<Variable, Float64Array>

function allocateColumns(capacity: number): Columns {
  const columns = {} as Columns
  for (const variable of VARIABLES) columns[variable] = new Float64Array(capacity)
  return columns
}

function validateDecisions(decisions: readonly Decision[]): Decision[] {
  let previous = -1
  for (const decision of decisions) {
    if (!Number.isInteger(decision.tick) || decision.tick <= previous || decision.tick >= HORIZON) {
      throw new RangeError('decisions must have increasing whole years inside the horizon')
    }
    if (!isValidAllocation(decision.allocation)) {
      throw new RangeError(`invalid allocation at year ${decision.tick}`)
    }
    previous = decision.tick
  }
  return decisions.map((d) => ({ tick: d.tick, allocation: { ...d.allocation } }))
}

export class Worldline {
  readonly world: WorldConfig
  readonly lineage: Lineage | null
  readonly records: EventRecord[] = []
  readonly #decisions: Decision[]
  readonly #checkpoints = new Map<number, Checkpoint>()
  #columns: Columns
  #length = 0
  #nextDecision = 0
  #state: WorldState

  constructor(seed: number, decisions: readonly Decision[] = [], lineage: Lineage | null = null) {
    const origin = genesis(seed)
    this.world = origin.world
    this.lineage = lineage
    this.#decisions = validateDecisions(decisions)
    this.#columns = allocateColumns(1024)
    this.#state = origin.state
    this.#record(origin.state)
  }

  get seed(): number {
    return this.world.seed
  }

  get present(): WorldState {
    return this.#state
  }

  get decisions(): readonly Decision[] {
    return this.#decisions
  }

  get ended(): boolean {
    return this.#state.status !== 'running' || this.#state.tick >= HORIZON
  }

  advance(years: number): number {
    let advanced = 0
    while (advanced < years && !this.ended) {
      const decision = this.#decisions[this.#nextDecision]
      const due = decision?.tick === this.#state.tick ? decision : undefined
      if (due) this.#nextDecision++
      const result = step(this.#state, this.world, this.records.length, due)
      this.records.push(...result.started)
      for (const index of result.ended) {
        const record = this.records[index]
        if (record) record.end = this.#state.tick
      }
      this.#state = result.state
      this.#record(result.state)
      advanced++
    }
    return advanced
  }

  decide(allocation: Allocation): Decision {
    if (this.ended) throw new Error('worldline has ended')
    if (!isValidAllocation(allocation)) {
      throw new RangeError('allocation must be whole percentages summing to 100')
    }
    const decision: Decision = { tick: this.#state.tick, allocation: { ...allocation } }
    const last = this.#decisions.at(-1)
    if (last && last.tick > decision.tick) {
      throw new Error('scheduled decisions are still pending')
    }
    if (last && last.tick === decision.tick) this.#decisions[this.#decisions.length - 1] = decision
    else this.#decisions.push(decision)
    return decision
  }

  valueAt(variable: Variable, tick: number): number {
    this.#assertRecorded(tick)
    return this.#columns[variable][tick] ?? NaN
  }

  stateAt(tick: number): WorldState {
    this.#assertRecorded(tick)
    if (tick === this.#state.tick) return this.#state
    const base = tick - (tick % CHECKPOINT_INTERVAL)
    const checkpoint = this.#checkpoints.get(base)
    if (!checkpoint) throw new Error(`missing checkpoint for year ${base}`)

    let state = checkpoint.state
    let records = checkpoint.records
    let index = this.#decisions.findIndex((d) => d.tick >= base)
    if (index === -1) index = this.#decisions.length
    while (state.tick < tick) {
      const decision = this.#decisions[index]
      const due = decision?.tick === state.tick ? decision : undefined
      if (due) index++
      const result = step(state, this.world, records, due)
      records += result.started.length
      state = result.state
    }
    return state
  }

  hashAt(tick: number): string {
    return hashState(this.stateAt(tick))
  }

  range(variable: Variable, from: number, to: number, buckets: number): Bucketed {
    this.#assertRecorded(from)
    this.#assertRecorded(to)
    if (to < from || !Number.isInteger(buckets) || buckets < 1) {
      throw new RangeError('invalid range request')
    }
    const column = this.#columns[variable]
    const span = to - from + 1
    const count = Math.min(buckets, span)
    const min = new Float32Array(count)
    const max = new Float32Array(count)
    const mean = new Float32Array(count)
    for (let b = 0; b < count; b++) {
      const start = from + Math.floor((b * span) / count)
      const end = from + Math.floor(((b + 1) * span) / count)
      let lo = Infinity
      let hi = -Infinity
      let sum = 0
      for (let i = start; i < end; i++) {
        const value = column[i] ?? NaN
        if (value < lo) lo = value
        if (value > hi) hi = value
        sum += value
      }
      min[b] = lo
      max[b] = hi
      mean[b] = sum / (end - start)
    }
    return { min, max, mean }
  }

  // FEAT: nova linha temporal a partir de um ano desta
  fork(tick: number): Worldline {
    this.#assertRecorded(tick)
    const inherited = this.#decisions.filter((d) => d.tick < tick)
    const child = new Worldline(this.seed, inherited, { parent: this, tick })
    child.advance(tick)
    return child
  }

  #record(state: WorldState): void {
    if (this.#length === this.#columns.population.length) {
      const grown = allocateColumns(this.#length * 2)
      for (const variable of VARIABLES) grown[variable].set(this.#columns[variable])
      this.#columns = grown
    }
    for (const variable of VARIABLES) this.#columns[variable][this.#length] = state[variable]
    if (state.tick % CHECKPOINT_INTERVAL === 0) {
      this.#checkpoints.set(state.tick, { state, records: this.records.length })
    }
    this.#length++
  }

  #assertRecorded(tick: number): void {
    if (!Number.isInteger(tick) || tick < 0 || tick >= this.#length) {
      throw new RangeError(`year ${tick} is outside the recorded history`)
    }
  }
}
