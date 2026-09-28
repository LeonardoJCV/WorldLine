import type { Cause, EventRecord } from '../../engine/events.ts'

type ConditionCause = Extract<Cause, { kind: 'condition' }>
type DecisionCause = Extract<Cause, { kind: 'decision' }>
type CrossingCause = Extract<Cause, { kind: 'crossing' }>
type MergeCause = Extract<Cause, { kind: 'merge' }>
type EventCause = Extract<Cause, { kind: 'event' }>

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
  // FEAT: nomeia a outra história sem apontar nela, igual a crossing
  | (NodeBase & { readonly kind: 'merge'; readonly cause: MergeCause })
  // FEAT: as obras que um acontecimento nomeia, contadas numa linha só; `open` diz se os nós de
  // cada uma estão pendurados nela neste desenho
  | (NodeBase & {
      readonly kind: 'works'
      readonly records: readonly number[]
      readonly open: boolean
    })

export interface CausalTree {
  readonly nodes: readonly CausalNode[]
  readonly depth: number
  readonly rows: number
}

export const MAX_DEPTH = 3

// FEAT: duas obras já são um grupo; uma só continua sendo ela mesma
const FOLD_WORKS = 2

const NONE: ReadonlySet<string> = new Set()

export function buildCausalTree(
  records: readonly EventRecord[],
  root: number,
  maxDepth = MAX_DEPTH,
  expanded: ReadonlySet<string> = NONE,
): CausalTree {
  const nodes: CausalNode[] = []
  let nextRow = 0
  let deepest = 0

  // FEAT: obra se reconhece pelo registro apontado, nunca por `kind` — `work_done` é pulse como a
  // colônia, a herança e a confluência, e dobrar por kind varreria todas para a mesma linha
  const isWork = (cause: Cause): cause is EventCause =>
    cause.kind === 'event' && records[cause.record]?.event === 'work_done'

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

    const works = causes.filter(isWork)
    const group = works.length >= FOLD_WORKS ? `${key}/w` : null
    const at = group === null ? -1 : causes.findIndex(isWork)
    const open = group !== null && expanded.has(group)

    causes.forEach((cause, c) => {
      if (group !== null && isWork(cause)) {
        // FIX: a linha nasce no lugar da primeira obra; as outras já estão contadas nela
        if (c !== at) return
        const inner: number[] = []
        if (open) for (const work of works) inner.push(visit(work.record, depth + 2, group, within))
        const row = open ? ((inner[0] ?? 0) + (inner.at(-1) ?? 0)) / 2 : nextRow++
        deepest = Math.max(deepest, depth + 1)
        const folded = works.map((work) => work.record)
        nodes.push({
          key: group,
          kind: 'works',
          depth: depth + 1,
          row,
          parent: key,
          records: folded,
          open,
        })
        rows.push(row)
        return
      }
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
            : cause.kind === 'crossing'
              ? { ...base, kind: 'crossing', cause }
              : { ...base, kind: 'merge', cause },
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
