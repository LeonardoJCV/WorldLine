import {
  CROSSING_KINDS,
  DOSES,
  validateCrossings,
  type Crossing,
  type Dose,
} from '../../engine/crossing.ts'
import { HORIZON, MAX_SEED } from '../../engine/params.ts'
import { SECTORS, isValidAllocation, type Allocation, type Decision } from '../../engine/state.ts'
import {
  MAX_WORLDLINES,
  WORLDLINE_IDS,
  type BranchSpec,
  type MergeSpec,
} from '../../worker/protocol.ts'

export interface WorldLink {
  readonly version: number
  readonly seed: number
  readonly tick: number
  readonly decisions: readonly Decision[]
  readonly crossings?: readonly Crossing[]
}

export interface MultiverseLink extends WorldLink {
  readonly branches: readonly BranchSpec[]
  readonly merges?: readonly MergeSpec[]
}

const HEADER = 9
const DECISION = 6
const CROSSING = 10
// FEAT: a parcela vai em dupla precisão, para o mundo reaberto repetir a história byte a byte
const AMOUNT = 8
const MERGE = 5
const MAX_COST = 255
const MAX_CROSSINGS = 255
const MAX_MERGES = 255
const CROSSED_VERSION = 2
// FEAT: a costura só existe a partir daqui, e um mundo sem costura nunca chega nesta versão
export const SEAMED_VERSION = 3

function validDecisions(decisions: unknown, from: number): boolean {
  if (!Array.isArray(decisions)) return false
  let previous = from - 1
  for (const decision of decisions as unknown[]) {
    if (typeof decision !== 'object' || decision === null) return false
    const { tick, allocation } = decision as Partial<Decision>
    if (typeof allocation !== 'object' || allocation === null) return false
    if (!Number.isInteger(tick) || (tick ?? -1) <= previous || (tick ?? HORIZON) >= HORIZON) {
      return false
    }
    if (!isValidAllocation(allocation)) return false
    previous = tick ?? previous
  }
  return true
}

function validCrossing(value: unknown, from: number): boolean {
  if (typeof value !== 'object' || value === null) return false
  const { tick, kind, dose, direction, cost, origin, amounts, allocation, circular } =
    value as Partial<Crossing>
  if (!Number.isInteger(tick) || (tick ?? -1) < from) return false
  if (circular !== undefined && typeof circular !== 'boolean') return false
  if (!CROSSING_KINDS.some((known) => known === kind)) return false
  if (!DOSES.some((known) => known === dose)) return false
  if (direction !== 'in' && direction !== 'out') return false
  if (!Number.isInteger(cost) || (cost ?? -1) < 0 || (cost ?? MAX_COST + 1) > MAX_COST) return false
  if (typeof origin !== 'object' || origin === null || typeof origin.world !== 'string')
    return false
  if (!Number.isInteger(origin.tick) || origin.tick < 0 || origin.tick >= HORIZON) return false
  if (!Array.isArray(amounts)) return false
  return allocation === undefined ? true : isValidAllocation(allocation)
}

// FIX: a engine recusa um registro corrompido com RangeError; aqui isso vira apenas um link inválido
function validCrossings(crossings: unknown, from: number): boolean {
  if (crossings === undefined) return true
  if (!Array.isArray(crossings) || crossings.length > MAX_CROSSINGS) return false
  if (!(crossings as unknown[]).every((crossing) => validCrossing(crossing, from))) return false
  try {
    validateCrossings(crossings as readonly Crossing[])
  } catch {
    return false
  }
  return true
}

// FIX: a engine recusa uma costura fora de ordem com RangeError; aqui isso vira um link inválido
function validMerges(merges: unknown, from: number, until: number, own: string): boolean {
  if (merges === undefined) return true
  if (!Array.isArray(merges) || merges.length > MAX_MERGES) return false
  // FEAT: a costura acontece no presente da worldline, então nunca depois do ano que o link guarda
  const last = Math.min(until, HORIZON - 1)
  let previous = from - 1
  let away = false
  for (const value of merges as unknown[]) {
    if (typeof value !== 'object' || value === null) return false
    const { tick, self, other, direction } = value as Partial<MergeSpec>
    // FIX: o bloco já diz de quem é a costura, então um `self` que discorde dele é link corrompido
    if (self !== own || typeof other !== 'string' || self === other) return false
    if (direction !== 'in' && direction !== 'out') return false
    if (!Number.isInteger(tick) || (tick ?? -1) <= previous || (tick ?? last + 1) > last) {
      return false
    }
    // FEAT: uma história que já desaguou noutra não costura mais nada, nem no link
    if (away) return false
    away = direction === 'out'
    previous = tick ?? previous
  }
  return true
}

