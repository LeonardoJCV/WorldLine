import type { Crossing, CrossingKind, Dose } from '../../engine/crossing.ts'
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
      crossings: file.link.crossings ?? [],
      branches: file.link.branches,
    },
    null,
    2,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toAllocation(value: unknown): Allocation | null {
  if (!isRecord(value)) return null
  const allocation = {} as Record<(typeof SECTORS)[number], number>
  for (const sector of SECTORS) {
    const share = value[sector]
    if (typeof share !== 'number') return null
    allocation[sector] = share
  }
  return allocation as Allocation
}

function toDecision(value: unknown): Decision | null {
  if (!isRecord(value) || typeof value.tick !== 'number') return null
  const allocation = toAllocation(value.allocation)
  return allocation === null ? null : { tick: value.tick, allocation }
}

function toCrossing(value: unknown): Crossing | null {
  if (!isRecord(value) || typeof value.tick !== 'number' || typeof value.kind !== 'string') {
    return null
  }
  if (typeof value.dose !== 'number' || typeof value.cost !== 'number') return null
  if (value.direction !== 'in' && value.direction !== 'out') return null
  if (!isRecord(value.origin) || typeof value.origin.world !== 'string') return null
  if (typeof value.origin.tick !== 'number') return null
  if (!Array.isArray(value.amounts) || value.amounts.some((a) => typeof a !== 'number')) return null
  const allocation = value.allocation === undefined ? null : toAllocation(value.allocation)
  if (value.allocation !== undefined && allocation === null) return null
  return {
    tick: value.tick,
    kind: value.kind as CrossingKind,
    dose: value.dose as Dose,
    amounts: value.amounts as number[],
    origin: { world: value.origin.world, tick: value.origin.tick },
    cost: value.cost,
    direction: value.direction,
    ...(allocation === null ? {} : { allocation }),
  }
}

function toCrossings(value: unknown): Crossing[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const crossings = value.map(toCrossing)
  return crossings.some((crossing) => crossing === null) ? null : (crossings as Crossing[])
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
  const crossings = toCrossings(value.crossings)
  if (decisions === null || crossings === null) return null
  return { parent: value.parent, fork: value.fork, decisions, crossings }
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
  const crossings = toCrossings(data.crossings)
  if (crossings === null) return null
  const branches = toBranches(data.branches)
  if (branches === null) return null
  const link: MultiverseLink = {
    version: data.version,
    seed: data.seed,
    tick: data.tick,
    decisions,
    crossings,
    branches,
  }
  return isValidMultiverse(link) ? { name: data.name, link } : null
}
