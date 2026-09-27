import { describe, expect, it } from 'vitest'
import type { Commission } from './commission.ts'
import { crossingAmounts, crossingCost, type Crossing } from './crossing.ts'
import type { Debt } from './debt.ts'
import { EVENTS, METRICS, worldMetrics } from './events.ts'
import { PARAMS as K } from './params.ts'
import { NEUTRAL_MODIFIERS, SimulationError, derive, integrate } from './rules.ts'
import { Era, VARIABLES, type WorldState } from './state.ts'
import { TEST_WORLD, makeState } from './testing.ts'
import {
  FACTOR_KEYS,
  NEUTRAL_MODS,
  TERM_KEYS,
  WORKS,
  workIndex,
  workMods,
  type Work,
  type WorkKey,
} from './work.ts'
import { Worldline } from './worldline.ts'

const neutral = NEUTRAL_MODIFIERS
const calm = 0.5

describe('derive', () => {
  it('feeds the initial world with a surplus', () => {
    const d = derive(makeState(), TEST_WORLD, neutral, calm)
    expect(d.foodSecurity).toBeGreaterThan(1.2)
    expect(d.foodSecurity).toBeLessThan(1.8)
  })

  it('produces more food with more agriculture', () => {
    const low = derive(
      makeState({
        allocation: { agriculture: 10, industry: 45, research: 30, conservation: 10, works: 5 },
      }),
      TEST_WORLD,
      neutral,
      calm,
    )
    const high = derive(makeState(), TEST_WORLD, neutral, calm)
    expect(high.foodProduction).toBeGreaterThan(low.foodProduction)
  })

  it('places carrying capacity at half the agricultural capacity', () => {
    const d = derive(makeState(), TEST_WORLD, neutral, calm)
    expect(d.carryingCapacity).toBeCloseTo(d.capacity / 2, 6)
  })

  it('raises mortality under hunger', () => {
    const fed = derive(makeState(), TEST_WORLD, neutral, calm)
    const hungry = derive(makeState({ population: 4e6, food: 0 }), TEST_WORLD, neutral, calm)
    expect(hungry.foodSecurity).toBeLessThan(1)
    expect(hungry.deathRate).toBeGreaterThan(fed.deathRate)
  })

  it('raises the energy target with industry and doubles it in the industrial era', () => {
    const base = derive(makeState(), TEST_WORLD, neutral, calm)
    const industrial = derive(makeState({ eras: Era.industrial }), TEST_WORLD, neutral, calm)
    const heavy = derive(
      makeState({
        allocation: { agriculture: 20, industry: 55, research: 10, conservation: 10, works: 5 },
      }),
      TEST_WORLD,
      neutral,
      calm,
    )
    expect(industrial.energyTarget).toBeCloseTo(base.energyTarget * 2, 10)
    expect(heavy.energyTarget).toBeGreaterThan(base.energyTarget)
  })

  it('pollutes more with energy and less with clean technology', () => {
    const dirty = derive(makeState({ energy: 4 }), TEST_WORLD, neutral, calm)
    const lighter = derive(makeState({ energy: 2 }), TEST_WORLD, neutral, calm)
    const clean = derive(makeState({ energy: 4, technology: 95 }), TEST_WORLD, neutral, calm)
    expect(dirty.pollution).toBeGreaterThan(lighter.pollution)
    expect(clean.pollution).toBeLessThan(dirty.pollution * 0.2)
  })

  it('lowers births as the economy grows', () => {
    const poor = derive(makeState({ economy: 0.5 }), TEST_WORLD, neutral, calm)
    const rich = derive(makeState({ economy: 10 }), TEST_WORLD, neutral, calm)
    expect(rich.birthRate).toBeLessThan(poor.birthRate)
  })

  it('applies harvest and mortality modifiers', () => {
    const base = derive(makeState(), TEST_WORLD, neutral, calm)
    const blighted = derive(makeState(), TEST_WORLD, { ...neutral, harvest: 0.85 }, calm)
    const sick = derive(makeState(), TEST_WORLD, { ...neutral, mortality: 0.02 }, calm)
    expect(blighted.foodProduction / base.foodProduction).toBeCloseTo(0.85, 10)
    expect(sick.deathRate - base.deathRate).toBeCloseTo(0.02, 10)
  })

  it('moves the harvest with the noise sample', () => {
    const lean = derive(makeState(), TEST_WORLD, neutral, 0)
    const rich = derive(makeState(), TEST_WORLD, neutral, 0.999)
    expect(rich.foodProduction).toBeGreaterThan(lean.foodProduction)
  })

  it('harvests nothing when there is nobody to work and nothing to grow on', () => {
    // FEAT: os dois zeros juntos davam 0/0; separados, cada um já dava zero e sempre deu
    const empty = derive(makeState({ population: 0, environment: 0 }), TEST_WORLD, neutral, calm)
    expect(Number.isFinite(empty.foodProduction)).toBe(true)
    expect(empty.foodProduction).toBe(0)
  })

  it('already harvested nothing with either zero alone, and still does', () => {
    const noPeople = derive(
      makeState({ population: 0, environment: 50 }),
      TEST_WORLD,
      neutral,
      calm,
    )
    const noLand = derive(makeState({ population: 1e6, environment: 0 }), TEST_WORLD, neutral, calm)
    expect(noPeople.foodProduction).toBe(0)
    expect(noLand.foodProduction).toBe(0)
  })
})

