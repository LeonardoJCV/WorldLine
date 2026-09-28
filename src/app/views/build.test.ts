import { describe, expect, it } from 'vitest'
import { Era } from '../../engine/state.ts'
import {
  PRESENTATION_ORDER,
  TERM_KEYS,
  WORKS,
  isCommissionable,
  workIndex,
  type Work,
  type WorkId,
} from '../../engine/work.ts'
import type { Snapshot } from '../../worker/protocol.ts'
import { buildGroups, buildView, effectsOf, siteProgress, type WorkRow } from './build.ts'

function standing(...ids: readonly WorkId[]): readonly Work[] {
  return ids.map((id, at) => ({ def: workIndex(id), done: 100 + at, record: at }))
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 1000,
    values: {
      population: 1_000_000,
      food: 200_000,
      energy: 5,
      technology: 40,
      economy: 6,
      environment: 60,
      stability: 70,
    },
    previous: null,
    eras: Era.agricultural,
    active: [],
    allocation: { agriculture: 25, industry: 20, research: 25, conservation: 25, works: 5 },
    status: 'running',
    home: null,
    debts: [],
    works: [],
    building: null,
    rate: 0,
    ...over,
  }
}

function rowFor(rows: readonly WorkRow[], id: WorkId): WorkRow {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) throw new Error(`no row for ${id}`)
  return row
}

describe('buildView', () => {
  it('orders the catalogue the way the engine says to present it', () => {
    const defs = buildView(snapshot()).map((row) => row.def)
    expect(defs).toEqual([...PRESENTATION_ORDER])
    // FEAT: sem isto a asserção acima passaria mesmo se apresentar fosse percorrer WORKS na ordem
    // de armazenamento, que é justo o que a ordem do motor existe para não ser
    expect(defs).not.toEqual(WORKS.map((_, at) => at))
    expect(defs).toHaveLength(WORKS.length)
  })

  it('marks a work done, one on the site, one open and one still locked', () => {
    const rows = buildView(
      snapshot({
        works: standing('irrigation'),
        building: { def: workIndex('plough'), progress: 100, since: 900 },
      }),
    )
    expect(rowFor(rows, 'irrigation').state).toBe('done')
    expect(rowFor(rows, 'plough').state).toBe('building')
    expect(rowFor(rows, 'granary').state).toBe('open')
    expect(rowFor(rows, 'writing').state).toBe('locked')
  })

  it('names exactly which prerequisites a locked work is missing', () => {
    const both = buildView(snapshot({ eras: Era.space }))
    expect(rowFor(both, 'reactor').missing).toEqual(['electrification', 'computer'])
    const half = buildView(snapshot({ eras: Era.space, works: standing('electrification') }))
    expect(rowFor(half, 'reactor').missing).toEqual(['computer'])
    const all = buildView(
      snapshot({ eras: Era.space, works: standing('electrification', 'computer') }),
    )
    expect(rowFor(all, 'reactor').missing).toEqual([])
    expect(rowFor(all, 'reactor').state).toBe('open')
  })

  it('says how many years a work takes at the rate the engine reported', () => {
    const rows = buildView(
      snapshot({
        rate: 100,
        works: standing('pottery'),
        building: { def: workIndex('irrigation'), progress: 250, since: 900 },
      }),
    )
    // FEAT: 600 de custo, 250 já de pé, 100 por ano — quatro anos, não seis e não três
    expect(rowFor(rows, 'irrigation').years).toBe(4)
    expect(rowFor(rows, 'granary').years).toBe(5)
    expect(rowFor(rows, 'plough').years).toBe(8)
    // FEAT: a obra de pé não tem prazo nenhum; dizer que ela ainda levaria anos seria falso
    expect(rowFor(rows, 'pottery').years).toBeNull()
  })

  it('says nothing about years when the civilization allots nothing to works', () => {
    const idle = buildView(snapshot({ rate: 0 }))
    expect(idle.map((row) => row.years)).toEqual(idle.map(() => null))
    const working = buildView(snapshot({ rate: 100 }))
    expect(working.every((row) => row.years !== null && Number.isFinite(row.years))).toBe(true)
  })

  it('never offers a work the engine would refuse', () => {
    // FEAT: a era clássica fechada com a escrita de pé é o caso que separa as duas condições
    const shutEra = snapshot({ eras: Era.agricultural, works: standing('writing') })
    const cases = [
      snapshot(),
      shutEra,
      snapshot({
        eras: Era.agricultural | Era.classical,
        works: standing('irrigation', 'writing'),
      }),
      snapshot({
        eras: Era.agricultural | Era.classical | Era.industrial,
        works: standing('writing', 'coinage'),
        building: { def: workIndex('metallurgy'), progress: 10, since: 900 },
      }),
      snapshot({ eras: Era.space, works: standing('electrification', 'computer') }),
    ]
    for (const state of cases) {
      for (const row of buildView(state)) {
        if (row.state !== 'open') continue
        expect(isCommissionable(state, row.def), row.id).toBe(true)
      }
    }
    // FEAT: pré-requisito cumprido não basta — com a era clássica fechada, a estrada continua fora
    // de alcance e nada falta na lista dela, que é a única forma de a era ser o motivo
    const shut = rowFor(buildView(shutEra), 'roads')
    expect(shut.state).toBe('locked')
    expect(shut.missing).toEqual([])
  })

  it('leaves the work on the site out of what it offers, though the engine would take it', () => {
    const state = snapshot({
      building: { def: workIndex('granary'), progress: 10, since: 900 },
    })
    // FEAT: o motor aceitaria trocar de canteiro, e por isso é a tela que decide não oferecer
    expect(isCommissionable(state, workIndex('granary'))).toBe(true)
    expect(rowFor(buildView(state), 'granary').state).toBe('building')
  })
})

