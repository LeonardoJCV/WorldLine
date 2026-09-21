import { HORIZON, MAX_SEED } from '../../engine/params.ts'
import { SECTORS, isValidAllocation, type Allocation, type Decision } from '../../engine/state.ts'
import { MAX_WORLDLINES, type BranchSpec } from '../../worker/protocol.ts'

export interface WorldLink {
  readonly version: number
  readonly seed: number
  readonly tick: number
  readonly decisions: readonly Decision[]
}

export interface MultiverseLink extends WorldLink {
  readonly branches: readonly BranchSpec[]
}

const HEADER = 9
const DECISION = 6

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

export function isValidLink(link: WorldLink): boolean {
  if (!Number.isInteger(link.version) || link.version < 0 || link.version > 255) return false
  if (!Number.isInteger(link.seed) || link.seed < 0 || link.seed > MAX_SEED) return false
  if (!Number.isInteger(link.tick) || link.tick < 0 || link.tick > HORIZON) return false
  return validDecisions(link.decisions, 0)
}

export function toMultiverse(link: WorldLink): MultiverseLink {
  return { ...link, branches: [] }
}

export function isValidMultiverse(link: MultiverseLink): boolean {
  if (!isValidLink(link) || !Array.isArray(link.branches)) return false
  if (link.branches.length > MAX_WORLDLINES - 1) return false
  return link.branches.every((branch, i) => {
    if (typeof branch !== 'object' || branch === null) return false
    const { parent, fork, decisions } = branch
    if (!Number.isInteger(parent) || parent < 0 || parent > i) return false
    if (!Number.isInteger(fork) || fork < 0 || fork > link.tick) return false
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

export function encodeMultiverse(link: MultiverseLink): string {
  const size =
    7 +
    2 +
    link.decisions.length * DECISION +
    1 +
    link.branches.reduce((sum, b) => sum + 3 + 2 + b.decisions.length * DECISION, 0)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, link.version)
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
  const branches: BranchSpec[] = []
  for (let i = 0; i < count; i++) {
    if (cursor + 3 > bytes.length) return null
    const parent = view.getUint8(cursor)
    const fork = view.getUint16(cursor + 1)
    const read = readDecisions(view, cursor + 3)
    if (!read) return null
    branches.push({ parent, fork, decisions: read.decisions })
    cursor = read.next
  }
  if (cursor !== bytes.length) return null
  const link: MultiverseLink = {
    version: view.getUint8(0),
    seed: view.getUint32(1),
    tick: view.getUint16(5),
    decisions: root.decisions,
    branches,
  }
  return isValidMultiverse(link) ? link : null
}

export function linkHash(link: MultiverseLink): string {
  return link.branches.length === 0 ? `#/w/${encodeLink(link)}` : `#/m/${encodeMultiverse(link)}`
}
