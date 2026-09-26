import { describe, expect, it } from 'vitest'
import { totalOwed, type Debt } from '../../engine/debt.ts'
import type { Status, Variable } from '../../engine/state.ts'
import type { Snapshot, WorldlineId } from '../../worker/protocol.ts'
import { homeChange, mergeBlock, mergePartners, seamView, type MergeBlockInput } from './merge.ts'

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

// FEAT: as duas que se costuram; dívida com qualquer uma delas é interna, e interna não é dívida
const PAIR: readonly [string, string] = ['A', 'B']

function living(tick = 2000, status: Status = 'running'): Snapshot {
  return { ...snapshot(), tick, status }
}

function world(id: WorldlineId, present: Snapshot) {
  return { info: { id }, present }
}

function blockInput(overrides: Partial<MergeBlockInput> = {}): MergeBlockInput {
  return {
    worlds: 2,
    partners: 1,
    survivor: 'A',
    survivorEnded: false,
    survivorSeam: null,
    other: 'B',
    otherTick: 2000,
    otherSeam: null,
    now: 2000,
    playing: false,
    ready: true,
    ...overrides,
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
    const view = seamView(now, seamed, incoming, 0, PAIR)
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
    const view = seamView(now, seamed, incoming, 0, PAIR)
    expect(view.rows.find((row) => row.variable === 'population')?.kind).toBe('sum')
  })

  // FIX: com lares diferentes mergeStates guarda só a história mais pesada — 1000 e 4000 dão 4000,
  // não 5000 — e um rótulo fixo 'sum' contaria uma história que a costura não viveu
  it('labels population as blend when the seam kept only the heavier side (different homes)', () => {
    const now = snapshot({ population: 1_000 })
    const incoming = snapshot({ population: 4_000 })
    const seamed = snapshot({ population: 4_000 })
    const view = seamView(now, seamed, incoming, 0, PAIR)
    expect(view.rows.find((row) => row.variable === 'population')?.kind).toBe('blend')
  })

  it('never invents a number: every row value comes from one of the three snapshots', () => {
    const now = snapshot({ population: 3_000_000, stability: 80, technology: 90 })
    const incoming = snapshot({ population: 1_000_000, stability: 40, technology: 50 })
    // FEAT: valores arbitrários (não a mistura real) para provar que a linha só lê, nunca calcula
    const seamed = snapshot({ population: 12_345, stability: 6, technology: 78 })
    const view = seamView(now, seamed, incoming, 0, PAIR)
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
    expect(seamView(now, seamed, incoming, 42, PAIR).shock).toBe(42)
    expect(seamView(now, seamed, incoming, 0, PAIR).shock).toBe(0)
  })

  // FIX: dos 35 que a outra devia, 25 eram à sobrevivente e se anulam; só 10 chegam de verdade
  it('counts as incoming only the debt that survives the seam, and as settled what annihilates', () => {
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
    const view = seamView(now, seamed, incoming, 0, PAIR)
    expect(view.debtIn).toBe(10)
    expect(view.debtSettled).toBe(65)
    // FEAT: o que chega mais o que a sobrevivente guarda é o total da história unida
    expect(totalOwed(seamed.debts)).toBe(60 + view.debtIn)
  })

  it('reports no settlement, and the whole incoming debt, when neither owed the other', () => {
    const now = snapshot({}, [{ kind: 'resource', owed: 60, since: 0, origin: 'C' }])
    const incoming = snapshot({}, [{ kind: 'resource', owed: 10, since: 0, origin: 'C' }])
    const seamed = snapshot({}, [{ kind: 'resource', owed: 70, since: 0, origin: 'C' }])
    const view = seamView(now, seamed, incoming, 0, PAIR)
    expect(view.debtIn).toBe(10)
    expect(view.debtSettled).toBe(0)
  })
})