describe('integrate', () => {
  it('advances one year and shifts the economy memory', () => {
    const s = makeState({ economy: 1.3, recentEconomy: [1, 1.1, 1.2, 1.25, 1.28] })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(next.tick).toBe(1)
    expect(next.recentEconomy).toEqual([1.1, 1.2, 1.25, 1.28, 1.3])
  })

  it('keeps environment and stability inside 0..100', () => {
    const s = makeState({ energy: 1000, population: 5e6 })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(next.environment).toBe(0)
    expect(next.stability).toBeGreaterThanOrEqual(0)
    expect(next.stability).toBeLessThanOrEqual(100)
  })

  it('never lets technology exceed 100', () => {
    const s = makeState({
      technology: 99.99,
      economy: 50,
      allocation: { agriculture: 0, industry: 0, research: 100, conservation: 0, works: 0 },
    })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), { ...neutral, research: 5 })
    expect(next.technology).toBeLessThanOrEqual(100)
  })

  it('limits energy growth by the economy', () => {
    const poor = makeState({ economy: 0.05 })
    const rich = makeState({ economy: 5 })
    const poorNext = integrate(poor, derive(poor, TEST_WORLD, neutral, calm), neutral)
    const richNext = integrate(rich, derive(rich, TEST_WORLD, neutral, calm), neutral)
    expect(richNext.energy - rich.energy).toBeGreaterThan(poorNext.energy - poor.energy)
  })

  it('survives an emptied world', () => {
    const s = makeState({ population: 0 })
    const next = integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(next.population).toBe(0)
    expect(next.stability).toBeGreaterThanOrEqual(0)
  })

  it('survives an emptied world with no food left', () => {
    const s = makeState({ population: 0, food: 0 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    expect(Number.isNaN(derived.foodSecurity)).toBe(false)
    const next = integrate(s, derived, neutral)
    for (const variable of VARIABLES) expect(Number.isFinite(next[variable])).toBe(true)
  })

  it('reports the first non-finite variable', () => {
    const s = makeState({ population: NaN, tick: 42 })
    const run = () => integrate(s, derive(s, TEST_WORLD, neutral, calm), neutral)
    expect(run).toThrow(SimulationError)
    try {
      run()
    } catch (error) {
      expect(error).toMatchObject({ variable: 'population', tick: 42 })
    }
  })

  it('pulls the stability target down under debt, and is untouched with an empty list', () => {
    const s = makeState()
    const derived = derive(s, TEST_WORLD, neutral, calm)
    const withoutDebt = integrate(s, derived, neutral)
    const debts: readonly Debt[] = [{ kind: 'knowledge', owed: 20, since: 0, origin: 'B' }]
    const withDebt = integrate({ ...s, debts }, derived, neutral)
    expect(withDebt.stability).toBeLessThan(withoutDebt.stability)
    expect(integrate({ ...s, debts: [] }, derived, neutral).stability).toBe(withoutDebt.stability)
  })

  it('never subtracts a departure twice: the migration is already out of the population', () => {
    const s = makeState({ population: 998_000 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    const alone = integrate(s, derived, neutral)
    const leaving = integrate(s, derived, neutral, 2000)
    expect(leaving.population).toBe(alone.population)
  })

  it('reads a departure as the loss it is, so stability feels the world shrink', () => {
    const s = makeState({ population: 998_000 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    const alone = integrate(s, derived, neutral)
    const leaving = integrate(s, derived, neutral, 2000)
    expect(leaving.stability).toBeLessThan(alone.stability)
  })

  it('reads no departure from an emptied world', () => {
    const s = makeState({ population: 0 })
    const derived = derive(s, TEST_WORLD, neutral, calm)
    expect(integrate(s, derived, neutral, 0)).toEqual(integrate(s, derived, neutral))
  })

  it('penalizes by ratio, not by the absolute owed amount: a bigger economy carries the same debt more lightly', () => {
    const debts: readonly Debt[] = [{ kind: 'knowledge', owed: 50, since: 0, origin: 'B' }]
    const penaltyAt = (economy: number) => {
      const s = makeState({ economy })
      const derived = derive(s, TEST_WORLD, neutral, calm)
      const withoutDebt = integrate(s, derived, neutral)
      const withDebt = integrate({ ...s, debts }, derived, neutral)
      return withoutDebt.stability - withDebt.stability
    }
    const smallPenalty = penaltyAt(1)
    const bigPenalty = penaltyAt(50)
    expect(smallPenalty).toBeGreaterThan(0)
    expect(bigPenalty).toBeGreaterThan(0)
    expect(bigPenalty).toBeLessThan(smallPenalty)
  })
})

// FEAT: o mundo alcançado pelo revisor: semente 0, um presente de recurso no ano 0 colapsa o
// ambiente, e uma saída de gente no ano 19 leva embora exatamente a população daquele ano
describe('a world emptied by an out-crossing where the land already collapsed', () => {
  const DONOR = { technology: 40, food: 600, energy: 400, population: 900 }

  const gift: Crossing = {
    tick: 0,
    kind: 'resource',
    dose: 3,
    amounts: crossingAmounts('resource', 3, DONOR),
    origin: { world: 'donor', tick: 0 },
    cost: crossingCost('resource', 3, 0),
    direction: 'in',
  }

  it('reaches nowhere to grow on by year 19, through the public API', () => {
    const probe = new Worldline(0, [], null, [gift])
    probe.advance(19)
    expect(probe.present.environment).toBe(0)
  })

  it('harvests nothing instead of throwing, once the population that year also leaves', () => {
    const probe = new Worldline(0, [], null, [gift])
    probe.advance(19)
    const departure: Crossing = {
      tick: 19,
      kind: 'people',
      dose: 3,
      amounts: [probe.present.population],
      origin: { world: 'donor', tick: 19 },
      cost: 0,
      direction: 'out',
    }
    const w = new Worldline(0, [], null, [gift, departure])
    w.advance(20)
    expect(w.present.population).toBe(0)
    for (const variable of VARIABLES) expect(Number.isFinite(w.present[variable])).toBe(true)
    // FEAT: o mesmo 0/0 vive em crowding; a entrada do ano 19 é o estado empurrado a zero.
    // foodSecurity pode ser +Infinity por desenho (ninguém para alimentar); NaN nunca é legítimo
    const entering = { ...probe.present, population: 0 }
    const emptyMetrics = worldMetrics(entering, w.world)
    for (const metric of METRICS) expect(Number.isNaN(emptyMetrics[metric])).toBe(false)

    // FEAT: o mesmo ano, mas sem a saída: gente contra sala nenhuma é a lotação máxima, não zero
    const crowded = worldMetrics(probe.present, probe.world)
    for (const metric of METRICS) expect(Number.isNaN(crowded[metric])).toBe(false)
    const epidemic = EVENTS.find((event) => event.id === 'epidemic')
    const crowdingTrigger = epidemic?.trigger.find((condition) => condition.metric === 'crowding')
    if (!crowdingTrigger) throw new Error('epidemic must trigger on crowding')
    expect(crowdingTrigger.op).toBe('>')
    expect(crowded.crowding).toBeGreaterThan(crowdingTrigger.value)
  })
})

// FEAT: a segunda camada — permanente, separada dos eventos e feita só da lista de obras prontas
describe('the permanent layer of the works', () => {
  const WORK_KEYS: readonly WorkKey[] = [...FACTOR_KEYS, ...TERM_KEYS]
  const lean = 0

  // FEAT: um probe com colônia, tecnologia e economia para toda leitura da tabela ser mensurável
  function probe(works: readonly Work[]): WorldState {
    return makeState({
      works,
      technology: 30,
      economy: 2,
      colonies: [{ body: 1, founded: 0, population: 1000, support: 0, record: 0 }],
    })
  }

  const derived = (s: WorldState, noise = lean) => derive(s, TEST_WORLD, neutral, noise)
  const year = (s: WorldState) => integrate(s, derived(s), neutral)

  interface Reading {
    readonly read: (s: WorldState) => number
    readonly rises: (value: number) => boolean
  }

  // FEAT: onde cada chave do catálogo aterra, e para que lado ela empurra cada grandeza que toca —
  // uma chave pode ter mais de um alvo, e cada alvo tem de ser medido
  const READINGS: Readonly<Record<WorkKey, readonly Reading[]>> = {
    harvest: [{ read: (s) => derived(s).foodProduction, rises: (v) => v > 1 }],
    // FEAT: production aterra duas vezes, como mods.production: na colheita e no alvo da economia
    production: [
      { read: (s) => derived(s).foodProduction, rises: (v) => v > 1 },
      { read: (s) => year(s).economy, rises: (v) => v > 1 },
    ],
    research: [{ read: (s) => year(s).technology, rises: (v) => v > 1 }],
    energy: [{ read: (s) => derived(s).energyTarget, rises: (v) => v > 1 }],
    economy: [{ read: (s) => year(s).economy, rises: (v) => v > 1 }],
    capacity: [{ read: (s) => derived(s).carryingCapacity, rises: (v) => v > 1 }],
    colonyCost: [{ read: (s) => derived(s).energyTarget, rises: (v) => v < 1 }],
    mortality: [{ read: (s) => derived(s).deathRate, rises: (v) => v > 0 }],
    spoil: [{ read: (s) => derived(s).foodAvailable, rises: (v) => v < 0 }],
    harvestNoise: [{ read: (s) => derived(s).foodProduction, rises: (v) => v < 0 }],
    pollution: [{ read: (s) => derived(s).pollution, rises: (v) => v > 0 }],
    // FEAT: fator sobre o termo inteiro, então o alvo dele é a mesma poluição que a parcela move —
    // dois caminhos para a mesma grandeza, e cada um com o seu neutro
    smoke: [{ read: (s) => derived(s).pollution, rises: (v) => v > 1 }],
  }

  it('derives differently for two worlds identical except their works', () => {
    const bare = makeState({ works: [] })
    const irrigated = makeState({ works: [{ def: workIndex('irrigation'), done: 100, record: 0 }] })
    expect(derived(irrigated).foodProduction).toBeGreaterThan(derived(bare).foodProduction)
  })

  // FEAT: o teste que separa obra de evento — nenhum modificador temporário sobrevive a isto,
  // porque o ano é mil anos depois do fim da obra e não existe acontecimento ativo nenhum
  it('keeps the effect a thousand years after the work was done, with no active event', () => {
    const old = makeState({
      tick: 1100,
      active: [],
      works: [{ def: workIndex('irrigation'), done: 100, record: 0 }],
    })
    const none = makeState({ tick: 1100, active: [], works: [] })
    expect(old.active).toEqual([])
    expect(derived(old).foodProduction).toBeGreaterThan(derived(none).foodProduction)
  })

  it('is exactly neutral with no works, so the seventeen fingerprints cannot move', () => {
    expect(workMods([])).toEqual(NEUTRAL_MODS)
    for (const key of FACTOR_KEYS) expect(NEUTRAL_MODS[key]).toBe(1)
    for (const key of TERM_KEYS) expect(NEUTRAL_MODS[key]).toBe(0)

    // FEAT: as duas contas que a camada reescreveu, afirmadas com === contra a fórmula de antes
    const s = makeState()
    const d = derive(s, TEST_WORLD, neutral, calm)
    expect(d.foodAvailable).toBe(s.food * (1 - K.spoil) + d.foodProduction)
    expect(d.carryingCapacity).toBe(d.capacity * (1 - 1 / (K.laborShare * K.y0)))
  })

  it('reads all twelve keys of the layer and all thirteen landings, so none lands nowhere', () => {
    expect(WORK_KEYS).toHaveLength(12)
    expect(Object.keys(READINGS).sort()).toEqual([...WORK_KEYS].sort())
    const landings = WORK_KEYS.reduce((sum, key) => sum + READINGS[key].length, 0)
    expect(landings).toBe(13)
  })

  const EFFECTFUL = WORKS.map((work, def) => ({ id: work.id, def, effect: work.effect })).filter(
    (work) => Object.keys(work.effect).length > 0,
  )

  // FEAT: o foguete é a única obra de efeito vazio de propósito — o portão da era espacial é a
  // prova dele, e por isso ele é o único que fica fora desta tabela
  it('leaves only the rocket out of the table, because only the rocket moves no coefficient', () => {
    expect(EFFECTFUL).toHaveLength(28)
    expect(EFFECTFUL.map((work) => work.id)).not.toContain('rocket')
  })

  it.each(EFFECTFUL)('carries the effect of $id into the derived world', ({ id, def, effect }) => {
    const before = probe([])
    const after = probe([{ def, done: 0, record: 0 }])
    for (const key of WORK_KEYS) {
      const value = effect[key]
      if (value === undefined) continue
      for (const [target, reading] of READINGS[key].entries()) {
        const label = `${id}.${key}#${target}`
        if (reading.rises(value)) {
          expect(reading.read(after), label).toBeGreaterThan(reading.read(before))
        } else {
          expect(reading.read(after), label).toBeLessThan(reading.read(before))
        }
      }
    }
  })

  // FEAT: o teste que separa fator de parcela, e é o único que importa: uma parcela constante
  // subtrairia o mesmo de todo mundo, e o fator morde proporcionalmente ao veneno que existe
  it('bites the smoke in proportion, which a parcel could never do', () => {
    const rungs = (['reforestation', 'filters', 'cleanGrid', 'closedCycle'] as const).map(
      (id, i) => ({ def: workIndex(id), done: 0, record: i }),
    )
    const at = (energy: number, works: readonly Work[]) =>
      derived(makeState({ energy, population: 4e6, technology: 20, works })).pollution
    const lean = at(6, []) - at(6, rungs)
    const poisoned = at(6 * 6.336, []) - at(6 * 6.336, rungs)
    expect(lean).toBeGreaterThan(0)
    // FEAT: a escada de energia é 6,336×, e o corte cresce na mesma proporção — uma parcela daria 1
    expect(poisoned / lean).toBeCloseTo(6.336, 6)
  })

  // FEAT: `smoke` multiplica o termo INTEIRO, inclusive a parcela que a química acrescenta
  it('holds back the chemical parcel too, because the factor is over the whole term', () => {
    const chemistry = { def: workIndex('chemistry'), done: 0, record: 0 }
    const filters = { def: workIndex('filters'), done: 0, record: 1 }
    const state = (works: readonly Work[]) =>
      makeState({ energy: 0, population: 0, technology: 0, works })
    // FEAT: sem energia e sem gente o termo base é zero, então o que resta é a parcela sozinha
    const parcel = derived(state([chemistry])).pollution
    expect(parcel).toBeCloseTo(0.04, 12)
    expect(derived(state([chemistry, filters])).pollution).toBeCloseTo(0.04 * 0.8, 12)
    expect(derived(state([filters])).pollution).toBe(0)
  })

  // FEAT: fator positivo nunca deixa a poluição negativa, e é por isso que esta chave é a única da
  // camada que não precisa de piso — `spoil` e `mortality` precisam porque são parcelas
  it('needs no floor, because a positive factor can never turn the pollution negative', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      def: workIndex('closedCycle'),
      done: 0,
      record: i,
    }))
    expect(workMods(many).smoke).toBeLessThan(0.02)
    expect(workMods(many).smoke).toBeGreaterThan(0)
    const s = makeState({ energy: 40, population: 4e6, technology: 20, works: many })
    expect(derived(s).pollution).toBeGreaterThan(0)
  })

  // FEAT: a escada de mitigação contra a escada de energia, medida uma contra a outra — e ela NÃO
  // apaga o veneno: sobram 2,26×, a tensão fica, e é aí que a conservação passa a decidir o fim
  it('holds the energy ladder back without ever cancelling it', () => {
    const energy = (['steam', 'electrification', 'reactor'] as const).map((id, i) => ({
      def: workIndex(id),
      done: 0,
      record: i,
    }))
    const clean = (['reforestation', 'filters', 'cleanGrid', 'closedCycle'] as const).map(
      (id, i) => ({ def: workIndex(id), done: 0, record: 3 + i }),
    )
    expect(workMods(energy).energy).toBeCloseTo(6.336, 10)
    expect(workMods(clean).smoke).toBeCloseTo(0.357, 10)
    // FEAT: a escada de energia multiplica o ALVO e é o NÍVEL que a poluição lê, então a medida é a
    // mesma civilização no nível que cada uma alcança — 7,8 sem obra nenhuma, 6,336× disso com elas
    const s = (level: number, works: readonly Work[]) =>
      makeState({ energy: level, population: 4e6, technology: 20, works })
    const bare = derived(s(7.8, [])).pollution
    const held = derived(s(7.8 * 6.336, [...energy, ...clean])).pollution
    expect(held / bare).toBeCloseTo(6.336 * 0.357, 6)
    expect(held).toBeGreaterThan(bare)
    expect(held).toBeLessThan(3 * bare)
  })

  // FIX: uma taxa de perda negativa criaria comida do nada, então ela para em zero
  it('never lets the granaries spoil less than nothing and create food', () => {
    const granary = workIndex('granary')
    const works = Array.from({ length: 5 }, (_, i) => ({ def: granary, done: 0, record: i }))
    expect(K.spoil + workMods(works).spoil).toBeLessThan(0)
    // FEAT: sem gente e sem terra a colheita do ano é zero, então o que sobra é o estoque puro
    const s = makeState({ population: 0, environment: 0, food: 1e6, works })
    const d = derived(s)
    expect(d.foodProduction).toBe(0)
    expect(d.foodAvailable).toBe(s.food)
    expect(d.foodAvailable).toBeLessThanOrEqual(s.food)
  })

  // FIX: uma mortalidade negativa ressuscitaria gente, então ela para em zero
  it('never raises the dead, however many works push mortality down', () => {
    const healers = ['aqueduct', 'sanitation', 'medicine'] as const
    const works = healers.map((id, i) => ({ def: workIndex(id), done: 0, record: i }))
    const s = makeState({ technology: 100, economy: 50, environment: 100, food: 4e6, works })
    expect(workMods(works).mortality).toBeLessThan(0)
    const d = derived(s)
    expect(d.deathRate).toBe(0)
    expect(integrate(s, d, neutral).population).toBe(s.population * (1 + d.birthRate))
  })

  // FEAT: a queixa que o MVP responde, medida pela API pública: o ano 3000 de um mundo que
  // construiu não é o ano 3000 do mesmo mundo que não construiu — e as obras ficaram lá atrás
  it('makes the year three thousand differ from the same year without the works', () => {
    const orders: readonly Commission[] = [
      { tick: 100, work: 'irrigation' },
      { tick: 400, work: 'granary' },
      { tick: 700, work: 'pottery' },
      { tick: 1000, work: 'plough' },
    ]
    const bare = new Worldline(1)
    const built = new Worldline(1, [], null, [], [], orders)
    bare.advance(3000)
    built.advance(3000)
    expect(built.present.works.length).toBeGreaterThan(0)
    for (const work of built.present.works) expect(work.done).toBeLessThan(2000)
    expect(built.hashAt(3000)).not.toBe(bare.hashAt(3000))
    expect(built.present.population).not.toBe(bare.present.population)
  })

  // FIX: uma variância negativa não existe: com o piso, o ano magro nunca fica melhor que o calmo
  it('never turns the calendars into a negative variance', () => {
    const calendar = workIndex('calendar')
    const many = probe(Array.from({ length: 4 }, (_, i) => ({ def: calendar, done: 0, record: i })))
    expect(K.harvestNoise + workMods(many.works).harvestNoise).toBeLessThan(0)
    expect(derived(many, 0).foodProduction).toBe(derived(many, 1).foodProduction)
    expect(derived(many, 0).foodProduction).toBeLessThanOrEqual(derived(many, 0.5).foodProduction)
  })
})

describe('parameter invariants', () => {
  it('keeps the carrying-capacity factor positive, or crowding loses its sign in every world', () => {
    // FEAT: carryingCapacity = capacity * (1 - 1/(laborShare*y0)); se o fator virasse negativo,
    // crowding ficaria negativo em todo mundo com ambiente, e epidemic nunca mais dispararia
    expect(K.laborShare * K.y0).toBeGreaterThan(1)
  })
})
