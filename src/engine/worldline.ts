import { validateCrossings, type Crossing } from './crossing.ts'
import type { EventRecord } from './events.ts'
import { genesis } from './genesis.ts'
import { hashState } from './hash.ts'
import type { Merge } from './merge.ts'
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

const NO_CROSSINGS: readonly Crossing[] = []

interface DueCrossings {
  readonly due: readonly Crossing[]
  readonly next: number
}

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

// FEAT: um ano recebe uma costura só, porque `step()` aplica uma só, e a que deságua encerra a fila
function validateMerges(merges: readonly Merge[]): Merge[] {
  let previous = -1
  let away = false
  for (const merge of merges) {
    if (!Number.isInteger(merge.tick) || merge.tick <= previous || merge.tick >= HORIZON) {
      throw new RangeError('merges must have increasing whole years inside the horizon')
    }
    if (away) throw new RangeError('a history that flowed away cannot merge again')
    away = merge.direction === 'out'
    previous = merge.tick
  }
  return [...merges]
}

export class Worldline {
  readonly world: WorldConfig
  readonly lineage: Lineage | null
  readonly records: EventRecord[] = []
  readonly #decisions: Decision[]
  readonly #crossings: Crossing[]
  readonly #merges: Merge[]
  readonly #checkpoints = new Map<number, Checkpoint>()
  #columns: Columns
  #length = 0
  #nextDecision = 0
  #nextCrossing = 0
  #nextMerge = 0
  #state: WorldState

  constructor(
    seed: number,
    decisions: readonly Decision[] = [],
    lineage: Lineage | null = null,
    crossings: readonly Crossing[] = [],
    merges: readonly Merge[] = [],
  ) {
    const origin = genesis(seed)
    this.world = origin.world
    this.lineage = lineage
    this.#decisions = validateDecisions(decisions)
    this.#crossings = validateCrossings(crossings)
    this.#merges = validateMerges(merges)
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

  get crossings(): readonly Crossing[] {
    return this.#crossings
  }

  get merges(): readonly Merge[] {
    return this.#merges
  }

  get ended(): boolean {
    return this.#state.status !== 'running' || this.#state.tick >= HORIZON
  }

  advance(years: number): number {
    let advanced = 0
    while (advanced < years && !this.ended) {
      const seam = this.#dueMerge(this.#nextMerge, this.#state.tick)
      if (seam) this.#nextMerge++
      // FIX: quem deságua não vive o ano, então nada daquele ano é consumido, gravado nem contado
      const away = seam?.direction === 'out'
      let due: Decision | undefined
      let arriving: readonly Crossing[] = NO_CROSSINGS
      if (!away) {
        due = this.#dueDecision(this.#nextDecision, this.#state.tick)
        if (due) this.#nextDecision++
        const crossings = this.#dueCrossings(this.#nextCrossing, this.#state.tick)
        this.#nextCrossing = crossings.next
        arriving = crossings.due
      }
      const result = step(this.#state, this.world, this.records.length, due, arriving, seam)
      this.records.push(...result.started)
      for (const index of result.ended) {
        const record = this.records[index]
        if (record) record.end = this.#state.tick
      }
      this.#state = result.state
      if (away) break
      this.#record(result.state)
      advanced++
    }
    return advanced
  }

  // FEAT: registra a confluência no ano presente, do lado que recebe ou do lado que deságua
  merge(incoming: Merge): Merge {
    if (this.ended) throw new Error('worldline has ended')
    if (incoming.tick !== this.#state.tick) {
      throw new RangeError(`merge for year ${incoming.tick} applied at year ${this.#state.tick}`)
    }
    const last = this.#merges.at(-1)
    if (last && last.tick >= incoming.tick) {
      throw new Error('a year carries one confluence only')
    }
    this.#merges.push(incoming)
    return incoming
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

  // FEAT: registra uma travessia no ano presente, já validada
  cross(crossing: Crossing): Crossing {
    if (this.ended) throw new Error('worldline has ended')
    if (crossing.tick !== this.#state.tick) {
      throw new RangeError(`crossing for year ${crossing.tick} applied at year ${this.#state.tick}`)
    }
    const last = this.#crossings.at(-1)
    if (last && last.tick > crossing.tick) {
      throw new Error('scheduled crossings are still pending')
    }
    const validated = validateCrossings([...this.#crossings, crossing])
    const recorded = validated.at(-1) ?? crossing
    this.#crossings.push(recorded)
    return recorded
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
    let crossed = this.#crossings.findIndex((c) => c.tick >= base)
    if (crossed === -1) crossed = this.#crossings.length
    let seamed = this.#merges.findIndex((m) => m.tick >= base)
    if (seamed === -1) seamed = this.#merges.length
    while (state.tick < tick) {
      const due = this.#dueDecision(index, state.tick)
      if (due) index++
      const arriving = this.#dueCrossings(crossed, state.tick)
      crossed = arriving.next
      const seam = this.#dueMerge(seamed, state.tick)
      if (seam) seamed++
      const result = step(state, this.world, records, due, arriving.due, seam)
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
    const inheritedCrossings = this.#crossings.filter((c) => c.tick < tick)
    // FEAT: uma costura antes do ponto de partida faz parte do passado que o filho tem de reviver
    const inheritedMerges = this.#merges.filter((m) => m.tick < tick)
    const child = new Worldline(
      this.seed,
      inherited,
      { parent: this, tick },
      inheritedCrossings,
      inheritedMerges,
    )
    child.advance(tick)
    return child
  }

  #dueDecision(index: number, tick: number): Decision | undefined {
    const decision = this.#decisions[index]
    return decision?.tick === tick ? decision : undefined
  }

  #dueMerge(index: number, tick: number): Merge | undefined {
    const merge = this.#merges[index]
    return merge?.tick === tick ? merge : undefined
  }

  // FEAT: várias travessias podem cair no mesmo ano; uma entrada vencida nunca trava o cursor
  #dueCrossings(index: number, tick: number): DueCrossings {
    let start = index
    while (start < this.#crossings.length) {
      const stale = this.#crossings[start]
      if (!stale || stale.tick >= tick) break
      start++
    }
    let end = start
    while (this.#crossings[end]?.tick === tick) end++
    return { due: end === start ? NO_CROSSINGS : this.#crossings.slice(start, end), next: end }
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
