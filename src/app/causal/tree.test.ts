import { describe, expect, it } from 'vitest'
import type { Cause, EventId, EventRecord, Metric } from '../../engine/events.ts'
import { MAX_DEPTH, buildCausalTree, type CausalNode } from './tree.ts'

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

  it('traces a collapse back through the still-active paradox to the crossing that named it', () => {
    // FEAT: espelha o que o motor grava de verdade (events.test.ts, "paradox and collapse")
    const records = [
      record('paradox', 90, [
        condition('paradoxActive', 1),
        { kind: 'crossing', tick: 5, crossing: 'resource' },
      ]),
      record('collapse', 290, [{ kind: 'event', record: 0 }]),
    ]
    const tree = buildCausalTree(records, 1)
    const crossing = tree.nodes.find((n) => n.kind === 'crossing')
    expect(crossing).toMatchObject({ cause: { tick: 5, crossing: 'resource' } })
    const paradox = tree.nodes.find((n) => n.kind === 'event' && n.record === 0)
    expect(paradox?.parent).toBe('e1')
    expect(crossing?.parent).toBe(paradox?.key)
  })

  it('tolerates causes that point to missing records', () => {
    const tree = buildCausalTree([record('famine', 40, [{ kind: 'event', record: 99 }])], 0)
    expect(tree.nodes.filter((n) => n.kind === 'event')).toHaveLength(2)
  })

  it('traces an inheritance back through the founding to the space age that opened it', () => {
    // FEAT: espelha o que o motor grava de verdade (worldline.test.ts, "writes the moment down once")
    const records = [
      record('space_era', 1802, [
        condition('technology', 91),
        condition('energy', 13),
        condition('economy', 9),
      ]),
      record('colony_founded', 1803, [{ kind: 'event', record: 0 }]),
      record('collapse', 2283, [condition('paradoxOverdue', 1)]),
      record('inheritance', 2283, [
        { kind: 'event', record: 2 },
        { kind: 'event', record: 1 },
      ]),
    ]
    const tree = buildCausalTree(records, 3)
    const founding = tree.nodes.find((n) => n.kind === 'event' && n.record === 1)
    expect(founding).toMatchObject({ depth: 1, parent: 'e3' })
    const era = tree.nodes.find((n) => n.kind === 'event' && n.record === 0)
    expect(era).toMatchObject({ depth: 2, parent: founding?.key })
    const gates = tree.nodes.filter((n) => n.kind === 'condition' && n.parent === era?.key)
    expect(gates).toHaveLength(3)
    expect(gates.every((n) => n.depth === 3)).toBe(true)
  })
})

