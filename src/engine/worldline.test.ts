import { describe, expect, it } from 'vitest'
import type { Commission } from './commission.ts'
import type { Crossing } from './crossing.ts'
import type { Debt } from './debt.ts'
import { GOLDEN_SCRIPTS, INHERITANCE_CASE, SIBLING_CASE, goldenWorld } from './golden.ts'
import { hashState } from './hash.ts'
import type { Merge } from './merge.ts'
import { DEFAULT_ALLOCATION, HORIZON, PARADOX_GRACE } from './params.ts'
import { Era, hasEra } from './state.ts'
import { WORKS, workIndex, type WorkId } from './work.ts'
import { Worldline } from './worldline.ts'

const SEED = 482913
const industrial = { agriculture: 25, industry: 50, research: 20, conservation: 0, works: 5 }
const green = { agriculture: 40, industry: 10, research: 20, conservation: 25, works: 5 }

describe('Worldline', () => {
  it('starts at year zero with one sample', () => {
    const w = new Worldline(SEED)
    expect(w.present.tick).toBe(0)
    expect(w.valueAt('population', 0)).toBe(w.present.population)
  })

  it('advances and records every year', () => {
    const w = new Worldline(SEED)
    expect(w.advance(300)).toBe(300)
    expect(w.present.tick).toBe(300)
    expect(w.valueAt('technology', 300)).toBe(w.present.technology)
    expect(w.valueAt('environment', 150)).toBe(w.stateAt(150).environment)
  })

  it('applies a decision at the present year', () => {
    const w = new Worldline(SEED)
    w.advance(100)
    const decision = w.decide(industrial)
    expect(decision).toEqual({ tick: 100, allocation: industrial })
    w.advance(1)
    expect(w.present.allocation).toEqual(industrial)
  })

  it('replaces a decision made twice in the same year', () => {
    const w = new Worldline(SEED)
    w.decide(industrial)
    w.decide(green)
    expect(w.decisions).toEqual([{ tick: 0, allocation: green }])
  })

  it('rejects invalid allocations', () => {
    const w = new Worldline(SEED)
    expect(() => w.decide({ ...industrial, conservation: 5 })).toThrow(RangeError)
  })

  it('reproduces a live session from its decision log', () => {
    const live = new Worldline(SEED)
    live.advance(100)
    live.decide(industrial)
    live.advance(400)
    live.decide(green)
    live.advance(500)

    const replayed = new Worldline(SEED, live.decisions)
    replayed.advance(1000)
    expect(replayed.hashAt(1000)).toBe(live.hashAt(1000))
    expect(replayed.records).toEqual(live.records)
  })

  it('rebuilds any past year exactly from checkpoints', () => {
    const w = new Worldline(SEED, [{ tick: 300, allocation: industrial }])
    w.advance(1200)
    for (const tick of [0, 1, 255, 256, 257, 300, 511, 512, 999, 1200]) {
      const direct = new Worldline(SEED, [{ tick: 300, allocation: industrial }])
      direct.advance(tick)
      expect(w.hashAt(tick)).toBe(hashState(direct.present))
    }
  })

  it('closes event records when events end', () => {
    const w = new Worldline(SEED, [{ tick: 0, allocation: industrial }])
    w.advance(3000)
    for (const record of w.records) {
      if (record.end !== null) expect(record.end).toBeGreaterThanOrEqual(record.start)
    }
    const starts = w.records.map((r) => r.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('summarises a range into buckets', () => {
    const w = new Worldline(SEED)
    w.advance(99)
    const { min, max, mean } = w.range('population', 0, 99, 10)
    expect(min).toHaveLength(10)
    const firstTen = Array.from({ length: 10 }, (_, t) => w.valueAt('population', t))
    expect(min[0]).toBeCloseTo(Math.min(...firstTen), -1)
    expect(max[0]).toBeCloseTo(Math.max(...firstTen), -1)
    expect(mean[0]).toBeCloseTo(firstTen.reduce((a, b) => a + b, 0) / 10, -1)
  })

  it('never produces more buckets than years', () => {
    const w = new Worldline(SEED)
    w.advance(4)
    expect(w.range('food', 0, 4, 100).mean).toHaveLength(5)
  })

  it('stops at the horizon', () => {
    const w = new Worldline(SEED, [{ tick: 0, allocation: green }])
    const advanced = w.advance(HORIZON + 50)
    expect(w.ended).toBe(true)
    expect(advanced).toBeLessThanOrEqual(HORIZON)
  })

  it('forks a worldline that follows its parent until a new decision', () => {
    const parent = new Worldline(SEED, [{ tick: 50, allocation: industrial }])
    parent.advance(1000)
    const child = parent.fork(400)
    expect(child.lineage).toEqual({ parent, tick: 400 })
    expect(child.present.tick).toBe(400)
    child.advance(600)
    expect(child.hashAt(1000)).toBe(parent.hashAt(1000))

    const diverged = parent.fork(400)
    diverged.decide(green)
    diverged.advance(600)
    expect(diverged.hashAt(1000)).not.toBe(parent.hashAt(1000))
    expect(diverged.hashAt(400)).toBe(parent.hashAt(400))
  })

  it('rejects malformed decision logs', () => {
    expect(
      () =>
        new Worldline(SEED, [
          { tick: 10, allocation: green },
          { tick: 5, allocation: green },
        ]),
    ).toThrow(RangeError)
    expect(
      () =>
        new Worldline(SEED, [
          { tick: 10, allocation: green },
          { tick: 10, allocation: industrial },
        ]),
    ).toThrow(RangeError)
    expect(() => new Worldline(SEED, [{ tick: 3, allocation: { ...green, research: 0 } }])).toThrow(
      RangeError,
    )
  })

  it('rejects years outside the recorded history', () => {
    const w = new Worldline(SEED)
    w.advance(10)
    expect(() => w.stateAt(11)).toThrow(RangeError)
    expect(() => w.valueAt('food', -1)).toThrow(RangeError)
  })
})

describe('crossings', () => {
  // FEAT: uma dose proporcional ao que o mundo já sabe, para o roteiro medir a repetição da
  // história e não o paradoxo que um presente desmedido instalaria
  const incoming = (tick: number): Crossing => ({
    tick,
    kind: 'knowledge',
    dose: 2,
    amounts: [4],
    origin: { world: 'B', tick },
    cost: 6,
    direction: 'in',
  })

  it('replays a crossed history from a checkpoint', () => {
    const line = new Worldline(SEED, [], null, [incoming(300)])
    line.advance(900)
    for (const year of [299, 300, 301, 500, 900]) {
      const short = new Worldline(SEED, [], null, [incoming(300)])
      short.advance(year)
      expect(line.hashAt(year)).toBe(short.hashAt(year))
    }
  })

  it('replays a year that carries several crossings at once', () => {
    const script = [incoming(200), incoming(200), incoming(640)]
    const line = new Worldline(SEED, [], null, script)
    line.advance(800)
    for (const year of [199, 200, 201, 639, 640, 700, 800]) {
      const short = new Worldline(SEED, [], null, script)
      short.advance(year)
      expect(line.hashAt(year)).toBe(hashState(short.present))
    }
  })

  it('keeps a fork free of later crossings', () => {
    const line = new Worldline(SEED, [], null, [incoming(100), incoming(400)])
    line.advance(600)
    const child = line.fork(200)
    expect(child.crossings.map((c) => c.tick)).toEqual([100])
    expect(child.hashAt(200)).toBe(line.hashAt(200))
  })

  it('records a crossing at the present year', () => {
    const line = new Worldline(SEED)
    line.advance(50)
    const crossing = line.cross({ ...incoming(50) })
    expect(line.crossings).toEqual([crossing])
    expect(() => line.cross({ ...incoming(10) })).toThrow(RangeError)
  })

  it('refuses a crossing the validator rejects', () => {
    const line = new Worldline(SEED)
    line.advance(20)
    expect(() => line.cross({ ...incoming(20), amounts: [] })).toThrow(RangeError)
    expect(() => line.cross({ ...incoming(20), kind: 'doctrine', amounts: [] })).toThrow(RangeError)
    expect(line.crossings).toEqual([])
  })

  it('refuses a crossing once the worldline has ended', () => {
    const line = new Worldline(SEED)
    line.advance(HORIZON)
    expect(() => line.cross(incoming(HORIZON - 1))).toThrow(Error)
  })

  it('rejects a malformed crossing log', () => {
    expect(() => new Worldline(SEED, [], null, [incoming(400), incoming(100)])).toThrow(RangeError)
  })

  it('refuses a log dated before the first year instead of replaying it differently', () => {
    expect(() => new Worldline(SEED, [], null, [incoming(-1), incoming(300)])).toThrow(RangeError)
    expect(() => new Worldline(SEED, [], null, [incoming(0.5)])).toThrow(RangeError)

    const line = new Worldline(SEED, [], null, [incoming(300)])
    line.advance(900)
    const straight = new Worldline(SEED, [], null, [incoming(300)])
    straight.advance(500)
    expect(line.hashAt(500)).toBe(hashState(straight.present))
  })

  it('leaves a world without crossings identical to a world built with an empty list', () => {
    const plain = new Worldline(SEED)
    plain.advance(1200)
    const empty = new Worldline(SEED, [], null, [])
    empty.advance(1200)
    expect(plain.hashAt(1200)).toBe(empty.hashAt(1200))
  })
})

describe('collapse', () => {
  const idle = { agriculture: 60, industry: 15, research: 0, conservation: 20, works: 5 }
  // FEAT: um presente muito acima da grandeza do mundo, num mundo que nunca pesquisa e por isso
  // nunca quita: o paradoxo entra no ato da travessia e o prazo vence
  const CROSSED_AT = 300
  const overwhelming: Crossing = {
    tick: CROSSED_AT,
    kind: 'knowledge',
    dose: 3,
    amounts: [200],
    origin: { world: 'B', tick: CROSSED_AT },
    cost: 18,
    direction: 'in',
  }
  const doomed = () => new Worldline(SEED, [{ tick: 0, allocation: idle }], null, [overwhelming])

  it('installs the paradox at the crossing and collapses when the deadline passes', () => {
    const line = doomed()
    line.advance(HORIZON)
    // FEAT: o paradoxo entra no passo do ano da travessia, logo aparece no estado do ano seguinte
    expect(line.stateAt(CROSSED_AT + 1).paradox).toEqual({
      kind: 'leap',
      since: CROSSED_AT,
      deadline: CROSSED_AT + PARADOX_GRACE,
    })
    expect(line.present.status).toBe('collapsed')
    const overdue = CROSSED_AT + PARADOX_GRACE
    expect(line.records.some((r) => r.event === 'collapse' && r.start === overdue)).toBe(true)
  })

  it('stops advancing once the world has collapsed', () => {
    const line = doomed()
    line.advance(HORIZON)
    const stopped = line.present.tick
    expect(line.ended).toBe(true)
    expect(line.advance(100)).toBe(0)
    expect(line.present.tick).toBe(stopped)
    expect(stopped).toBeLessThan(HORIZON)
  })

  it('rebuilds the collapse from the checkpoints, year by year', () => {
    const line = doomed()
    line.advance(HORIZON)
    for (const year of [CROSSED_AT, CROSSED_AT + 1, 256, 400, line.present.tick]) {
      const short = doomed()
      short.advance(year)
      expect(line.hashAt(year)).toBe(hashState(short.present))
    }
  })
})

describe('a worldline that outlives its world', () => {
  const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
  const heirWorld = (years: number) => {
    const line = goldenWorld(INHERITANCE_CASE.seed, plan)
    line.advance(years)
    return line
  }
  const line = heirWorld(3000)

  it('changes home instead of ending, and keeps running', () => {
    expect(line.present.tick).toBe(3000)
    expect(line.present.status).toBe('running')
    expect(line.present.home).not.toBeNull()
    expect(line.stateAt(INHERITANCE_CASE.ended).home).toBeNull()
    expect(line.stateAt(INHERITANCE_CASE.year).home).toBe(line.present.home)
  })

  it('rebuilds the inheritance from the checkpoints, year by year', () => {
    for (const year of [
      INHERITANCE_CASE.founded,
      INHERITANCE_CASE.ended,
      INHERITANCE_CASE.year,
      INHERITANCE_CASE.year + 1,
      2560,
      3000,
    ]) {
      expect(line.hashAt(year)).toBe(hashState(heirWorld(year).present))
    }
  })

  it('writes the moment down once, in the year the home world fell', () => {
    const moments = line.records.filter((record) => record.event === 'inheritance')
    expect(moments).toHaveLength(1)
    expect(moments[0]?.start).toBe(INHERITANCE_CASE.ended)
    const causes = moments[0]?.causes ?? []
    const named = causes.flatMap((cause) =>
      cause.kind === 'event' ? [line.records[cause.record]] : [],
    )
    expect(named.map((record) => record?.event)).toEqual(['collapse', 'colony_founded'])
    expect(named[1]?.start).toBe(INHERITANCE_CASE.founded)
    // FEAT: e a cadeia sobe da fundação para a era que a permitiu
    const era = named[1]?.causes[0]
    expect(era?.kind === 'event' && line.records[era.record]?.event).toBe('space_era')
  })

  it('does not hand the inheritance to a fork taken before it', () => {
    const early = line.fork(INHERITANCE_CASE.founded - 1)
    expect(early.present.home).toBeNull()
    expect(early.records.some((record) => record.event === 'inheritance')).toBe(false)
    // FEAT: sem o presente que a matou, a bifurcação nunca perde o planeta
    early.advance(3000 - early.present.tick)
    expect(early.present.home).toBeNull()
    expect(early.present.status).toBe('running')
  })

  it('hands the same inheritance to a fork that kept every cause of it', () => {
    const late = line.fork(INHERITANCE_CASE.ended - 1)
    expect(late.present.home).toBeNull()
    late.advance(INHERITANCE_CASE.year - late.present.tick)
    expect(late.present.home).toBe(line.present.home)
    expect(hashState(late.present)).toBe(line.hashAt(INHERITANCE_CASE.year))
  })
})

// FEAT: a única guarda de unidade do caso da irmã órfã, que quatro especificações de navegador abrem
// pelo link: uma comissão num ano de canteiro ocupado zera a obra em silêncio, e sem este teste o
// único sinal seria um navegador esperando por uma linha de herança que nunca chega
describe('a history that leaves a sister behind', () => {
  const line = goldenWorld(SIBLING_CASE.seed, SIBLING_CASE.plan)
  line.advance(SIBLING_CASE.refounded + 1)
  const years = (event: string) =>
    line.records.filter((record) => record.event === event).map((record) => record.start)

  it('builds the whole climb, founds both sisters, loses one and settles the body again', () => {
    // FIX: contar as comissões do roteiro só repetia uma constante; a guarda é que toda obra que
    // ele encomenda tenha ficado de pé, porque uma comissão de canteiro ocupado é perdida em silêncio
    const standing = new Set(line.present.works.map((done) => WORKS[done.def]?.id))
    expect(SIBLING_CASE.plan.commissions.filter((ordered) => !standing.has(ordered.work))).toEqual(
      [],
    )
    expect(line.present.works).toHaveLength(WORKS.length)
    expect(years('colony_founded')).toEqual([...SIBLING_CASE.founded, SIBLING_CASE.refounded])
    expect(years('inheritance')).toEqual([SIBLING_CASE.ended])
    expect(years('colony_lost')).toEqual([SIBLING_CASE.ended])
    expect(line.present.status).toBe('running')
    expect(line.present.home).not.toBeNull()
  })
})

describe('a year that carries a confluence', () => {
  // FEAT: uma história estrangeira reduzida ao recibo, porque o motor nunca resolve o outro lado
  const arriving = (tick: number): Merge => ({
    tick,
    self: 'A',
    other: 'B',
    direction: 'in',
    natal: 0,
    values: {
      population: 1_000_000,
      food: 200_000,
      energy: 2,
      technology: 30,
      economy: 3,
      environment: 60,
      stability: 50,
    },
  })
  const leaving = (tick: number): Merge => ({
    tick,
    self: 'B',
    other: 'A',
    direction: 'out',
    natal: 0,
  })

  it('applies a confluence registered in the present year', () => {
    const line = new Worldline(SEED)
    line.advance(400)
    const before = line.present.population
    line.merge(arriving(400))
    // FEAT: o log guarda o recibo inteiro, conferido contra um igual construído à parte
    expect(line.merges).toEqual([arriving(400)])
    line.advance(1)
    expect(line.present.population).toBeGreaterThan(before)
    expect(line.present.lastMerge).toEqual({ tick: 400, other: 'B' })
    expect(line.records.filter((record) => record.event === 'merge')).toHaveLength(1)
  })

  it('refuses a confluence dated in another year, or a second one in the same year', () => {
    const line = new Worldline(SEED)
    line.advance(400)
    expect(() => line.merge(arriving(399))).toThrow(RangeError)
    line.merge(arriving(400))
    expect(() => line.merge(arriving(400))).toThrow(Error)
    expect(line.merges).toHaveLength(1)
  })

  it('refuses a confluence once the worldline has ended', () => {
    const line = new Worldline(SEED)
    line.advance(300)
    line.merge(leaving(300))
    line.advance(1)
    expect(() => line.merge(arriving(300))).toThrow(Error)
  })

  // FEAT: a doutrina é conferida nas duas portas: o log do construtor e a costura do presente
  it('rejects a confluence whose doctrine debt carries no allocation', () => {
    const unpayable: Debt = { kind: 'doctrine', owed: 4, since: 300, origin: 'D' }
    const seam: Merge = { ...arriving(400), debts: [unpayable] }
    expect(() => new Worldline(SEED, [], null, [], [seam])).toThrow(RangeError)
    const line = new Worldline(SEED)
    line.advance(400)
    expect(() => line.merge(seam)).toThrow(RangeError)
    expect(line.merges).toEqual([])
    line.merge({ ...arriving(400), debts: [{ ...unpayable, allocation: DEFAULT_ALLOCATION }] })
    expect(line.merges).toHaveLength(1)
  })

  // FIX: o ano do deságue é sempre o presente da história, então nunca há ano depois dele para reviver
  it('never replays a year past the confluence a history flowed away in', () => {
    const line = new Worldline(SEED, [], null, [], [leaving(300)])
    line.advance(400)
    expect(line.present.tick).toBe(300)
    expect(line.present.status).toBe('merged')
    expect(line.stateAt(300)).toBe(line.present)
    expect(() => line.stateAt(301)).toThrow(RangeError)
    const plain = new Worldline(SEED)
    plain.advance(300)
    expect(line.hashAt(299)).toBe(plain.hashAt(299))
    // FEAT: e nenhuma filha herda o deságue, porque a bifurcação para no ano dele
    expect(line.fork(300).merges).toEqual([])
  })

  it('rejects a malformed confluence log', () => {
    expect(() => new Worldline(SEED, [], null, [], [arriving(400), arriving(100)])).toThrow(
      RangeError,
    )
    expect(() => new Worldline(SEED, [], null, [], [arriving(0.5)])).toThrow(RangeError)
    expect(() => new Worldline(SEED, [], null, [], [leaving(100), arriving(400)])).toThrow(
      RangeError,
    )
  })

  // FIX: o ano do deságue não é vivido, então não entra na coluna nem na conta de anos avançados
  it('does not record or count the year a history flows away in', () => {
    const line = new Worldline(SEED)
    line.advance(300)
    const before = line.present
    line.merge(leaving(300))
    expect(line.advance(5)).toBe(0)
    expect(line.present.tick).toBe(300)
    expect(line.present.status).toBe('merged')
    expect(line.valueAt('population', 300)).toBe(before.population)
    expect(() => line.valueAt('population', 301)).toThrow(RangeError)
    expect(line.records.filter((record) => record.event === 'merged_away')).toHaveLength(1)
  })

  it('replays a seamed history from a checkpoint', () => {
    const log = [arriving(300)]
    const line = new Worldline(SEED, [], null, [], log)
    line.advance(900)
    for (const year of [299, 300, 301, 512, 900]) {
      const short = new Worldline(SEED, [], null, [], log)
      short.advance(year)
      expect(line.hashAt(year)).toBe(hashState(short.present))
    }
  })

  it('keeps a fork free of later confluences', () => {
    const line = new Worldline(SEED, [], null, [], [arriving(100), arriving(400)])
    line.advance(600)
    const child = line.fork(200)
    expect(child.merges.map((seam) => seam.tick)).toEqual([100])
    expect(child.hashAt(200)).toBe(line.hashAt(200))
  })

  it('leaves a world alone until the year its confluence is dated, and not after', () => {
    const plain = new Worldline(SEED)
    plain.advance(1301)
    const seamed = new Worldline(SEED, [], null, [], [arriving(1300)])
    seamed.advance(1301)
    expect(seamed.hashAt(1200)).toBe(plain.hashAt(1200))
    expect(seamed.hashAt(1299)).toBe(plain.hashAt(1299))
    expect(seamed.hashAt(1301)).not.toBe(plain.hashAt(1301))
  })
})

describe('a commissioned work', () => {
  // FEAT: o ano em que esta semente abre a era agrícola, medido e não fixado, para a calibração
  // das obras poder movê-lo sem transformar este teste num fingerprint
  const opened = (() => {
    const line = new Worldline(SEED)
    line.advance(1000)
    for (let year = 0; year <= line.present.tick; year++) {
      if (hasEra(line.stateAt(year), Era.agricultural)) return year
    }
    throw new Error('the seed never opens the agricultural era')
  })()
  const ORDERED = opened + 1
  const END = 1000
  const log: readonly Commission[] = [{ tick: ORDERED, work: 'irrigation' }]
  const replayed = (years: number) => {
    const line = new Worldline(SEED, [], null, [], [], log)
    line.advance(years)
    return line
  }

  it('commissions a work in the present year and finishes it when the years add up', () => {
    const line = new Worldline(SEED)
    line.advance(ORDERED)
    expect(line.commission('irrigation')).toEqual({ tick: ORDERED, work: 'irrigation' })
    expect(line.commissions).toEqual(log)
    line.advance(END - ORDERED)

    const [done, ...rest] = line.present.works
    expect(rest).toEqual([])
    expect(done?.def).toBe(workIndex('irrigation'))
    expect(done?.done).toBeGreaterThan(ORDERED)
    expect(line.present.building).toBeNull()
    expect(line.stateAt(ORDERED + 1).building).toMatchObject({ def: done?.def, since: ORDERED })

    const receipt = line.records[done?.record ?? -1]
    expect(receipt?.event).toBe('work_done')
    expect(receipt?.start).toBe(done?.done)
    // FEAT: e o recibo sobe para a revolução agrícola, que é a era que abriu a obra
    const era = receipt?.causes[0]
    expect(era?.kind === 'event' && line.records[era.record]?.event).toBe('agricultural_revolution')
  })

  it('reproduces a commissioned history from its log and from its checkpoints', () => {
    const live = new Worldline(SEED)
    live.advance(ORDERED)
    live.commission('irrigation')
    live.advance(END - ORDERED)
    const whole = replayed(END)
    expect(whole.hashAt(END)).toBe(live.hashAt(END))
    expect(whole.records).toEqual(live.records)
    for (const year of [ORDERED - 1, ORDERED, ORDERED + 1, 512, END]) {
      expect(whole.hashAt(year)).toBe(hashState(replayed(year).present))
    }
  })

  it('leaves the years before the commission exactly as a world that never commissioned', () => {
    const plain = new Worldline(SEED)
    plain.advance(END)
    expect(replayed(END).hashAt(ORDERED)).toBe(plain.hashAt(ORDERED))
    expect(replayed(END).hashAt(END)).not.toBe(plain.hashAt(END))
    expect(plain.present.works).toEqual([])
    expect(plain.present.building).toBeNull()
  })

  it('gives a daughter the commissions made before the fork, and not the ones after', () => {
    const line = replayed(END)
    const late = line.fork(END)
    expect(late.commissions).toEqual(log)
    expect(late.present.works).toEqual(line.present.works)
    expect(late.hashAt(END)).toBe(line.hashAt(END))

    const early = line.fork(ORDERED)
    expect(early.commissions).toEqual([])
    expect(early.present.building).toBeNull()
    early.advance(END - ORDERED)
    expect(early.present.works).toEqual([])
  })

  it('replays a commission the years cannot honour instead of refusing it', () => {
    // FEAT: a era espacial nunca abre nesta semente, e o mesmo vale para um ramo que divergiu antes
    const line = new Worldline(SEED, [], null, [], [], [{ tick: 5, work: 'rocket' }])
    line.advance(300)
    expect(line.present.building).toBeNull()
    expect(line.present.works).toEqual([])
    const plain = new Worldline(SEED)
    plain.advance(300)
    expect(line.hashAt(300)).toBe(plain.hashAt(300))
  })

  it('replaces a commission made twice in the same year', () => {
    const line = new Worldline(SEED)
    line.advance(ORDERED)
    line.commission('irrigation')
    line.commission('granary')
    expect(line.commissions).toEqual([{ tick: ORDERED, work: 'granary' }])
  })

  it('refuses a work that is not in the catalogue', () => {
    const line = new Worldline(SEED)
    line.advance(100)
    expect(() => line.commission('pyramid' as WorkId)).toThrow(RangeError)
    expect(line.commissions).toEqual([])
  })

  // FIX: o portão é o do fim da história, não o do horizonte — num mundo que colapsa antes dele a
  // validação de forma ainda aceitaria o ano, então é aqui que o portão se prova
  it('refuses a commission on a history that ended long before the horizon', () => {
    const unresearched = { agriculture: 60, industry: 15, research: 0, conservation: 20, works: 5 }
    const ruinous: Crossing = {
      tick: 0,
      kind: 'knowledge',
      dose: 3,
      amounts: [200],
      origin: { world: 'B', tick: 0 },
      cost: 18,
      direction: 'in',
    }
    const line = new Worldline(SEED, [{ tick: 0, allocation: unresearched }], null, [ruinous])
    line.advance(HORIZON)
    expect(line.present.status).toBe('collapsed')
    expect(line.present.tick).toBeLessThan(HORIZON)
    expect(() => line.commission('irrigation')).toThrow(Error)
    expect(line.commissions).toEqual([])
  })

  it('refuses a commission while a scheduled one is still pending', () => {
    const scheduled: readonly Commission[] = [{ tick: 500, work: 'irrigation' }]
    const line = new Worldline(SEED, [], null, [], [], scheduled)
    line.advance(100)
    expect(() => line.commission('granary')).toThrow(Error)
    expect(line.commissions).toEqual(scheduled)
  })

  // FEAT: o motor aceita o gesto que o ano não pode honrar, porque é o painel que evita o gesto
  // inútil e a tolerância do motor é o que deixa um link reabrir; um portão aqui mataria isso
  it('records a commission the present year cannot honour, instead of gating it', () => {
    const line = new Worldline(SEED)
    line.advance(50)
    expect(hasEra(line.present, Era.agricultural)).toBe(false)
    expect(line.commission('irrigation')).toEqual({ tick: 50, work: 'irrigation' })
    expect(line.commissions).toHaveLength(1)
    line.advance(50)
    expect(line.present.building).toBeNull()
    expect(line.present.works).toEqual([])
  })

  it('rejects a malformed commission log', () => {
    const bad = (commissions: readonly Commission[]) =>
      new Worldline(SEED, [], null, [], [], commissions)
    expect(() =>
      bad([
        { tick: 400, work: 'irrigation' },
        { tick: 100, work: 'granary' },
      ]),
    ).toThrow(RangeError)
    expect(() => bad([{ tick: 0.5, work: 'irrigation' }])).toThrow(RangeError)
    expect(() => bad([{ tick: HORIZON, work: 'irrigation' }])).toThrow(RangeError)
    expect(() => bad([{ tick: 10, work: 'obelisk' as WorkId }])).toThrow(RangeError)
  })
})
