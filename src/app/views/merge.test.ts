import { describe, expect, it } from 'vitest'
import type { Debt } from '../../engine/debt.ts'
import type { EventRecord } from '../../engine/events.ts'
import type { Merge } from '../../engine/merge.ts'
import type { Status, Variable } from '../../engine/state.ts'
import type { SeamPreview, Snapshot, WorldlineId } from '../../worker/protocol.ts'
import {
  confluenceView,
  homeChange,
  lastConfluence,
  mergeBlock,
  mergePartners,
  previewForYear,
  seamView,
  seamedRemoval,
  type MergeBlockInput,
  type SeamedWorld,
} from './merge.ts'

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

// FEAT: a resposta do hospedeiro: o estado previsto e os quatro números que só o motor sabe fazer
function preview(
  seamed: Snapshot,
  numbers: Partial<Omit<SeamPreview, 'seamed'>> = {},
): SeamPreview {
  return {
    seamed,
    shock: 0,
    food: { now: 0, next: 0 },
    debtIn: 0,
    debtSettled: 0,
    ...numbers,
  }
}

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
    const view = seamView(now, incoming, preview(seamed))
    const kind = (variable: Variable) => view.rows.find((row) => row.variable === variable)?.kind
    expect(kind('food')).toBe('sum')
    for (const variable of ['energy', 'technology', 'economy', 'environment'] as const) {
      expect(kind(variable)).toBe('blend')
    }
  })

  it('labels population as sum when the seam actually summed it (same home)', () => {
    const now = snapshot({ population: 1_000 })
    const incoming = snapshot({ population: 4_000 })
    const view = seamView(now, incoming, preview(snapshot({ population: 5_000 })))
    expect(view.rows.find((row) => row.variable === 'population')?.kind).toBe('sum')
  })

  // FIX: com lares diferentes mergeStates guarda só a história mais pesada — 1000 e 4000 dão 4000,
  // não 5000 — e um rótulo fixo 'sum' contaria uma história que a costura não viveu
  it('labels population as blend when the seam kept only the heavier side (different homes)', () => {
    const now = snapshot({ population: 1_000 })
    const incoming = snapshot({ population: 4_000 })
    const view = seamView(now, incoming, preview(snapshot({ population: 4_000 })))
    expect(view.rows.find((row) => row.variable === 'population')?.kind).toBe('blend')
  })

  it('never invents a number: every row value comes from one of the three snapshots', () => {
    const now = snapshot({ population: 3_000_000, stability: 80, technology: 90 })
    const incoming = snapshot({ population: 1_000_000, stability: 40, technology: 50 })
    // FEAT: valores arbitrários (não a mistura real) para provar que a linha só lê, nunca calcula
    const seamed = snapshot({ population: 12_345, stability: 6, technology: 78 })
    const view = seamView(now, incoming, preview(seamed))
    for (const row of view.rows) {
      expect(row.now).toBe(now.values[row.variable])
      expect(row.next).toBe(seamed.values[row.variable])
    }
  })

  // FIX: os quatro números chegam prontos do hospedeiro; a tela só os repassa, e nenhum deles se
  // deriva outra vez dos snapshots — nem o abalo, nem a comida, nem as duas contas de dívida
  it('reads shock, food and debt exactly as given, never recomputing any of them', () => {
    const now = snapshot({ population: 3_000_000, stability: 999 }, [
      { kind: 'resource', owed: 40, since: 0, origin: 'B' },
      { kind: 'resource', owed: 60, since: 0, origin: 'C' },
    ])
    const incoming = snapshot({ population: 1_000_000, stability: -999 }, [
      { kind: 'resource', owed: 25, since: 0, origin: 'A' },
      { kind: 'resource', owed: 10, since: 0, origin: 'C' },
    ])
    const seamed = snapshot({ population: 4_000_000, stability: 55 }, [
      { kind: 'resource', owed: 70, since: 0, origin: 'C' },
    ])
    // FEAT: nenhum destes números bate com conta alguma sobre os três livros-razão acima (que dariam
    // 10 e 65); só um passthrough acerta os quatro
    const view = seamView(
      now,
      incoming,
      preview(seamed, {
        shock: 42,
        food: { now: 1.31, next: 0.64 },
        debtIn: 777,
        debtSettled: 888,
      }),
    )
    expect(view.shock).toBe(42)
    expect(view.food).toEqual({ now: 1.31, next: 0.64 })
    expect(view.debtIn).toBe(777)
    expect(view.debtSettled).toBe(888)
    expect(seamView(now, incoming, preview(seamed)).shock).toBe(0)
  })
})

