import { SECTORS, type Allocation, type Decision } from '../../engine/state.ts'
import type { BranchSpec } from '../../worker/protocol.ts'
import { isValidMultiverse, type MultiverseLink } from './link.ts'

export interface WorldFile {
  readonly name: string
  readonly link: MultiverseLink
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
      branches: file.link.branches,
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

function toDecisions(value: unknown): Decision[] | null {
  if (!Array.isArray(value)) return null
  const decisions = value.map(toDecision)
  return decisions.some((decision) => decision === null) ? null : (decisions as Decision[])
}

function toBranch(value: unknown): BranchSpec | null {
  if (!isRecord(value) || typeof value.parent !== 'number' || typeof value.fork !== 'number') {
    return null
  }
  const decisions = toDecisions(value.decisions)
  return decisions === null ? null : { parent: value.parent, fork: value.fork, decisions }
}

function toBranches(value: unknown): BranchSpec[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const branches = value.map(toBranch)
  return branches.some((branch) => branch === null) ? null : (branches as BranchSpec[])
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
  if (typeof data.tick !== 'number') return null
  const decisions = toDecisions(data.decisions)
  if (decisions === null) return null
  const branches = toBranches(data.branches)
  if (branches === null) return null
  const link: MultiverseLink = {
    version: data.version,
    seed: data.seed,
    tick: data.tick,
    decisions,
    branches,
  }
  return isValidMultiverse(link) ? { name: data.name, link } : null
}