describe('buildGroups', () => {
  it('splits the catalogue into the five eras and says which are within reach', () => {
    const groups = buildGroups(snapshot({ eras: Era.agricultural | Era.classical }))
    expect(groups.map((group) => group.era)).toEqual([
      Era.agricultural,
      Era.classical,
      Era.industrial,
      Era.electric,
      Era.space,
    ])
    expect(groups.map((group) => group.open)).toEqual([true, true, false, false, false])
    expect(groups.flatMap((group) => group.rows)).toHaveLength(WORKS.length)
    for (const group of groups) {
      for (const row of group.rows) expect(row.era).toBe(group.era)
    }
  })
})

describe('effectsOf', () => {
  it('reads what a work changes off the catalogue, factors apart from terms', () => {
    expect(effectsOf(workIndex('chemistry'))).toEqual([
      { key: 'harvest', kind: 'factor', value: 1.25 },
      { key: 'pollution', kind: 'term', value: 0.04 },
    ])
    expect(effectsOf(workIndex('sanitation'))).toEqual([
      { key: 'mortality', kind: 'term', value: -0.012 },
    ])
    // FEAT: o foguete não move coeficiente nenhum, e a tela tem de poder dizer isso
    expect(effectsOf(workIndex('rocket'))).toEqual([])
  })

  it('carries every coefficient of every work, with the value the catalogue records', () => {
    for (const [def, work] of WORKS.entries()) {
      const changes = effectsOf(def)
      expect(changes.map((change) => change.key).sort(), work.id).toEqual(
        Object.keys(work.effect).sort(),
      )
      for (const change of changes) {
        expect(change.value, `${work.id}.${change.key}`).toBe(work.effect[change.key])
        expect(change.kind, `${work.id}.${change.key}`).toBe(
          TERM_KEYS.some((key) => key === change.key) ? 'term' : 'factor',
        )
      }
    }
  })
})

describe('siteProgress', () => {
  it('gives the share of the work already standing, and nothing without a site', () => {
    expect(siteProgress(snapshot())).toBeNull()
    expect(
      siteProgress(
        snapshot({ building: { def: workIndex('irrigation'), progress: 150, since: 9 } }),
      ),
    ).toBeCloseTo(0.25, 10)
  })
})