// FIX: nada repõe a prévia depois de a costura mudar, então mostrar a do ano passado como se fosse
// a de agora seria a tela prometendo números de uma costura que já não é esta
describe('previewForYear', () => {
  it('keeps the preview of the present year and drops every other one', () => {
    const seam = preview(snapshot())
    expect(seam.seamed.tick).toBe(2000)
    expect(previewForYear(seam, 2000)).toBe(seam)
    expect(previewForYear(seam, 2001)).toBeNull()
    expect(previewForYear(seam, 1999)).toBeNull()
    expect(previewForYear(null, 2000)).toBeNull()
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

function record(event: EventRecord['event'], start: number, other: string | null): EventRecord {
  return {
    event,
    start,
    end: null,
    causes: other === null ? [] : [{ kind: 'merge', tick: start, other }],
  }
}

describe('lastConfluence', () => {
  it('finds nothing in a history that never took one', () => {
    expect(lastConfluence([])).toBeNull()
    expect(lastConfluence([record('famine', 100, null)])).toBeNull()
  })

  // FIX: o deságue é o registro da OUTRA ponta; anunciar por ele diria que esta história se uniu
  it('ignores the record of a history that flowed away', () => {
    expect(lastConfluence([record('merged_away', 100, 'B')])).toBeNull()
  })

  it('keeps the latest of several confluences', () => {
    const events = [record('merge', 100, 'B'), record('merge', 400, 'C'), record('merge', 200, 'D')]
    expect(lastConfluence(events)?.start).toBe(400)
  })
})

describe('confluenceView', () => {
  it('reads the year, the other history and the people from the record and the state', () => {
    expect(confluenceView(record('merge', 1450, 'C'), 'A', 2_500_000)).toEqual({
      year: 1450,
      other: 'C',
      survivor: 'A',
      people: 2_500_000,
    })
  })

  // FIX: sem a causa não há nome para dizer, e meia frase é pior que silêncio
  it('says nothing about a record that names no other history', () => {
    expect(confluenceView(record('merge', 1450, null), 'A', 10)).toBeNull()
  })
})

describe('seamedRemoval', () => {
  const seam = (other: string): Merge => ({
    tick: 2000,
    self: 'A',
    other,
    direction: 'in',
    natal: 3,
  })
  const line = (
    id: WorldlineId,
    parent: WorldlineId | null,
    merges: readonly Merge[] = [],
  ): SeamedWorld => ({ info: { id, parent, fork: 0, generation: parent === null ? 0 : 1 }, merges })

  it('lets go of a history no confluence ever named', () => {
    expect(seamedRemoval([line('A', null), line('B', 'A')], 'B')).toBeNull()
  })

  it('names the history that carries the one being removed', () => {
    expect(seamedRemoval([line('A', null, [seam('B')]), line('B', 'A')], 'B')).toEqual({
      gone: 'B',
      keeper: 'A',
    })
  })

  // FIX: remover leva as filhas junto, e uma filha pode ser a que outra história absorveu
  it('refuses when the confluence named a descendant of the one being removed', () => {
    const worlds = [line('A', null, [seam('C')]), line('B', 'A'), line('C', 'B')]
    expect(seamedRemoval(worlds, 'B')).toEqual({ gone: 'C', keeper: 'A' })
  })

  // FEAT: a costura que a própria condenada carrega morre com ela, e não impede nada
  it('ignores a seam written inside the history that is going away', () => {
    expect(seamedRemoval([line('A', null), line('B', 'A', [seam('A')])], 'B')).toBeNull()
  })
})