// FEAT: o corte das obras — o motor não ordena causas, então a interface conta em vez de escolher
describe('folding the works a card names', () => {
  const work = (start: number) => record('work_done', start)
  const group = (tree: { nodes: readonly CausalNode[] }) =>
    tree.nodes.find((n): n is Extract<CausalNode, { kind: 'works' }> => n.kind === 'works')

  it('folds two or more works into one line that says how many', () => {
    const records = [
      work(10),
      work(20),
      record('space_era', 30, [
        condition('technology', 91),
        { kind: 'event', record: 0 },
        { kind: 'event', record: 1 },
      ]),
    ]
    const shut = buildCausalTree(records, 2)
    expect(group(shut)).toMatchObject({ depth: 1, parent: 'e2', open: false, records: [0, 1] })
    expect(shut.nodes.filter((n) => n.kind === 'event')).toHaveLength(1)
    expect(shut.nodes).toHaveLength(3)

    const wide = buildCausalTree(records, 2, MAX_DEPTH, new Set(['e2/w']))
    expect(group(wide)).toMatchObject({ depth: 1, parent: 'e2', open: true, records: [0, 1] })
    const hung = wide.nodes.filter((n) => n.parent === 'e2/w')
    expect(hung.map((n) => [n.kind, n.depth])).toEqual([
      ['event', 2],
      ['event', 2],
    ])
    expect(hung.map((n) => (n.kind === 'event' ? n.record : null))).toEqual([0, 1])
  })

  it('leaves a single work as its own node, because a group of one is a lie', () => {
    const records = [
      work(10),
      record('space_era', 30, [condition('technology', 91), { kind: 'event', record: 0 }]),
    ]
    const tree = buildCausalTree(records, 1)
    expect(group(tree)).toBeUndefined()
    expect(tree.nodes.find((n) => n.kind === 'event' && n.record === 0)).toMatchObject({
      depth: 1,
      parent: 'e1',
      row: 1,
    })
    expect(tree.rows).toBe(2)
  })

  it('never folds a condition, an event or a decision', () => {
    // FEAT: os seis outros pulses entram como causa-evento, cada um pelo nome que o registro tem —
    // é o que distingue dobrar `work_done` de dobrar a família inteira, `merge` e herança incluídas
    const PULSES = [
      'colony_founded',
      'colony_lost',
      'inheritance',
      'merge',
      'merged_away',
      'debt_settled',
    ] as const
    const records = [
      work(10),
      work(20),
      ...PULSES.map((event, i) => record(event, 25 + i)),
      record('space_era', 50, [
        condition('technology', 91),
        condition('energy', 13),
        ...PULSES.map((_, i) => ({ kind: 'event', record: 2 + i }) as const),
        { kind: 'event', record: 0 },
        { kind: 'event', record: 1 },
        { kind: 'decision', tick: 45, sectors: ['research'] },
        { kind: 'crossing', tick: 40, crossing: 'knowledge' },
        { kind: 'merge', tick: 48, other: 'B' },
      ]),
    ]
    const tree = buildCausalTree(records, records.length - 1)
    expect(tree.nodes.filter((n) => n.kind === 'works')).toHaveLength(1)
    expect(group(tree)?.records).toEqual([0, 1])
    expect(
      tree.nodes.filter((n) => n.kind === 'event').map((n) => records[n.record]?.event),
    ).toEqual([...PULSES, 'space_era'])
    expect(tree.nodes.filter((n) => n.kind === 'condition')).toHaveLength(2)
    expect(tree.nodes.filter((n) => n.kind === 'decision')).toHaveLength(1)
    expect(tree.nodes.filter((n) => n.kind === 'crossing')).toHaveLength(1)
    expect(tree.nodes.filter((n) => n.kind === 'merge')).toHaveLength(1)
  })

  it('never folds where the line could not open, and never draws past the depth limit', () => {
    const records = [
      work(10),
      work(20),
      record('space_era', 30, [
        { kind: 'event', record: 0 },
        { kind: 'event', record: 1 },
      ]),
      record('recession', 40, [{ kind: 'event', record: 2 }]),
      record('famine', 50, [{ kind: 'event', record: 3 }]),
    ]
    // FEAT: o grupo pede a coluna seguinte para as obras, então ele só existe onde ela existe
    const mid = buildCausalTree(records, 3)
    expect(group(mid)).toMatchObject({ depth: 2, open: false })
    const key = group(mid)?.key ?? ''
    const wide = buildCausalTree(records, 3, MAX_DEPTH, new Set([key]))
    expect(wide.nodes.filter((n) => n.parent === key).map((n) => n.depth)).toEqual([3, 3])
    expect(wide.depth).toBe(MAX_DEPTH)
    expect(wide.nodes.every((n) => n.depth <= MAX_DEPTH)).toBe(true)

    // FEAT: na última coluna as obras seguem nós próprios, com nome — nada some por causa da dobra
    const deep = buildCausalTree(records, 4)
    expect(group(deep)).toBeUndefined()
    expect(
      deep.nodes.flatMap((n) => (n.kind === 'event' && n.depth === MAX_DEPTH ? [n.record] : [])),
    ).toEqual([0, 1])
    expect(deep.nodes.every((n) => n.depth <= MAX_DEPTH)).toBe(true)
  })

  it('keeps the row arithmetic sound when a group replaces several siblings', () => {
    const records = [
      work(10),
      work(20),
      work(30),
      record('space_era', 50, [
        condition('technology', 91),
        { kind: 'event', record: 0 },
        { kind: 'event', record: 1 },
        { kind: 'event', record: 2 },
        condition('energy', 13),
      ]),
    ]
    // FEAT: as três obras ocupavam três linhas; dobradas ocupam uma, e é essa que o pai usa de ponta
    const shut = buildCausalTree(records, 3)
    expect(shut.rows).toBe(3)
    expect(group(shut)?.row).toBe(1)
    expect(shut.nodes.filter((n) => n.kind === 'condition').map((n) => n.row)).toEqual([0, 2])
    expect(shut.nodes.find((n) => n.depth === 0)?.row).toBe(1)

    const wide = buildCausalTree(records, 3, MAX_DEPTH, new Set(['e3/w']))
    expect(wide.rows).toBe(5)
    expect(wide.nodes.filter((n) => n.parent === 'e3/w').map((n) => n.row)).toEqual([1, 2, 3])
    expect(group(wide)?.row).toBe(2)
    expect(wide.nodes.filter((n) => n.kind === 'condition').map((n) => n.row)).toEqual([0, 4])
    expect(wide.nodes.find((n) => n.depth === 0)?.row).toBe(2)

    // FEAT: a conta só fecha se cada linha inteira for de um nó folha e nenhuma sobrar ou repetir —
    // é o que pega uma dobra que esquece de reservar a linha do grupo, ou que reserva duas
    for (const tree of [shut, wide]) {
      const keys = new Set(tree.nodes.map((n) => n.parent))
      const leaves = tree.nodes.filter((n) => !keys.has(n.key)).map((n) => n.row)
      expect(leaves.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: tree.rows }, (_, i) => i),
      )
    }
  })
})
