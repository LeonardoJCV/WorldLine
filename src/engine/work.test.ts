import { describe, expect, it } from 'vitest'
import {
  FACTOR_KEYS,
  NEUTRAL_MODS,
  PRESENTATION_ORDER,
  TERM_KEYS,
  WORKS,
  findWork,
  isCommissionable,
  workIndex,
  workMods,
  type WorkId,
  type WorkKey,
} from './work.ts'
import { Era } from './state.ts'

describe('the works catalogue', () => {
  it('has twenty-nine works with unique ids', () => {
    expect(WORKS).toHaveLength(29)
    expect(new Set(WORKS.map((w) => w.id)).size).toBe(29)
  })

  it('pins the catalogue order, because work.def enters a hash later', () => {
    expect(WORKS.map((w) => w.id)).toEqual([
      'irrigation',
      'plough',
      'granary',
      'calendar',
      'pottery',
      'writing',
      'roads',
      'coinage',
      'aqueduct',
      'navigation',
      'printing',
      'metallurgy',
      'steam',
      'railway',
      'sanitation',
      'electrification',
      'telegraph',
      'chemistry',
      'medicine',
      'computer',
      'rocket',
      'orbit',
      'shipyard',
      'arcology',
      'reactor',
      'reforestation',
      'filters',
      'cleanGrid',
      'closedCycle',
    ])
  })

  it('never points a prerequisite at a work that does not exist', () => {
    const ids = new Set<string>(WORKS.map((w) => w.id))
    for (const work of WORKS) {
      for (const need of work.needs) expect(ids.has(need)).toBe(true)
    }
  })

  it('has no cycle, because every prerequisite comes earlier in the catalogue', () => {
    const seen = new Set<string>()
    for (const work of WORKS) {
      for (const need of work.needs) expect(seen.has(need)).toBe(true)
      seen.add(work.id)
    }
  })

  it('never needs a work from a later era than its own', () => {
    for (const work of WORKS) {
      for (const need of work.needs) expect(findWork(need).era).toBeLessThanOrEqual(work.era)
    }
  })

  it('charges every work a positive cost', () => {
    for (const work of WORKS) expect(work.cost).toBeGreaterThan(0)
  })

  it('has an empty effect only for the rocket, which gates the shipyard and the orbit', () => {
    const empty = WORKS.filter((w) => Object.keys(w.effect).length === 0)
    expect(empty.map((w) => w.id)).toEqual(['rocket'])

    const gated = WORKS.filter((w) => w.needs.includes('rocket' as WorkId))
      .map((w) => w.id)
      .sort()
    expect(gated).toEqual(['orbit', 'shipyard'])
  })

  const EXPECTED: Record<
    WorkId,
    { readonly needs: readonly WorkId[]; readonly effect: Partial<Record<WorkKey, number>> }
  > = {
    irrigation: { needs: [], effect: { harvest: 1.12 } },
    plough: { needs: ['irrigation'], effect: { harvest: 1.1 } },
    granary: { needs: [], effect: { spoil: -0.08 } },
    calendar: { needs: ['irrigation'], effect: { harvestNoise: -0.04 } },
    pottery: { needs: [], effect: { economy: 1.05 } },
    writing: { needs: [], effect: { research: 1.2 } },
    roads: { needs: ['writing'], effect: { economy: 1.08 } },
    coinage: { needs: ['writing'], effect: { economy: 1.12 } },
    aqueduct: { needs: ['roads'], effect: { mortality: -0.005, capacity: 1.06 } },
    navigation: { needs: ['roads'], effect: { economy: 1.1 } },
    printing: { needs: ['writing'], effect: { research: 1.35 } },
    metallurgy: { needs: ['coinage'], effect: { production: 1.15 } },
    steam: { needs: ['metallurgy'], effect: { energy: 1.8 } },
    railway: { needs: ['steam'], effect: { economy: 1.2, production: 1.1 } },
    sanitation: { needs: ['aqueduct'], effect: { mortality: -0.012 } },
    electrification: { needs: ['steam'], effect: { energy: 1.6 } },
    telegraph: { needs: ['electrification'], effect: { research: 1.15 } },
    chemistry: { needs: ['metallurgy'], effect: { harvest: 1.25, pollution: 0.04 } },
    medicine: { needs: ['sanitation'], effect: { mortality: -0.02 } },
    computer: { needs: ['telegraph'], effect: { research: 1.5 } },
    rocket: { needs: ['computer'], effect: {} },
    orbit: { needs: ['rocket'], effect: { research: 1.2 } },
    shipyard: { needs: ['rocket'], effect: { colonyCost: 0.7 } },
    arcology: { needs: ['computer'], effect: { capacity: 1.3 } },
    reactor: { needs: ['electrification', 'computer'], effect: { energy: 2.2 } },
    reforestation: { needs: ['roads'], effect: { smoke: 0.85 } },
    filters: { needs: ['steam'], effect: { smoke: 0.8 } },
    cleanGrid: { needs: ['electrification'], effect: { smoke: 0.75 } },
    closedCycle: { needs: ['reactor'], effect: { smoke: 0.7 } },
  }

  it('pins every work to its exact needs list and its exact effect map', () => {
    for (const work of WORKS) {
      expect(work.needs).toEqual(EXPECTED[work.id].needs)
      expect(work.effect).toEqual(EXPECTED[work.id].effect)
    }
  })

  // FEAT: a escada de mitigação — uma resposta por degrau da escada de energia, e cada resposta
  // apendada ao fim do catálogo mas pendurada na obra que criou o problema que ela responde
  it('answers every rung of the energy ladder with a rung of its own', () => {
    const smokers = WORKS.filter((work) => work.effect.smoke !== undefined)
    expect(smokers.map((work) => work.id)).toEqual([
      'reforestation',
      'filters',
      'cleanGrid',
      'closedCycle',
    ])
    expect(smokers.map((work) => work.era)).toEqual([
      Era.classical,
      Era.industrial,
      Era.electric,
      Era.space,
    ])
    for (const work of smokers) expect(work.effect.smoke).toBeLessThan(1)
    // FEAT: e um fator, nunca uma parcela: positivo, então poluição multiplicada por ele não vira
    // negativa, e é por isso que esta chave não tem piso nenhum em `derive()`
    for (const work of smokers) expect(work.effect.smoke).toBeGreaterThan(0)
  })

  // FEAT: cada resposta vem DEPOIS do problema na árvore: você eletrifica, se envenena, e então
  // tem o que construir — o pré-requisito de cada degrau é o degrau de energia que ele responde
  it('hangs each answer on the work whose smoke it answers', () => {
    const needs = (id: WorkId) => findWork(id).needs
    expect(needs('filters')).toEqual(['steam'])
    expect(needs('cleanGrid')).toEqual(['electrification'])
    expect(needs('closedCycle')).toEqual(['reactor'])
    for (const id of ['steam', 'electrification', 'reactor'] as const) {
      expect(findWork(id).effect.energy).toBeGreaterThan(1)
    }
  })

  // FEAT: armazenamento e apresentação são duas ordens diferentes de propósito — a primeira é
  // contrato de hash e append-only, a segunda é a árvore que o observador lê
  it('presents the catalogue by era, which is not the order it is stored in', () => {
    expect([...PRESENTATION_ORDER].sort((a, b) => a - b)).toEqual(WORKS.map((_, def) => def))
    expect(PRESENTATION_ORDER).not.toEqual(WORKS.map((_, def) => def))
    let era = 0
    let previous = -1
    for (const def of PRESENTATION_ORDER) {
      const work = WORKS[def]
      if (!work) throw new Error(`the presentation order points nowhere at ${def}`)
      if (work.era !== era) {
        expect(work.era).toBeGreaterThan(era)
        era = work.era
        previous = -1
      }
      expect(def).toBeGreaterThan(previous)
      previous = def
    }
    // FEAT: e a escada de mitigação deixa de vir toda no fim: cada degrau cai na era dele
    const shown = PRESENTATION_ORDER.map((def) => WORKS[def]?.id)
    expect(shown.indexOf('filters')).toBeLessThan(shown.indexOf('electrification'))
  })

  // FEAT: uma chave que nenhuma obra move é uma chave morta na camada permanente
  it('moves every key of the layer with at least one work', () => {
    for (const key of [...FACTOR_KEYS, ...TERM_KEYS]) {
      expect(
        WORKS.some((work) => work.effect[key] !== undefined),
        key,
      ).toBe(true)
    }
  })
})

