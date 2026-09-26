import { describe, expect, it } from 'vitest'
import { progressWork, tickWork, validateCommissions, type Commission } from './commission.ts'
import { EVENTS } from './events.ts'
import { hashState } from './hash.ts'
import { DEFAULT_ALLOCATION, HORIZON, PARAMS } from './params.ts'
import { Era, type WorldState } from './state.ts'
import { step } from './step.ts'
import { TEST_WORLD, makeState } from './testing.ts'
import { NEUTRAL_MODS, WORKS, findWork, workIndex, type WorkId } from './work.ts'

const base = makeState()

describe('progressWork', () => {
  it('draws a year of progress from what the world PRODUCES, not from what it holds', () => {
    const lean = { ...base, food: 10, economy: 3, population: 2e6 }
    // FEAT: todo campo que não é fluxo muda de valor aqui — celeiro, tanque, saber, ambiente,
    // estabilidade, eras, eco, dívida, tensão, colônia e as obras prontas; o metro de obra sai igual
    const fat: WorldState = {
      ...lean,
      tick: 900,
      food: 5e6,
      energy: 40,
      technology: 90,
      environment: 41,
      stability: 97,
      recentEconomy: [2, 2, 2, 2, 2],
      eras: Era.agricultural | Era.classical | Era.industrial,
      echoes: [
        { target: 'technology', remaining: 7 },
        { target: 'food', remaining: 3 },
      ],
      debts: [{ kind: 'knowledge', owed: 12, since: 400, origin: 'B' }],
      strain: 18,
      colonies: [{ body: 2, founded: 800, population: 5000, support: 0.7, record: 4 }],
      home: 2,
      works: [{ def: workIndex('metallurgy'), done: 500, record: 1 }],
      building: { def: workIndex('granary'), progress: 120, since: 880 },
    }
    expect(progressWork(fat, NEUTRAL_MODS)).toBeCloseTo(progressWork(lean, NEUTRAL_MODS), 10)
    expect(progressWork(lean, NEUTRAL_MODS)).toBeGreaterThan(0)
  })

  it('builds nothing at all when nothing is allocated to works', () => {
    const idle = { ...base, allocation: { ...DEFAULT_ALLOCATION, works: 0, industry: 30 } }
    expect(progressWork(idle, NEUTRAL_MODS)).toBe(0)
  })

  it('builds faster as the civilization grows', () => {
    const small = { ...base, economy: 2, population: 1e6 }
    const large = { ...base, economy: 8, population: 4e7 }
    expect(progressWork(large, NEUTRAL_MODS)).toBeGreaterThan(
      progressWork(small, NEUTRAL_MODS) * 10,
    )
  })

  it('takes the share of the year literally, and the production modifier on top of it', () => {
    const half = { ...base, allocation: { ...DEFAULT_ALLOCATION, works: 50, agriculture: 0 } }
    const tenth = { ...base, allocation: { ...DEFAULT_ALLOCATION, works: 10, agriculture: 35 } }
    expect(progressWork(half, NEUTRAL_MODS)).toBeCloseTo(progressWork(tenth, NEUTRAL_MODS) * 5, 10)
    const faster = { ...NEUTRAL_MODS, production: 1.5 }
    expect(progressWork(half, faster)).toBeCloseTo(progressWork(half, NEUTRAL_MODS) * 1.5, 10)
  })

  // FEAT: os níveis saem dos valores de nascimento de propósito, para um fator extra que valesse 1
  // sobre a fixture padrão não poder se esconder atrás dela
  it('measures a year of a world against the rate, the share, economy and the root — and nothing else', () => {
    const world = {
      ...base,
      economy: 4,
      population: 9e6,
      technology: 42,
      environment: 61,
      stability: 73,
      food: 7e5,
      energy: 2.5,
    }
    const share = DEFAULT_ALLOCATION.works / 100
    expect(progressWork(world, NEUTRAL_MODS)).toBeCloseTo(PARAMS.workRate * share * 4 * 3, 10)
  })

  it('reads the modifiers from the works already done when none are handed to it', () => {
    const plain = { ...base, economy: 4, population: 4e6 }
    const forged = {
      ...plain,
      works: [{ def: workIndex('metallurgy'), done: 10, record: 0 }],
    }
    expect(progressWork(plain)).toBeCloseTo(progressWork(plain, NEUTRAL_MODS), 10)
    expect(progressWork(forged)).toBeCloseTo(progressWork(plain, NEUTRAL_MODS) * 1.15, 10)
  })
})

// FEAT: um mundo que põe o ano inteiro na obra e produz o bastante para fechar a irrigação nele
const ALL_WORKS = { agriculture: 0, industry: 0, research: 0, conservation: 0, works: 100 }
const IRRIGATION = workIndex('irrigation')
const PLOUGH = workIndex('plough')
const GRANARY = workIndex('granary')

const slow = makeState({ eras: Era.agricultural })
const quick = makeState({ eras: Era.agricultural, economy: 10, allocation: ALL_WORKS })
const at = (work: WorkId, tick = 0): Commission => ({ tick, work })