describe('mergePartners', () => {
  it('drops the survivor itself and every history that has ended', () => {
    const worlds = [
      world('A', living()),
      world('B', living(1200, 'extinct')),
      world('C', living(1800, 'merged')),
      world('D', living()),
    ]
    expect(mergePartners(worlds, 'A').map((candidate) => candidate.info.id)).toEqual(['D'])
  })

  it('leaves nothing to choose when the only other history already flowed away', () => {
    expect(mergePartners([world('A', living()), world('B', living(1800, 'merged'))], 'A')).toEqual(
      [],
    )
  })
})

describe('mergeBlock', () => {
  it('lets the seam through when there is a living partner, the years match and the preview landed', () => {
    expect(mergeBlock(blockInput())).toBeNull()
  })

  it('says a single history has no one to merge with, before anything else', () => {
    // FEAT: com uma worldline só, nem parceira nem prévia existem; a recusa tem de ser a do sozinho
    expect(mergeBlock(blockInput({ worlds: 1, partners: 0, other: null, ready: false }))).toEqual({
      key: 'merge.alone',
      params: {},
    })
  })

  it('says there is no living history left when every other one has ended', () => {
    expect(mergeBlock(blockInput({ partners: 0, other: null, ready: false }))).toEqual({
      key: 'merge.none',
      params: {},
    })
  })

  it('asks for a choice while none is made, even with a partner available', () => {
    expect(mergeBlock(blockInput({ other: null, ready: false }))).toEqual({
      key: 'merge.pick',
      params: {},
    })
  })

  // FIX: a costura só existe no presente das duas; o hospedeiro recusa dois anos diferentes, e o painel diz por quê
  it('names the history that is not in the present year, including when its year is unknown', () => {
    expect(mergeBlock(blockInput({ otherTick: 1900 }))).toEqual({
      key: 'merge.notNow',
      params: { other: 'B' },
    })
    expect(mergeBlock(blockInput({ otherTick: null }))).toEqual({
      key: 'merge.notNow',
      params: { other: 'B' },
    })
  })

  it('asks for the years to stop before showing a seam that changes with each of them', () => {
    expect(mergeBlock(blockInput({ playing: true }))).toEqual({
      key: 'merge.playing',
      params: {},
    })
  })

  it('waits for the preview instead of offering a seam it cannot show yet', () => {
    expect(mergeBlock(blockInput({ ready: false }))).toEqual({
      key: 'merge.loading',
      params: {},
    })
  })

  // FIX: o foco pode ser uma história morta, e nada deságua numa que terminou
  it('says the survivor itself has ended before asking anything of the others', () => {
    expect(
      mergeBlock(blockInput({ survivorEnded: true, partners: 0, other: null, ready: false })),
    ).toEqual({ key: 'merge.ended', params: {} })
    expect(mergeBlock(blockInput({ survivorEnded: true }))).toEqual({
      key: 'merge.ended',
      params: {},
    })
  })

  // FIX: o hospedeiro recusa a segunda costura do ano dos DOIS lados; o painel diz de qual delas se trata
  it('names the side that already took a confluence this year, on either side of the seam', () => {
    expect(mergeBlock(blockInput({ survivorSeam: 2000 }))).toEqual({
      key: 'merge.once',
      params: { id: 'A', year: '2000' },
    })
    expect(mergeBlock(blockInput({ otherSeam: 2000 }))).toEqual({
      key: 'merge.once',
      params: { id: 'B', year: '2000' },
    })
  })

  it('lets a seam of an earlier year be followed by another one, in another year', () => {
    expect(mergeBlock(blockInput({ survivorSeam: 1999, otherSeam: 1900 }))).toBeNull()
  })
})

describe('homeChange', () => {
  it('says nothing when both histories already live on the same body', () => {
    expect(homeChange(0, 0, 0)).toBeNull()
  })

  // FEAT: quem fica com o lar vem do snapshot costurado; o outro lar é o que vira colônia
  it('reads the surviving home from the seam, not from which side asked for it', () => {
    expect(homeChange(0, 3, 0)).toEqual({ body: 0, left: 3 })
    expect(homeChange(0, 3, 3)).toEqual({ body: 3, left: 0 })
  })
})