// FEAT: um mundo sem travessia sai igual na v1 e na v2, então um link antigo não merece aviso
const COMPATIBLE_VERSIONS: readonly number[] = [1, CROSSED_VERSION, SEAMED_VERSION]

export function isCompatibleVersion(version: number): boolean {
  return COMPATIBLE_VERSIONS.includes(version)
}

export function isValidLink(link: WorldLink): boolean {
  if (!Number.isInteger(link.version) || link.version < 0 || link.version > 255) return false
  if (!Number.isInteger(link.seed) || link.seed < 0 || link.seed > MAX_SEED) return false
  if (!Number.isInteger(link.tick) || link.tick < 0 || link.tick > HORIZON) return false
  if (!validCrossings(link.crossings, 0)) return false
  return validDecisions(link.decisions, 0)
}

export function toMultiverse(link: WorldLink): MultiverseLink {
  return { ...link, crossings: link.crossings ?? [], branches: [] }
}

export function isValidMultiverse(link: MultiverseLink): boolean {
  if (!isValidLink(link) || !Array.isArray(link.branches)) return false
  if (link.branches.length > MAX_WORLDLINES - 1) return false
  if (!validMerges(link.merges, 0, link.tick, WORLDLINE_IDS[0] ?? '')) return false
  return link.branches.every((branch, i) => {
    if (typeof branch !== 'object' || branch === null) return false
    const { parent, fork, decisions, crossings, merges } = branch
    if (!Number.isInteger(parent) || parent < 0 || parent > i) return false
    if (!Number.isInteger(fork) || fork < 0 || fork > link.tick) return false
    if (!validCrossings(crossings, fork)) return false
    if (!validMerges(merges, fork, link.tick, WORLDLINE_IDS[i + 1] ?? '')) return false
    return validDecisions(decisions, fork)
  })
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

export function encodeLink(link: WorldLink): string {
  const bytes = new Uint8Array(HEADER + link.decisions.length * DECISION)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, link.version)
  view.setUint32(1, link.seed)
  view.setUint16(5, link.tick)
  view.setUint16(7, link.decisions.length)
  link.decisions.forEach((decision, i) => {
    const at = HEADER + i * DECISION
    view.setUint16(at, decision.tick)
    SECTORS.forEach((sector, k) => view.setUint8(at + 2 + k, decision.allocation[sector]))
  })
  return toBase64Url(bytes)
}

export function decodeLink(text: string): WorldLink | null {
  const bytes = fromBase64Url(text)
  if (!bytes || bytes.length < HEADER) return null
  const view = new DataView(bytes.buffer)
  const count = view.getUint16(7)
  if (bytes.length !== HEADER + count * DECISION) return null
  const decisions: Decision[] = []
  for (let i = 0; i < count; i++) {
    const at = HEADER + i * DECISION
    const allocation = {} as Record<(typeof SECTORS)[number], number>
    SECTORS.forEach((sector, k) => {
      allocation[sector] = view.getUint8(at + 2 + k)
    })
    decisions.push({ tick: view.getUint16(at), allocation: allocation as Allocation })
  }
  const link: WorldLink = {
    version: view.getUint8(0),
    seed: view.getUint32(1),
    tick: view.getUint16(5),
    decisions,
    crossings: [],
  }
  return isValidLink(link) ? link : null
}

function writeDecisions(view: DataView, at: number, decisions: readonly Decision[]): number {
  view.setUint16(at, decisions.length)
  let cursor = at + 2
  for (const decision of decisions) {
    view.setUint16(cursor, decision.tick)
    SECTORS.forEach((sector, k) => view.setUint8(cursor + 2 + k, decision.allocation[sector]))
    cursor += DECISION
  }
  return cursor
}

function readDecisions(view: DataView, at: number): { decisions: Decision[]; next: number } | null {
  if (at + 2 > view.byteLength) return null
  const count = view.getUint16(at)
  let cursor = at + 2
  if (cursor + count * DECISION > view.byteLength) return null
  const decisions: Decision[] = []
  for (let i = 0; i < count; i++) {
    const allocation = {} as Record<(typeof SECTORS)[number], number>
    SECTORS.forEach((sector, k) => {
      allocation[sector] = view.getUint8(cursor + 2 + k)
    })
    decisions.push({ tick: view.getUint16(cursor), allocation: allocation as Allocation })
    cursor += DECISION
  }
  return { decisions, next: cursor }
}

function crossingSize(crossings: readonly Crossing[] = []): number {
  return crossings.reduce(
    (sum, c) => sum + CROSSING + c.amounts.length * AMOUNT + (c.kind === 'doctrine' ? 4 : 0),
    1,
  )
}

