import { describe, expect, it } from 'vitest'
import type { Cause, EventId, EventRecord, Metric } from '../../engine/events.ts'
import { MAX_DEPTH, buildCausalTree } from './tree.ts'

function record(event: EventId, start: number, causes: Cause[] = []): EventRecord {
  return { event, start, end: null, causes }
}

const condition = (metric: Metric, value: number): Cause => ({
  kind: 'condition',
  metric,
  op: '<',
  threshold: 1,
  value,
})

describe('buildCausalTree', () => {
  it('places the event at depth 0 and its conditions one column to the left', () => {
    const tree = buildCausalTree(
      [record('famine', 10, [condition('foodSecurity', 0.8), condition('population', 5)])],
      0,
    )
    expect(tree.nodes.find((n) => n.key === 'e0')).toMatchObject({
      kind: 'event',
      depth: 0,
      row: 0.5,
    })
    expect(tree.nodes.filter((n) => n.kind === 'condition').map((n) => [n.depth, n.row])).toEqual([
      [1, 0],
      [1, 1],
    ])
    expect(tree.depth).toBe(1)
    expect(tree.rows).toBe(2)
  })

  it('follows event causes up to the depth limit', () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      record('recession', i * 10, i === 0 ? [] : [{ kind: 'event', record: i - 1 }]),
    )
    const tree = buildCausalTree(records, 5)
    expect(tree.depth).toBe(MAX_DEPTH)
    expect(tree.nodes.every((n) => n.depth <= MAX_DEPTH)).toBe(true)
    expect(tree.nodes.filter((n) => n.kind === 'event')).toHaveLength(MAX_DEPTH + 1)
  })

  it('marks events already on the path instead of looping', () => {
    const records = [
      record('famine', 10, [{ kind: 'event', record: 1 }]),
      record('civil_unrest', 12, [{ kind: 'event', record: 0 }]),
    ]
    const tree = buildCausalTree(records, 0)
    expect(tree.nodes).toHaveLength(3)
    expect(tree.nodes.filter((n) => n.kind === 'event' && n.repeated)).toHaveLength(1)
  })

  it('shows decisions as leaves', () => {
    const tree = buildCausalTree(
      [record('famine', 40, [{ kind: 'decision', tick: 30, sectors: ['agriculture'] }])],
      0,
    )
    expect(tree.nodes.find((n) => n.kind === 'decision')).toMatchObject({ depth: 1, row: 0 })
  })

  it('shows a crossing as a leaf in the order it was recorded', () => {
    const tree = buildCausalTree(
      [
        record('famine', 40, [
          { kind: 'crossing', tick: 30, crossing: 'resource' },
          condition('foodSecurity', 0.8),
        ]),
      ],
      0,
    )
    expect(tree.nodes).toHaveLength(3)
    expect(tree.nodes.find((n) => n.kind === 'crossing')).toMatchObject({
      depth: 1,
      row: 0,
      parent: 'e0',
      cause: { tick: 30, crossing: 'resource' },
    })
    expect(tree.nodes.find((n) => n.kind === 'condition')).toMatchObject({ depth: 1, row: 1 })
  })

  it('keeps a crossing under the event it caused, inside the depth limit', () => {
    const records = [
      record('famine', 40, [{ kind: 'crossing', tick: 30, crossing: 'resource' }]),
      record('civil_unrest', 60, [{ kind: 'event', record: 0 }]),
    ]
    const tree = buildCausalTree(records, 1, 1)
    expect(tree.nodes.filter((n) => n.kind === 'crossing')).toHaveLength(0)
    expect(buildCausalTree(records, 1).nodes.find((n) => n.kind === 'crossing')).toMatchObject({
      depth: 2,
      parent: 'e1/e0',
    })
  })

  it('tolerates causes that point to missing records', () => {
    const tree = buildCausalTree([record('famine', 40, [{ kind: 'event', record: 99 }])], 0)
    expect(tree.nodes.filter((n) => n.kind === 'event')).toHaveLength(2)
  })
})
