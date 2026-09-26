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
  it('labels food as sum and the true blends as blend, from the numbers alone', () => {
    // FEAT: comida soma (200k+200k=400k); os outros quatro níveis aqui NÃO batem com a soma crua
    const now = snapshot({ energy: 5, technology: 40, economy: 6, environment: 60 })
    const incoming = snapshot({ energy: 5, technology: 40, economy: 6, environment: 60 })
    const seamed = snapshot({
      food: 400_000,
      energy: 4,
      technology: 39,
      economy: 5,
      environment: 61,
    })
    const view = seamView(now, seamed, incoming, 0)
    const kind = (variable: Variable) => view.rows.find((row) => row.variable === variable)?.kind
    expect(kind('food')).toBe('sum')
    for (const variable of ['energy', 'technology', 'economy', 'environment'] as const) {
      expect(kind(variable)).toBe('blend')
    }
  })

  it('labels population as sum when the seam actually summed it (same home)', () => {
    const now = snapshot({ population: 1_000 })
    const incoming = snapshot({ population: 4_000 })
    const seamed = snapshot({ population: 5_000 })
    const view = seamView(now, seamed, incoming, 0)
    expect(view.rows.find((row) => row.variable === 'population')?.kind).toBe('sum')
  })

  // FIX: com lares diferentes mergeStates guarda só a história mais pesada — 1000 e 4000 dão 4000,
  // não 5000 — e um rótulo fixo 'sum' contaria uma história que a costura não viveu
  it('labels population as blend when the seam kept only the heavier side (different homes)', () => {
    const now = snapshot({ population: 1_000 })
    const incoming = snapshot({ population: 4_000 })
    const seamed = snapshot({ population: 4_000 })
    const view = seamView(now, seamed, incoming, 0)
    expect(view.rows.find((row) => row.variable === 'population')?.kind).toBe('blend')
  })

  it('never invents a number: every row value comes from one of the three snapshots', () => {
    const now = snapshot({ population: 3_000_000, stability: 80, technology: 90 })
    const incoming = snapshot({ population: 1_000_000, stability: 40, technology: 50 })
    // FEAT: valores arbitrários (não a mistura real) para provar que a linha só lê, nunca calcula
    const seamed = snapshot({ population: 12_345, stability: 6, technology: 78 })
    const view = seamView(now, seamed, incoming, 0)
    for (const row of view.rows) {
      expect(row.now).toBe(now.values[row.variable])
      expect(row.next).toBe(seamed.values[row.variable])
    }
  })

  // FIX: o abalo chega pronto do hospedeiro; a tela só o repassa, nunca o deriva dos snapshots de novo
  it('reads shock exactly as given, never recomputing it from the snapshots', () => {
    const now = snapshot({ population: 3_000_000, stability: 999 })
    const incoming = snapshot({ population: 1_000_000, stability: -999 })
    const seamed = snapshot({ population: 4_000_000, stability: 55 })
    // FEAT: 42 não bate com nenhuma mistura possível destes números; só um passthrough acerta
    expect(seamView(now, seamed, incoming, 42).shock).toBe(42)
    expect(seamView(now, seamed, incoming, 0).shock).toBe(0)
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
    const view = seamView(now, seamed, incoming, 0)
    expect(view.debtIn).toBe(35)
    expect(view.debtSettled).toBe(65)
  })

  it('reports no settlement when nothing the two owed was to each other', () => {
    const now = snapshot({}, [{ kind: 'resource', owed: 60, since: 0, origin: 'C' }])
    const incoming = snapshot({}, [{ kind: 'resource', owed: 10, since: 0, origin: 'C' }])
    const seamed = snapshot({}, [{ kind: 'resource', owed: 70, since: 0, origin: 'C' }])
    const view = seamView(now, seamed, incoming, 0)
    expect(view.debtIn).toBe(10)
    expect(view.debtSettled).toBe(0)
  })
})