// FEAT: o mundo de origem vira a posição dele no link; 255 diz que ele não está mais aqui
function worldIndex(world: string): number {
  const index = WORLDLINE_IDS.findIndex((candidate) => candidate === world)
  return index === -1 ? 0xff : index
}

function writeCrossings(view: DataView, at: number, crossings: readonly Crossing[] = []): number {
  view.setUint8(at, crossings.length)
  let cursor = at + 1
  for (const crossing of crossings) {
    view.setUint16(cursor, crossing.tick)
    view.setUint8(cursor + 2, CROSSING_KINDS.indexOf(crossing.kind))
    view.setUint8(cursor + 3, crossing.dose)
    // FEAT: o byte da direção sobrava: o bit 1 carrega o ciclo, e um link antigo o lê como ausente
    view.setUint8(cursor + 4, (crossing.direction === 'out' ? 1 : 0) | (crossing.circular ? 2 : 0))
    view.setUint8(cursor + 5, crossing.cost)
    view.setUint8(cursor + 6, worldIndex(crossing.origin.world))
    view.setUint16(cursor + 7, crossing.origin.tick)
    view.setUint8(cursor + 9, crossing.amounts.length)
    cursor += CROSSING
    for (const amount of crossing.amounts) {
      view.setFloat64(cursor, amount)
      cursor += AMOUNT
    }
    if (crossing.kind === 'doctrine') {
      const allocation = crossing.allocation
      SECTORS.forEach((sector, k) => view.setUint8(cursor + k, allocation?.[sector] ?? 0))
      cursor += 4
    }
  }
  return cursor
}

function readCrossings(view: DataView, at: number): { crossings: Crossing[]; next: number } | null {
  if (at + 1 > view.byteLength) return null
  const count = view.getUint8(at)
  let cursor = at + 1
  const crossings: Crossing[] = []
  for (let i = 0; i < count; i++) {
    if (cursor + CROSSING > view.byteLength) return null
    const kind = CROSSING_KINDS[view.getUint8(cursor + 2)]
    if (!kind) return null
    const parcels = view.getUint8(cursor + 9)
    const shares = kind === 'doctrine' ? 4 : 0
    const body = cursor + CROSSING
    if (body + parcels * AMOUNT + shares > view.byteLength) return null
    const amounts: number[] = []
    for (let k = 0; k < parcels; k++) amounts.push(view.getFloat64(body + k * AMOUNT))
    const at2 = body + parcels * AMOUNT
    const allocation = {} as Record<(typeof SECTORS)[number], number>
    SECTORS.forEach((sector, k) => {
      allocation[sector] = shares === 0 ? 0 : view.getUint8(at2 + k)
    })
    const flags = view.getUint8(cursor + 4)
    crossings.push({
      tick: view.getUint16(cursor),
      kind,
      dose: view.getUint8(cursor + 3) as Dose,
      amounts,
      origin: {
        world: WORLDLINE_IDS[view.getUint8(cursor + 6)] ?? '',
        tick: view.getUint16(cursor + 7),
      },
      cost: view.getUint8(cursor + 5),
      direction: (flags & 1) === 0 ? 'in' : 'out',
      ...(shares === 0 ? {} : { allocation: allocation as Allocation }),
      ...((flags & 2) === 0 ? {} : { circular: true }),
    })
    cursor = at2 + shares
  }
  return { crossings, next: cursor }
}

function mergeSize(merges: readonly MergeSpec[] = []): number {
  return 1 + merges.length * MERGE
}

function writeMerges(view: DataView, at: number, merges: readonly MergeSpec[] = []): number {
  view.setUint8(at, merges.length)
  let cursor = at + 1
  for (const merge of merges) {
    view.setUint16(cursor, merge.tick)
    view.setUint8(cursor + 2, worldIndex(merge.self))
    view.setUint8(cursor + 3, worldIndex(merge.other))
    view.setUint8(cursor + 4, merge.direction === 'out' ? 1 : 0)
    cursor += MERGE
  }
  return cursor
}

function readMerges(view: DataView, at: number): { merges: MergeSpec[]; next: number } | null {
  if (at + 1 > view.byteLength) return null
  const count = view.getUint8(at)
  let cursor = at + 1
  const merges: MergeSpec[] = []
  for (let i = 0; i < count; i++) {
    if (cursor + MERGE > view.byteLength) return null
    merges.push({
      tick: view.getUint16(cursor),
      self: WORLDLINE_IDS[view.getUint8(cursor + 2)] ?? '',
      other: WORLDLINE_IDS[view.getUint8(cursor + 3)] ?? '',
      direction: view.getUint8(cursor + 4) === 0 ? 'in' : 'out',
    })
    cursor += MERGE
  }
  return { merges, next: cursor }
}

