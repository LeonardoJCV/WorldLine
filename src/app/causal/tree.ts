import type { Cause, EventRecord } from '../../engine/events.ts'

type ConditionCause = Extract<Cause, { kind: 'condition' }>
type DecisionCause = Extract<Cause, { kind: 'decision' }>
type CrossingCause = Extract<Cause, { kind: 'crossing' }>

interface NodeBase {
  readonly key: string
  readonly depth: number
  readonly row: number
  readonly parent: string | null
}

export type CausalNode =
  | (NodeBase & { readonly kind: 'event'; readonly record: number; readonly repeated: boolean })
  | (NodeBase & { readonly kind: 'condition'; readonly cause: ConditionCause })
  | (NodeBase & { readonly kind: 'decision'; readonly cause: DecisionCause })
  | (NodeBase & { readonly kind: 'crossing'; readonly cause: CrossingCause })

export interface CausalTree {
  readonly nodes: readonly CausalNode[]
  readonly depth: number
  readonly rows: number
}

export const MAX_DEPTH = 3

export function buildCausalTree(
  records: readonly EventRecord[],
  root: number,
  maxDepth = MAX_DEPTH,
): CausalTree {
  const nodes: CausalNode[] = []
  let nextRow = 0
  let deepest = 0

  const visit = (
    index: number,
    depth: number,
    parent: string | null,
    path: ReadonlySet<number>,
  ): number => {
    const key = parent === null ? `e${index}` : `${parent}/e${index}`
    const repeated = path.has(index)
    const record = records[index]
    const causes = record && !repeated && depth < maxDepth ? record.causes : []
    const within = new Set(path).add(index)
    const rows: number[] = []
    deepest = Math.max(deepest, depth)

    causes.forEach((cause, c) => {
      if (cause.kind === 'event') {
        rows.push(visit(cause.record, depth + 1, key, within))
        return
      }
      const row = nextRow++
      deepest = Math.max(deepest, depth + 1)
      const base = { key: `${key}/c${c}`, depth: depth + 1, row, parent: key }
      nodes.push(
        cause.kind === 'condition'
          ? { ...base, kind: 'condition', cause }
          : cause.kind === 'decision'
            ? { ...base, kind: 'decision', cause }
            : { ...base, kind: 'crossing', cause },
      )
      rows.push(row)
    })

    const row = rows.length === 0 ? nextRow++ : ((rows[0] ?? 0) + (rows.at(-1) ?? 0)) / 2
    nodes.push({ key, kind: 'event', record: index, depth, row, parent, repeated })
    return row
  }

  visit(root, 0, null, new Set())
  return { nodes, depth: deepest, rows: nextRow }
}