describe('NEUTRAL_MODS', () => {
  it('is exactly 1 on every factor and exactly 0 on every term', () => {
    for (const key of FACTOR_KEYS) expect(NEUTRAL_MODS[key]).toBe(1)
    for (const key of TERM_KEYS) expect(NEUTRAL_MODS[key]).toBe(0)
  })
})

describe('workMods', () => {
  it('is the neutral element with no works', () => {
    expect(workMods([])).toEqual(NEUTRAL_MODS)
  })

  // FEAT: a décima segunda chave com neutro inexato moveria os dezessete fingerprints de uma vez
  it('leaves the new twelfth key at exactly one with no works', () => {
    expect(workMods([]).smoke).toBe(1)
    expect(NEUTRAL_MODS.smoke).toBe(1)
    expect(FACTOR_KEYS).toContain('smoke')
    expect(TERM_KEYS).not.toContain('smoke' as never)
  })

  it('multiplies the four rungs of the mitigation ladder into one factor', () => {
    const ladder = (['reforestation', 'filters', 'cleanGrid', 'closedCycle'] as const).map(
      (id, i) => ({ def: workIndex(id), done: i, record: i }),
    )
    expect(workMods(ladder).smoke).toBeCloseTo(0.85 * 0.8 * 0.75 * 0.7, 10)
    expect(workMods(ladder).pollution).toBe(0)
  })

  it('leaves no key undefined, so no arithmetic can produce NaN', () => {
    const mods = workMods([{ def: 0, done: 100, record: 0 }])
    for (const value of Object.values(mods)) expect(Number.isFinite(value)).toBe(true)
  })

  it('multiplies two factors on the same key and sums two terms', () => {
    const both = workMods([
      { def: 0, done: 100, record: 0 },
      { def: 1, done: 200, record: 1 },
    ])
    expect(both.harvest).toBeCloseTo(1.12 * 1.1, 10)

    const two = workMods([
      { def: 8, done: 100, record: 0 },
      { def: 14, done: 200, record: 1 },
    ])
    expect(two.mortality).toBeCloseTo(-0.017, 10)
  })

  it('does not care about the order of the list', () => {
    const a = workMods([
      { def: 0, done: 1, record: 0 },
      { def: 12, done: 2, record: 1 },
    ])
    const b = workMods([
      { def: 12, done: 2, record: 1 },
      { def: 0, done: 1, record: 0 },
    ])
    expect(a).toEqual(b)
  })
})

