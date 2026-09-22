import {
  CROSSING_KINDS,
  DOSES,
  validateCrossings,
  type Crossing,
  type Dose,
} from '../../engine/crossing.ts'
import { HORIZON, MAX_SEED } from '../../engine/params.ts'
import { SECTORS, isValidAllocation, type Allocation, type Decision } from '../../engine/state.ts'
import { MAX_WORLDLINES, WORLDLINE_IDS, type BranchSpec } from '../../worker/protocol.ts'

export interface WorldLink {
  readonly version: number
  readonly seed: number
  readonly tick: number
  readonly decisions: readonly Decision[]
  readonly crossings?: readonly Crossing[]
}

export interface MultiverseLink extends WorldLink {
  readonly branches: readonly BranchSpec[]
}

const HEADER = 9
const DECISION = 6
const CROSSING = 10
// FEAT: a parcela vai em dupla precisão, para o mundo reaberto repetir a história byte a byte
const AMOUNT = 8
const MAX_COST = 255
const MAX_CROSSINGS = 255
const CROSSED_VERSION = 2

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
  const { tick, kind, dose, direction, cost, origin, amounts, allocation } =
    value as Partial<Crossing>
  if (!Number.isInteger(tick) || (tick ?? -1) < from) return false
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

// FEAT: um mundo sem travessia sai igual na v1 e na v2, então um link antigo não merece aviso
const COMPATIBLE_VERSIONS: readonly number[] = [1, CROSSED_VERSION]

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
  return link.branches.every((branch, i) => {
    if (typeof branch !== 'object' || branch === null) return false
    const { parent, fork, decisions, crossings } = branch
    if (!Number.isInteger(parent) || parent < 0 || parent > i) return false
    if (!Number.isInteger(fork) || fork < 0 || fork > link.tick) return false
    if (!validCrossings(crossings, fork)) return false
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
    view.setUint8(cursor + 4, crossing.direction === 'out' ? 1 : 0)
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
      direction: view.getUint8(cursor + 4) === 0 ? 'in' : 'out',
      ...(shares === 0 ? {} : { allocation: allocation as Allocation }),
    })
    cursor = at2 + shares
  }
  return { crossings, next: cursor }
}

export function encodeMultiverse(link: MultiverseLink): string {
  const size =
    7 +
    2 +
    link.decisions.length * DECISION +
    1 +
    link.branches.reduce((sum, b) => sum + 3 + 2 + b.decisions.length * DECISION, 0) +
    crossingSize(link.crossings) +
    link.branches.reduce((sum, b) => sum + crossingSize(b.crossings), 0)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, CROSSED_VERSION)
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
  if (cursor !== bytes.length) return null
  const link: MultiverseLink = {
    version,
    seed: view.getUint32(1),
    tick: view.getUint16(5),
    decisions: root.decisions,
    crossings: logs[0] ?? [],
    branches: plain.map((branch, i) => ({ ...branch, crossings: logs[i + 1] ?? [] })),
  }
  return isValidMultiverse(link) ? link : null
}

// FEAT: a forma curta não carrega travessias, então um mundo atravessado vai pela forma longa
export function linkHash(link: MultiverseLink): string {
  const plain = link.branches.length === 0 && (link.crossings?.length ?? 0) === 0
  return plain ? `#/w/${encodeLink(link)}` : `#/m/${encodeMultiverse(link)}`
}
