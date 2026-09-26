import { describe, expect, it } from 'vitest'
import type { Debt } from '../../engine/debt.ts'
import type { Variable } from '../../engine/state.ts'
import type { Snapshot } from '../../worker/protocol.ts'
import { seamView } from './merge.ts'

function snapshot(
  values: Partial<Record<Variable, number>> = {},
  debts: readonly Debt[] = [],
): Snapshot {
  return {
    tick: 2000,
    values: {
      population: 1_000_000,
      food: 200_000,
      energy: 5,
      technology: 40,
      economy: 6,
      environment: 60,
      stability: 70,
      ...values,
    },
    previous: null,
    eras: 0,
    active: [],
    allocation: { agriculture: 25, industry: 25, research: 25, conservation: 25 },
    status: 'running',
    home: null,
    debts,
  }
}

describe('seamView', () => {
  it('labels population and food as sum, and the five levels as blend', () => {
    const view = seamView(snapshot(), snapshot(), snapshot())
    expect(view.rows).toHaveLength(7)
    const kind = (variable: Variable) => view.rows.find((row) => row.variable === variable)?.kind
    expect(kind('population')).toBe('sum')
    expect(kind('food')).toBe('sum')
    for (const variable of [
      'energy',
      'technology',
      'economy',
      'environment',
      'stability',
    ] as const) {
      expect(kind(variable)).toBe('blend')
    }
  })

  it('never invents a number: every row value comes from one of the three snapshots', () => {
    const now = snapshot({ population: 3_000_000, stability: 80, technology: 90 })
    const incoming = snapshot({ population: 1_000_000, stability: 40, technology: 50 })
    // FEAT: valores arbitrários (não a mistura real) para provar que a linha só lê, nunca calcula
    const seamed = snapshot({ population: 12_345, stability: 6, technology: 78 })
    const view = seamView(now, seamed, incoming)
    for (const row of view.rows) {
      expect(row.now).toBe(now.values[row.variable])
      expect(row.next).toBe(seamed.values[row.variable])
    }
  })

  it('reads the shock the seam charges from the snapshots, not from MERGE_SHOCK', () => {
    const now = snapshot({ population: 3_000_000, stability: 80 })
    const incoming = snapshot({ population: 1_000_000, stability: 40 })
    // FEAT: 70 é a mistura sem abalo (0,75×80 + 0,25×40); 55 é o que a costura realmente cobrou
    const seamed = snapshot({ population: 4_000_000, stability: 55 })
    const view = seamView(now, seamed, incoming)
    expect(view.shock).toBeCloseTo(15)
  })

  it('has no shock when the two histories land exactly on the blended stability', () => {
    const now = snapshot({ population: 1, stability: 80 })
    const incoming = snapshot({ population: 1, stability: 40 })
    const seamed = snapshot({ population: 2, stability: 60 })
    expect(seamView(now, seamed, incoming).shock).toBeCloseTo(0)
  })

  it('settles the debt the two owed each other, as the gap between the two totals and the seamed one', () => {
    const now = snapshot({}, [
      { kind: 'resource', owed: 40, since: 0, origin: 'B' },
      { kind: 'resource', owed: 60, since: 0, origin: 'C' },
    ])
    const incoming = snapshot({}, [
      { kind: 'resource', owed: 25, since: 0, origin: 'A' },
      { kind: 'resource', owed: 10, since: 0, origin: 'C' },
    ])
    // FEAT: só a dívida com C sobrevive à costura; a de A com B era interna e some
    const seamed = snapshot({}, [{ kind: 'resource', owed: 70, since: 0, origin: 'C' }])
    const view = seamView(now, seamed, incoming)
    expect(view.debtIn).toBe(35)
    expect(view.debtSettled).toBe(65)
  })

  it('reports no settlement when nothing the two owed was to each other', () => {
    const now = snapshot({}, [{ kind: 'resource', owed: 60, since: 0, origin: 'C' }])
    const incoming = snapshot({}, [{ kind: 'resource', owed: 10, since: 0, origin: 'C' }])
    const seamed = snapshot({}, [{ kind: 'resource', owed: 70, since: 0, origin: 'C' }])
    const view = seamView(now, seamed, incoming)
    expect(view.debtIn).toBe(10)
    expect(view.debtSettled).toBe(0)
  })
})