describe('isCommissionable', () => {
  it('refuses a work whose era has not opened', () => {
    const index = workIndex('irrigation')
    expect(isCommissionable({ eras: 0, works: [] }, index)).toBe(false)
  })

  it('accepts a work with no prerequisites once its era is open', () => {
    const index = workIndex('irrigation')
    const eras = findWork('irrigation').era
    expect(isCommissionable({ eras, works: [] }, index)).toBe(true)
  })

  it('refuses a work that is already done', () => {
    const index = workIndex('irrigation')
    const eras = findWork('irrigation').era
    const works = [{ def: index, done: 100, record: 0 }]
    expect(isCommissionable({ eras, works }, index)).toBe(false)
  })

  it('refuses a work whose prerequisite is missing', () => {
    const index = workIndex('plough')
    const eras = findWork('plough').era
    expect(isCommissionable({ eras, works: [] }, index)).toBe(false)
  })

  it('refuses with only one of two prerequisites met, and accepts once both are', () => {
    const index = workIndex('reactor')
    const eras = findWork('reactor').era
    const computerOnly = [{ def: workIndex('computer'), done: 1, record: 0 }]
    expect(isCommissionable({ eras, works: computerOnly }, index)).toBe(false)

    const both = [
      { def: workIndex('computer'), done: 1, record: 0 },
      { def: workIndex('electrification'), done: 1, record: 1 },
    ]
    expect(isCommissionable({ eras, works: both }, index)).toBe(true)
  })

  it('refuses an out-of-range index instead of throwing', () => {
    expect(isCommissionable({ eras: 0, works: [] }, 999)).toBe(false)
    expect(isCommissionable({ eras: 0, works: [] }, -1)).toBe(false)
  })

  // FEAT: o catálogo e o estado agora contam os bits do mesmo jeito; antes desta tarefa `work.era`
  // vinha de um mapa local de cinco bits e `state.eras` de um Era de quatro, e os dois se cruzavam
  it('reads the very bits the engine writes, with no map of its own', () => {
    for (const work of WORKS) expect(Object.values(Era)).toContain(work.era)
  })

  it('accepts a space-era work when the state carries the real space bit', () => {
    const rocket = workIndex('rocket')
    const works = [{ def: workIndex('computer'), done: 1, record: 0 }]
    expect(isCommissionable({ eras: Era.space, works }, rocket)).toBe(true)
  })

  // FIX: com os dois espaços de bits misturados, um mundo com as quatro eras antigas abertas
  // declarava `chemistry` comissionável e deixava as cinco obras espaciais fora de alcance
  it('keeps every space work shut on a world that climbed the ladder but never reached the top', () => {
    const climbed = Era.agricultural | Era.classical | Era.industrial | Era.electric
    const done = WORKS.flatMap((work, def) =>
      (climbed & work.era) !== 0 ? [{ def, done: 1, record: def }] : [],
    )
    for (const [index, work] of WORKS.entries()) {
      if (work.era !== Era.space) continue
      expect(isCommissionable({ eras: climbed, works: done }, index), work.id).toBe(false)
    }
    // FEAT: e a era elétrica, aberta, não deixa a obra dela de fora
    expect(
      isCommissionable(
        { eras: climbed, works: [{ def: workIndex('metallurgy'), done: 1, record: 0 }] },
        workIndex('chemistry'),
      ),
    ).toBe(true)
  })
})
