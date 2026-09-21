import { HORIZON, MAX_SEED } from '../../engine/params.ts'
import { SECTORS, isValidAllocation, type Allocation, type Decision } from '../../engine/state.ts'

export interface WorldLink {
  readonly version: number
  readonly seed: number
  readonly tick: number
  readonly decisions: readonly Decision[]
}

const HEADER = 9
const DECISION = 6

export function isValidLink(link: WorldLink): boolean {
  if (!Number.isInteger(link.version) || link.version < 0 || link.version > 255) return false
  if (!Number.isInteger(link.seed) || link.seed < 0 || link.seed > MAX_SEED) return false
  if (!Number.isInteger(link.tick) || link.tick < 0 || link.tick > HORIZON) return false
  let previous = -1
  for (const decision of link.decisions) {
    if (!Number.isInteger(decision.tick) || decision.tick <= previous || decision.tick >= HORIZON) {
      return false
    }
    if (!isValidAllocation(decision.allocation)) return false
    previous = decision.tick
  }
  return true
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

export function linkHash(link: WorldLink): string {
  return `#/w/${encodeLink(link)}`
}
