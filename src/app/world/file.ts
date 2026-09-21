import { SECTORS, type Allocation, type Decision } from '../../engine/state.ts'
import { isValidLink, type WorldLink } from './link.ts'

export interface WorldFile {
  readonly name: string
  readonly link: WorldLink
}

export function serializeWorld(file: WorldFile): string {
  return JSON.stringify(
    {
      format: 'worldline',
      version: file.link.version,
      name: file.name,
      seed: file.link.seed,
      tick: file.link.tick,
      decisions: file.link.decisions,
    },
    null,
    2,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toDecision(value: unknown): Decision | null {
  if (!isRecord(value) || typeof value.tick !== 'number' || !isRecord(value.allocation)) return null
  const allocation = {} as Record<(typeof SECTORS)[number], number>
  for (const sector of SECTORS) {
    const share = value.allocation[sector]
    if (typeof share !== 'number') return null
    allocation[sector] = share
  }
  return { tick: value.tick, allocation: allocation as Allocation }
}

export function parseWorldFile(text: string): WorldFile | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(data) || data.format !== 'worldline' || typeof data.name !== 'string') return null
  if (typeof data.version !== 'number' || typeof data.seed !== 'number') return null
  if (typeof data.tick !== 'number' || !Array.isArray(data.decisions)) return null
  const decisions = data.decisions.map(toDecision)
  if (decisions.some((decision) => decision === null)) return null
  const link: WorldLink = {
    version: data.version,
    seed: data.seed,
    tick: data.tick,
    decisions: decisions.filter((decision): decision is Decision => decision !== null),
  }
  return isValidLink(link) ? { name: data.name, link } : null
}
