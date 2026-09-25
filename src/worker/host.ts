import {
  CROSSING_KINDS,
  DOSES,
  credit,
  crossingAmounts,
  crossingCost,
  validateCrossings,
  type Crossing,
  type CrossingKind,
  type Dose,
} from '../engine/crossing.ts'
import { bearsDebt, circularParadox, debtRatio, type Debt } from '../engine/debt.ts'
import { causalDistance } from '../engine/distance.ts'
import { validateMerge, type Merge } from '../engine/merge.ts'
import { HORIZON } from '../engine/params.ts'
import {
  VARIABLES,
  isValidAllocation,
  type Allocation,
  type Decision,
  type Variable,
  type WorldState,
} from '../engine/state.ts'
import { system } from '../engine/system.ts'
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
          this.#open(
            message.seed,
            message.tick,
            message.root,
            message.branches,
            message.crossings ?? [],
          )
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
        case 'cross':
          this.#cross(
            message.requestId,
            message.origin,
            message.destination,
            message.kind,
            message.dose,
          )
          break
        case 'crossBranch':
          this.#crossBranch(
            message.requestId,
            message.parent,
            message.tick,
            message.origin,
            message.kind,
            message.dose,
          )
          break
        case 'merge':
          this.#merge(message.requestId, message.survivor, message.other)
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

  #make(
    generation: number,
    id: WorldlineId,
    parent: WorldlineId | null,
    fork: number,
    worldline: Worldline,
  ): Entry {
    return { info: { id, parent, fork, generation }, worldline, reported: 0, open: [] }
  }

  #add(id: WorldlineId, parent: WorldlineId | null, fork: number, worldline: Worldline): void {
    this.#generation += 1
    this.#entries.push(this.#make(this.#generation, id, parent, fork, worldline))
  }

  #freeId(entries: readonly Entry[] = this.#entries): WorldlineId {
    const id = WORLDLINE_IDS.find((candidate) => !entries.some((e) => e.info.id === candidate))
    if (!id) throw new RangeError('worldline limit reached')
    return id
  }

  #grow(
    seed: number,
    parent: Entry,
    fork: number,
    own: readonly Decision[],
    target: number,
    ownCrossings: readonly Crossing[] = [],
  ): Worldline {
    if (!Number.isInteger(fork) || fork < 0 || fork > parent.worldline.present.tick) {
      throw new RangeError('fork outside the parent history')
    }
    const inherited = parent.worldline.decisions.filter((decision) => decision.tick < fork)
    const crossed = parent.worldline.crossings.filter((crossing) => crossing.tick < fork)
    // FIX: uma costura antes da bifurcação é passado da filha; sem ela a filha não seria a mãe nesse ano
    const seamed = parent.worldline.merges.filter((seam) => seam.tick < fork)
    const line = new Worldline(
      seed,
      [...inherited, ...own],
      { parent: parent.worldline, tick: fork },
      [...crossed, ...ownCrossings],
      seamed,
    )
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

  // FIX: só troca o estado após validar todo o multiverso
  #open(
    seed: number,
    tick: number,
    root: readonly Decision[],
    branches: readonly BranchSpec[],
    crossings: readonly Crossing[],
  ): void {
    this.#stop()
    if (branches.length >= MAX_WORLDLINES) throw new RangeError('worldline limit reached')
    const origin = new Worldline(seed, root, null, crossings)
    origin.advance(tick)
    let generation = this.#generation
    const entries: Entry[] = [this.#make(++generation, 'A', null, 0, origin)]
    for (const spec of branches) {
      const parent = entries[spec.parent]
      if (!parent) throw new RangeError('unknown parent worldline')
      const line = this.#grow(seed, parent, spec.fork, spec.decisions, tick, spec.crossings ?? [])
      const id = this.#freeId(entries)
      entries.push(this.#make(++generation, id, parent.info.id, spec.fork, line))
    }
    this.#seed = seed
    this.#entries = entries
    this.#generation = generation
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
    const line = this.#grow(this.#seed, parent, tick, [{ tick, allocation }], this.#now)
    this.#add(id, parentId, tick, line)
    this.#report()
    this.#send({ type: 'branched', requestId, world: id })
  }

  // FIX: só as travessias próprias do mundo pesam; as herdadas já foram pagas no mundo de origem
  #spent(entry: Entry): number {
    return entry.worldline.crossings
      .filter((crossing) => crossing.tick >= entry.info.fork)
      .reduce(
        (total, crossing) =>
          total + (Number.isFinite(crossing.cost) ? Math.max(0, crossing.cost) : 0),
        0,
      )
  }

  #credit(): number {
    return credit(
      this.#entries.map((entry) => ({
        tick: entry.worldline.present.tick,
        ended: entry.worldline.ended,
        spent: this.#spent(entry),
      })),
    )
  }

  // FEAT: a engine nunca vê outras worldlines; o hospedeiro é quem monta o livro-razão do multiverso
  #ledgers(
    overrides: ReadonlyMap<WorldlineId, readonly Debt[]> = new Map(),
  ): ReadonlyMap<string, readonly Debt[]> {
    return new Map(
      this.#entries.map((entry) => [
        entry.info.id,
        overrides.get(entry.info.id) ?? entry.worldline.present.debts,
      ]),
    )
  }

  #living(entry: Entry, role: string): void {
    if (entry.worldline.ended) {
      const status = entry.worldline.present.status
      // FIX: uma história que desaguou em outra não está no horizonte; diz o que houve com ela
      const state =
        status === 'extinct'
          ? 'extinct'
          : status === 'collapsed'
            ? 'collapsed'
            : status === 'merged'
              ? 'already merged into another history'
              : 'past the horizon'
      throw new RangeError(`the ${role} worldline ${entry.info.id} is ${state}`)
    }
  }

  // FEAT: confere antes de gravar, para as duas pontas nunca ficarem fora de passo
  #ensureCrossable(entry: Entry, crossing: Crossing, role: string): void {
    const line = entry.worldline
    this.#living(entry, role)
    if (crossing.tick !== line.present.tick) {
      throw new RangeError(
        `crossing for year ${crossing.tick} applied to the ${role} worldline ${entry.info.id} at year ${line.present.tick}`,
      )
    }
    const last = line.crossings.at(-1)
    if (last && last.tick > crossing.tick) {
      throw new RangeError(`worldline ${entry.info.id} still has a later crossing pending`)
    }
    validateCrossings([...line.crossings, crossing])
  }

  // FEAT: as duas pontas de qualquer travessia passam pelas mesmas recusas
  #ends(
    originId: WorldlineId,
    destinationId: WorldlineId,
    kind: CrossingKind,
    dose: Dose,
  ): { origin: Entry; destination: Entry } {
    if (!CROSSING_KINDS.includes(kind)) throw new RangeError(`unknown crossing kind ${kind}`)
    if (!DOSES.includes(dose)) throw new RangeError('a crossing carries a dose of 1, 2 or 3')
    const origin = this.#entry(originId)
    const destination = this.#entry(destinationId)
    if (originId === destinationId) {
      throw new RangeError('origin and destination are the same worldline')
    }
    this.#living(origin, 'origin')
    return { origin, destination }
  }

  #afford(cost: number): void {
    const available = this.#credit()
    if (cost > available) {
      throw new RangeError(
        `not enough credit: this crossing costs ${cost} and ${cost - available} is missing`,
      )
    }
  }

  #cross(
    requestId: number,
    originId: WorldlineId,
    destinationId: WorldlineId,
    kind: CrossingKind,
    dose: Dose,
  ): void {
    const { origin, destination } = this.#ends(originId, destinationId, kind, dose)
    this.#living(destination, 'destination')

    const originState = origin.worldline.stateAt(this.#now)
    const destinationState = destination.worldline.stateAt(this.#now)
    // FEAT: alcançar um mundo devedor custa mais; o ciclo é do hospedeiro, a dívida da engine
    const cost = crossingCost(
      kind,
      dose,
      causalDistance(originState, destinationState),
      debtRatio(destinationState.debts, destinationState),
    )
    this.#afford(cost)
    // FIX: gente não abre dívida, então também não fecha ciclo de dívida nenhum
    const circular =
      bearsDebt(kind) &&
      circularParadox(
        originId,
        destinationId,
        this.#ledgers(
          new Map([
            [originId, originState.debts],
            [destinationId, destinationState.debts],
          ]),
        ),
      )

    const crossing: Crossing = {
      tick: this.#now,
      kind,
      dose,
      amounts: crossingAmounts(kind, dose, originState),
      origin: { world: originId, tick: this.#now },
      cost,
      direction: 'in',
      ...(kind === 'doctrine' ? { allocation: originState.allocation } : {}),
      ...(circular ? { circular: true } : {}),
    }
    // FEAT: o custo é cobrado uma vez só, na chegada
    // FIX: na partida, origin é a outra ponta da travessia, ou seja, para onde a gente foi
    const departure: Crossing | null =
      kind === 'people'
        ? {
            ...crossing,
            direction: 'out',
            cost: 0,
            origin: { world: destinationId, tick: this.#now },
          }
        : null
    this.#ensureCrossable(destination, crossing, 'destination')
    if (departure) this.#ensureCrossable(origin, departure, 'origin')
    const recorded = destination.worldline.cross(crossing)
    if (departure) origin.worldline.cross(departure)

    this.#report()
    this.#send({ type: 'crossed', requestId, world: destinationId, crossing: recorded })
  }

  // FEAT: travessia num ano passado ramifica, e a travessia nasce no ano da bifurcação
  #crossBranch(
    requestId: number,
    parentId: WorldlineId,
    tick: number,
    originId: WorldlineId,
    kind: CrossingKind,
    dose: Dose,
  ): void {
    if (kind === 'people') {
      throw new RangeError(
        'people only cross in the present, because sending them into a past year would rewrite the history of the origin as well',
      )
    }
    const { origin, destination: parent } = this.#ends(originId, parentId, kind, dose)
    if (this.#entries.length >= MAX_WORLDLINES) throw new RangeError('worldline limit reached')
    if (!Number.isInteger(tick) || tick < 0 || tick > parent.worldline.present.tick) {
      throw new RangeError(`worldline ${parentId} never lived through year ${tick}`)
    }

    const originState = origin.worldline.stateAt(tick)
    const parentState = parent.worldline.stateAt(tick)
    const cost = crossingCost(
      kind,
      dose,
      causalDistance(originState, parentState),
      debtRatio(parentState.debts, parentState),
    )
    this.#afford(cost)
    // FIX: o ciclo é julgado pela dívida que o mundo pai tinha no ano da bifurcação, não na sua atual
    const circular = circularParadox(
      originId,
      parentId,
      this.#ledgers(
        new Map([
          [originId, originState.debts],
          [parentId, parentState.debts],
        ]),
      ),
    )

    const crossing: Crossing = {
      tick,
      kind,
      dose,
      amounts: crossingAmounts(kind, dose, originState),
      origin: { world: originId, tick },
      cost,
      direction: 'in',
      ...(kind === 'doctrine' ? { allocation: originState.allocation } : {}),
      ...(circular ? { circular: true } : {}),
    }
    const id = this.#freeId()
    const line = this.#grow(this.#seed, parent, tick, [], this.#now, [crossing])
    this.#add(id, parentId, tick, line)
    this.#report()
    this.#send({ type: 'branched', requestId, world: id })
  }

  // FEAT: o corpo natal vem da semente, que é do hospedeiro; a engine nunca resolve o outro lado
  #natal(): number {
    const home = system(this.#seed).find((body) => body.home)
    if (!home) throw new Error(`world ${this.#seed} has no home body`)
    return home.index
  }

  // FEAT: confere as duas pontas antes de gravar qualquer uma, porque meia costura não tem volta
  #ensureSeamable(entry: Entry, seam: Merge, role: string): void {
    const line = entry.worldline
    this.#living(entry, role)
    // FEAT: precaução, não comportamento provado — toda worldline viva está no ano de `#now` hoje
    if (seam.tick !== line.present.tick) {
      throw new RangeError(
        `confluence for year ${seam.tick} applied to the ${role} worldline ${entry.info.id} at year ${line.present.tick}`,
      )
    }
    const last = line.merges.at(-1)
    if (last && last.tick >= seam.tick) {
      throw new RangeError(
        `worldline ${entry.info.id} already carries a confluence in year ${seam.tick}`,
      )
    }
    validateMerge(seam)
  }

  // FEAT: duas histórias viram uma: a sobrevivente recebe os números da outra, e a outra deságua
  #merge(requestId: number, survivorId: WorldlineId, otherId: WorldlineId): void {
    const survivor = this.#entry(survivorId)
    const other = this.#entry(otherId)
    if (survivorId === otherId) {
      throw new RangeError('the surviving and the departing worldline are the same')
    }
    const tick = this.#now
    const natal = this.#natal()
    const leaving = other.worldline.present
    const arrival: Merge = {
      tick,
      self: survivorId,
      other: otherId,
      direction: 'in',
      natal,
      values: toSnapshot(leaving).values,
      debts: leaving.debts,
      echoes: leaving.echoes,
      paradox: leaving.paradox,
      strain: leaving.strain,
      colonies: leaving.colonies,
      home: leaving.home,
    }
    const departure: Merge = { tick, self: otherId, other: survivorId, direction: 'out', natal }
    this.#ensureSeamable(survivor, arrival, 'surviving')
    this.#ensureSeamable(other, departure, 'departing')
    survivor.worldline.merge(arrival)
    other.worldline.merge(departure)
    // FEAT: o deságue é imediato e não vive o ano da costura, como uma extinção para onde parou
    other.worldline.advance(1)

    this.#report()
    this.#send({ type: 'merged', requestId, world: survivorId })
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
      crossings: worldline.crossings.map((c) => ({
        ...c,
        amounts: [...c.amounts],
        origin: { ...c.origin },
        ...(c.allocation ? { allocation: { ...c.allocation } } : {}),
      })),
      debts: worldline.present.debts,
      paradox: worldline.present.paradox,
      colonies: worldline.present.colonies,
    }
  }

  #report(): void {
    if (this.#entries.length === 0) return
    let ended: EndReason | null = null
    if (this.#allEnded()) {
      // FEAT: colapso é motivo próprio de fim — não é o mesmo destino que a extinção
      // FEAT: e a confluência explica por que sobraram menos histórias, antes de como a última caiu
      ended = this.#entries.some((entry) => entry.worldline.present.status === 'running')
        ? 'horizon'
        : this.#entries.some((entry) => entry.worldline.present.status === 'merged')
          ? 'merge'
          : this.#entries.some((entry) => entry.worldline.present.status === 'collapsed')
            ? 'collapse'
            : 'extinction'
    }
    this.#send({
      type: 'progress',
      now: this.#now,
      credit: this.#credit(),
      playing: this.#playing,
      ended,
      worlds: this.#entries.map((entry) => this.#progressOf(entry)),
    })
  }
}