describe('a year of work', () => {
  it('starts the work in the year it was commissioned', () => {
    const { state } = step(slow, TEST_WORLD, 0, undefined, [], undefined, at('irrigation'))
    expect(state.building).toEqual({
      def: IRRIGATION,
      progress: progressWork(slow, NEUTRAL_MODS),
      since: 0,
    })
    expect(state.works).toEqual([])
  })

  it('finishes the work when the progress reaches its cost, and dates it', () => {
    expect(progressWork(quick, NEUTRAL_MODS)).toBeGreaterThanOrEqual(findWork('irrigation').cost)
    const result = step(quick, TEST_WORLD, 7, undefined, [], undefined, at('irrigation'))
    expect(result.state.building).toBeNull()
    expect(result.state.works).toEqual([{ def: IRRIGATION, done: 0, record: 7 }])
    const index = result.started.findIndex((record) => record.event === 'work_done')
    // FEAT: o número guardado na obra é a posição do recibo na história, e é por ele que a cadeia sobe
    expect(7 + index).toBe(result.state.works[0]?.record)
    expect(result.started[index]).toMatchObject({ event: 'work_done', start: 0, end: 0 })
  })

  // FEAT: sobre um mundo congelado, para a lei medida ser a do acúmulo e não a da economia que cresce
  it('accumulates year after year, and finishes in the year the cost is met and not before', () => {
    const rate = progressWork(slow, NEUTRAL_MODS)
    const cost = findWork('irrigation').cost
    let state: WorldState = slow
    let accumulated = 0
    let year = 0
    // FIX: a lei é medida contra a soma que a própria obra acumulou, e nunca contra uma taxa que a
    // calibração vai mudar, senão o teste falha por arredondamento sem que a lei esteja quebrada
    while (state.works.length === 0 && year < 1000) {
      const built = tickWork({ ...state, tick: year }, 0, year === 0 ? at('irrigation') : undefined)
      accumulated += rate
      if (built.finished === null) {
        expect(accumulated).toBeLessThan(cost)
        expect(built.building?.progress).toBeCloseTo(accumulated, 6)
      } else {
        expect(accumulated).toBeGreaterThanOrEqual(cost)
        expect(built.building).toBeNull()
      }
      state = { ...state, works: built.works, building: built.building }
      year++
    }
    expect(state.works).toEqual([{ def: IRRIGATION, done: year - 1, record: 0 }])
    expect(year).toBeGreaterThan(1)
  })

  // FEAT: o recibo da obra é escrito antes dos acontecimentos do ano, então um ano cheio é onde a
  // numeração se prova: cada acontecimento ativo tem de apontar para o próprio registro
  it('numbers the records right when a year both finishes a work and starts events', () => {
    const busy = makeState({
      eras: Era.agricultural,
      economy: 10,
      technology: 40,
      allocation: ALL_WORKS,
    })
    const result = step(busy, TEST_WORLD, 0, undefined, [], undefined, at('irrigation'))
    expect(result.started.length).toBeGreaterThan(1)
    expect(result.state.active.length).toBeGreaterThan(0)

    const done = result.state.works[0]
    expect(result.started[done?.record ?? -1]?.event).toBe('work_done')
    for (const entry of result.state.active) {
      expect(result.started[entry.record]?.event).toBe(EVENTS[entry.def]?.id)
      expect(entry.record).toBeGreaterThan(done?.record ?? -1)
    }
  })

  it('spends the share the year decided, not the one the year began with', () => {
    const turn = { tick: 0, allocation: ALL_WORKS }
    const result = step(slow, TEST_WORLD, 0, turn, [], undefined, at('irrigation'))
    const spent = progressWork({ ...slow, allocation: ALL_WORKS }, NEUTRAL_MODS)
    expect(result.state.building?.progress).toBe(spent)
    expect(spent).toBeGreaterThan(progressWork(slow, NEUTRAL_MODS))
  })

  it('IGNORES a commission whose era has not opened, instead of throwing', () => {
    // FEAT: um ramo que divergiu antes pode chegar ao mesmo ano sem a era; lançar mataria o link
    const dark = makeState({ economy: 10, allocation: ALL_WORKS })
    const result = step(dark, TEST_WORLD, 0, undefined, [], undefined, at('irrigation'))
    expect(result.state.building).toBeNull()
    expect(result.state.works).toEqual([])
    expect(result.started.some((record) => record.event === 'work_done')).toBe(false)
    // FEAT: e a era errada é ignorada do mesmo jeito, não só a ausência de toda era
    const spatial = step(quick, TEST_WORLD, 0, undefined, [], undefined, at('rocket'))
    expect(spatial.state.building).toBeNull()
  })

  it('ignores a commission for a work already done, and one whose prerequisite is missing', () => {
    const irrigated = { ...slow, works: [{ def: IRRIGATION, done: 3, record: 0 }] }
    const again = step(irrigated, TEST_WORLD, 0, undefined, [], undefined, at('irrigation'))
    expect(again.state.building).toBeNull()
    expect(again.state.works).toHaveLength(1)

    const orphan = step(slow, TEST_WORLD, 0, undefined, [], undefined, at('plough'))
    expect(orphan.state.building).toBeNull()

    // FEAT: com o pré-requisito pronto a mesma comissão é aceita, então a recusa não é cega
    const heir = step(irrigated, TEST_WORLD, 0, undefined, [], undefined, at('plough'))
    expect(heir.state.building?.def).toBe(PLOUGH)
  })

  // FEAT: ignorar é não fazer nada — e a metade "não" é a que faltava: a obra em curso segue de pé,
  // com o ano dela somado, senão um ramo que reabre sem a era perderia séculos de aqueduto sem recibo
  it('leaves the work under way untouched when it ignores a commission', () => {
    const underway = { ...slow, building: { def: IRRIGATION, progress: 400, since: 0 } }
    const rate = progressWork(slow, NEUTRAL_MODS)
    const impossibles: readonly WorkId[] = ['rocket', 'plough', 'pyramid' as WorkId]
    for (const impossible of impossibles) {
      const result = step(underway, TEST_WORLD, 0, undefined, [], undefined, at(impossible))
      expect(result.state.building).toEqual({ def: IRRIGATION, progress: 400 + rate, since: 0 })
      expect(result.state.works).toEqual([])
      expect(result.started.some((record) => record.event === 'work_done')).toBe(false)
    }
    const alone = step(underway, TEST_WORLD, 0)
    expect(alone.state.building).toEqual(
      step(underway, TEST_WORLD, 0, undefined, [], undefined, at('rocket')).state.building,
    )
  })

  it('ignores a commission for a work that is not in the catalogue', () => {
    const unknown = step(quick, TEST_WORLD, 0, undefined, [], undefined, at('pyramid' as WorkId))
    expect(unknown.state.building).toBeNull()
    expect(unknown.state.works).toEqual([])
  })

  it('replaces the work under way and loses its progress', () => {
    const started = { ...slow, tick: 3, building: { def: IRRIGATION, progress: 400, since: 0 } }
    const { state } = step(started, TEST_WORLD, 0, undefined, [], undefined, at('granary', 3))
    expect(state.building).toEqual({
      def: GRANARY,
      progress: progressWork(started, NEUTRAL_MODS),
      since: 3,
    })
  })

  it('refuses a commission dated in another year, which is the caller lying about the year', () => {
    expect(() => step(slow, TEST_WORLD, 0, undefined, [], undefined, at('irrigation', 5))).toThrow(
      RangeError,
    )
  })

  it('names the era that opened the work and the works it stood on as causes', () => {
    const revolution = EVENTS.findIndex((def) => def.id === 'agricultural_revolution')
    const grounded = {
      ...quick,
      active: [{ def: revolution, record: 4, start: 0 }],
      works: [{ def: IRRIGATION, done: 3, record: 9 }],
    }
    const result = step(grounded, TEST_WORLD, 0, undefined, [], undefined, at('plough'))
    const done = result.started.find((record) => record.event === 'work_done')
    expect(result.state.works.map((work) => work.def)).toEqual([IRRIGATION, PLOUGH])
    expect(done?.causes).toEqual([
      { kind: 'event', record: 4 },
      { kind: 'event', record: 9 },
    ])
  })

  it('leaves a year without a commission exactly as it was before works existed', () => {
    const plain = step(base, TEST_WORLD, 0)
    expect(plain.state.works).toEqual([])
    expect(plain.state.building).toBeNull()
    expect(plain.started.some((record) => record.event === 'work_done')).toBe(false)
    const ignored = step(base, TEST_WORLD, 0, undefined, [], undefined, at('irrigation'))
    expect(hashState(ignored.state)).toBe(hashState(plain.state))
  })
})

describe('validateCommissions', () => {
  it('accepts whole increasing years inside the horizon, and copies the log', () => {
    const log = [at('irrigation', 0), at('granary', 40), at('writing', HORIZON - 1)]
    const validated = validateCommissions(log)
    expect(validated).toEqual(log)
    expect(validated[0]).not.toBe(log[0])
  })

  it('refuses a year that is not whole, not increasing, or outside the horizon', () => {
    expect(() => validateCommissions([at('irrigation', 0.5)])).toThrow(RangeError)
    expect(() => validateCommissions([at('irrigation', -1)])).toThrow(RangeError)
    expect(() => validateCommissions([at('granary', 40), at('irrigation', 20)])).toThrow(RangeError)
    expect(() => validateCommissions([at('granary', 40), at('irrigation', 40)])).toThrow(RangeError)
    expect(() => validateCommissions([at('irrigation', HORIZON)])).toThrow(RangeError)
  })

  it('refuses a work that is not in the catalogue, and accepts every one that is', () => {
    expect(() => validateCommissions([at('aqueducts' as WorkId)])).toThrow(RangeError)
    expect(validateCommissions(WORKS.map((work, index) => at(work.id, index)))).toHaveLength(
      WORKS.length,
    )
  })
})