// FEAT: a versão descreve o que o formato carrega, e sobe só quando há costura para carregar, para
// um mundo já compartilhado sair byte a byte igual — a mesma regra vale para o link e para o arquivo
export function formatVersion(link: MultiverseLink): number {
  const seams =
    (link.merges?.length ?? 0) + link.branches.reduce((sum, b) => sum + (b.merges?.length ?? 0), 0)
  return seams === 0 ? CROSSED_VERSION : SEAMED_VERSION
}

export function encodeMultiverse(link: MultiverseLink): string {
  const version = formatVersion(link)
  const size =
    7 +
    2 +
    link.decisions.length * DECISION +
    1 +
    link.branches.reduce((sum, b) => sum + 3 + 2 + b.decisions.length * DECISION, 0) +
    crossingSize(link.crossings) +
    link.branches.reduce((sum, b) => sum + crossingSize(b.crossings), 0) +
    (version < SEAMED_VERSION
      ? 0
      : mergeSize(link.merges) + link.branches.reduce((sum, b) => sum + mergeSize(b.merges), 0))
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, version)
  view.setUint32(1, link.seed)
  view.setUint16(5, link.tick)
  let cursor = writeDecisions(view, 7, link.decisions)
  view.setUint8(cursor, link.branches.length)
  cursor += 1
  for (const branch of link.branches) {
    view.setUint8(cursor, branch.parent)
    view.setUint16(cursor + 1, branch.fork)
    cursor = writeDecisions(view, cursor + 3, branch.decisions)
  }
  cursor = writeCrossings(view, cursor, link.crossings)
  for (const branch of link.branches) cursor = writeCrossings(view, cursor, branch.crossings)
  if (version >= SEAMED_VERSION) {
    cursor = writeMerges(view, cursor, link.merges)
    for (const branch of link.branches) cursor = writeMerges(view, cursor, branch.merges)
  }
  return toBase64Url(bytes)
}

export function decodeMultiverse(text: string): MultiverseLink | null {
  const bytes = fromBase64Url(text)
  if (!bytes || bytes.length < 10) return null
  const view = new DataView(bytes.buffer)
  const root = readDecisions(view, 7)
  if (!root || root.next + 1 > bytes.length) return null
  const count = view.getUint8(root.next)
  let cursor = root.next + 1
  const plain: { parent: number; fork: number; decisions: Decision[] }[] = []
  for (let i = 0; i < count; i++) {
    if (cursor + 3 > bytes.length) return null
    const parent = view.getUint8(cursor)
    const fork = view.getUint16(cursor + 1)
    const read = readDecisions(view, cursor + 3)
    if (!read) return null
    plain.push({ parent, fork, decisions: read.decisions })
    cursor = read.next
  }
  const version = view.getUint8(0)
  const logs: Crossing[][] = []
  if (version >= CROSSED_VERSION) {
    for (let i = 0; i <= plain.length; i++) {
      const read = readCrossings(view, cursor)
      if (!read) return null
      logs.push(read.crossings)
      cursor = read.next
    }
  }
  const seams: MergeSpec[][] = []
  if (version >= SEAMED_VERSION) {
    for (let i = 0; i <= plain.length; i++) {
      const read = readMerges(view, cursor)
      if (!read) return null
      seams.push(read.merges)
      cursor = read.next
    }
  }
  if (cursor !== bytes.length) return null
  // FEAT: sem costura o campo nem aparece, então um link antigo volta com a forma que sempre teve
  const own = seams[0] ?? []
  const link: MultiverseLink = {
    version,
    seed: view.getUint32(1),
    tick: view.getUint16(5),
    decisions: root.decisions,
    crossings: logs[0] ?? [],
    ...(own.length === 0 ? {} : { merges: own }),
    branches: plain.map((branch, i) => {
      const sewn = seams[i + 1] ?? []
      return {
        ...branch,
        crossings: logs[i + 1] ?? [],
        ...(sewn.length === 0 ? {} : { merges: sewn }),
      }
    }),
  }
  return isValidMultiverse(link) ? link : null
}

// FEAT: a forma curta não carrega travessia nem costura, então quem tem uma vai pela forma longa
export function linkHash(link: MultiverseLink): string {
  const plain =
    link.branches.length === 0 &&
    (link.crossings?.length ?? 0) === 0 &&
    (link.merges?.length ?? 0) === 0
  return plain ? `#/w/${encodeLink(link)}` : `#/m/${encodeMultiverse(link)}`
}
