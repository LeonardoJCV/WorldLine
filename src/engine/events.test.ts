import { describe, expect, it } from 'vitest'
import { debtRatio, type Debt, type Paradox } from './debt.ts'
import {
  EVENTS,
  EVENT_IDS,
  collectModifiers,
  computeMetrics,
  evaluateEvents,
  type EventDef,
  type EventId,
  type Metric,
  type Metrics,
} from './events.ts'
import { CAUSAL_WINDOW } from './params.ts'
import { NEUTRAL_MODIFIERS, derive, integrate } from './rules.ts'
import { Era, NEVER, type Work, type WorldState } from './state.ts'
import { TEST_WORLD, makeMetrics, makeState } from './testing.ts'
import { WORKS, isCommissionable, workIndex, type WorkId } from './work.ts'
import { Worldline } from './worldline.ts'

const shortage: EventDef = {
  id: 'famine',
  kind: 'condition',
  trigger: [{ metric: 'foodSecurity', op: '<', value: 0.9 }],
  release: [{ metric: 'foodSecurity', op: '>', value: 0.99 }],
  cooldown: 10,
  effect: { mortality: 0.02 },
  influences: ['population', 'stability'],
}
const outbreak: EventDef = {
  id: 'epidemic',
  kind: 'pulse',
  duration: 3,
  trigger: [{ metric: 'crowding', op: '>', value: 0.9 }],
  cooldown: 0,
  effect: { mortality: 0.01, harvest: 0.9 },
  influences: ['population'],
}
const awakening: EventDef = {
  id: 'agricultural_revolution',
  kind: 'era',
  era: Era.agricultural,
  trigger: [{ metric: 'technology', op: '>', value: 20 }],
  cooldown: 0,
  influences: ['foodSecurity'],
}
const flourishing: EventDef = {
  id: 'golden_age',
  kind: 'condition',
  trigger: [{ metric: 'stability', op: '>', value: 50 }],
  release: [{ metric: 'stability', op: '<', value: 10 }],
  cooldown: 0,
  excludes: ['famine'],
  influences: ['technology'],
}
const collapse: EventDef = {
  id: 'extinction',
  kind: 'terminal',
  trigger: [{ metric: 'population', op: '<', value: 1000 }],
  cooldown: 0,
  influences: [],
}

function world(defs: readonly EventDef[], overrides: Partial<WorldState> = {}): WorldState {
  return makeState({ tick: 100, lastEnded: defs.map(() => NEVER), ...overrides })
}

describe('evaluateEvents', () => {
  it('stays quiet in a calm world', () => {
    const outcome = evaluateEvents(world(EVENTS), makeMetrics(), 1, 0)
    expect(outcome.started).toEqual([])
    expect(outcome.active).toEqual([])
  })

  it('starts a condition event and records the conditions with real values', () => {
    const defs = [shortage]
    const outcome = evaluateEvents(world(defs), makeMetrics({ foodSecurity: 0.8 }), 1, 7, defs)
    expect(outcome.started).toEqual([
      {
        event: 'famine',
        start: 100,
        end: null,
        causes: [
          { kind: 'condition', metric: 'foodSecurity', op: '<', threshold: 0.9, value: 0.8 },
        ],
      },
    ])
    expect(outcome.active).toEqual([{ def: 0, record: 7, start: 100 }])
  })

  it('keeps a condition event until its release holds', () => {
    const defs = [shortage]
    const s = world(defs, { active: [{ def: 0, record: 0, start: 90 }] })
    expect(evaluateEvents(s, makeMetrics({ foodSecurity: 0.95 }), 1, 1, defs).ended).toEqual([])
    const released = evaluateEvents(s, makeMetrics({ foodSecurity: 1 }), 1, 1, defs)
    expect(released.ended).toEqual([0])
    expect(released.active).toEqual([])
    expect(released.lastEnded).toEqual([100])
  })

  it('waits for the cooldown before recurring', () => {
    const defs = [shortage]
    const hungry = makeMetrics({ foodSecurity: 0.5 })
    expect(evaluateEvents(world(defs, { lastEnded: [95] }), hungry, 1, 0, defs).started).toEqual([])
    expect(
      evaluateEvents(world(defs, { lastEnded: [89] }), hungry, 1, 0, defs).started,
    ).toHaveLength(1)
  })

  it('ends a pulse after its duration', () => {
    const defs = [outbreak]
    const quiet = makeMetrics({ crowding: 0.5 })
    const young = world(defs, { active: [{ def: 0, record: 0, start: 98 }] })
    const old = world(defs, { active: [{ def: 0, record: 0, start: 97 }] })
    expect(evaluateEvents(young, quiet, 1, 1, defs).ended).toEqual([])
    expect(evaluateEvents(old, quiet, 1, 1, defs).ended).toEqual([0])
  })

  it('fires an era once, sets its bit and keeps it active', () => {
    const defs = [awakening]
    const first = evaluateEvents(world(defs), makeMetrics({ technology: 25 }), 1, 0, defs)
    expect(first.eras & Era.agricultural).toBe(Era.agricultural)
    expect(first.active).toHaveLength(1)
    const again = evaluateEvents(
      world(defs, { eras: first.eras, active: first.active }),
      makeMetrics({ technology: 30 }),
      1,
      1,
      defs,
    )
    expect(again.started).toEqual([])
    expect(again.active).toHaveLength(1)
  })

  it('honours the hazard probability', () => {
    const def: EventDef = {
      ...shortage,
      hazard: { metric: 'foodSecurity', from: 0.9, to: 0.7, rate: 1 },
    }
    let midpoint = 0
    let edge = 0
    for (let tick = 0; tick < 2000; tick++) {
      const s = world([def], { tick })
      if (evaluateEvents(s, makeMetrics({ foodSecurity: 0.8 }), 9, 0, [def]).started.length)
        midpoint++
      if (evaluateEvents(s, makeMetrics({ foodSecurity: 0.8999 }), 9, 0, [def]).started.length)
        edge++
    }
    expect(midpoint).toBeGreaterThan(900)
    expect(midpoint).toBeLessThan(1100)
    expect(edge).toBe(0)
  })

  it('does not start an event excluded by an active one', () => {
    const defs = [shortage, flourishing]
    const s = world(defs, { active: [{ def: 0, record: 0, start: 95 }] })
    const outcome = evaluateEvents(s, makeMetrics({ foodSecurity: 0.8, stability: 90 }), 1, 1, defs)
    expect(outcome.started).toEqual([])
  })

  it('lets a starting event interrupt another', () => {
    const interrupting: EventDef = { ...shortage, interrupts: ['golden_age'] }
    const defs = [interrupting, { ...flourishing, excludes: [] }]
    const s = world(defs, { active: [{ def: 1, record: 0, start: 90 }] })
    const outcome = evaluateEvents(s, makeMetrics({ foodSecurity: 0.8, stability: 90 }), 1, 1, defs)
    expect(outcome.started.map((r) => r.event)).toEqual(['famine'])
    expect(outcome.ended).toEqual([0])
    expect(outcome.active).toEqual([{ def: 0, record: 1, start: 100 }])
  })

  it('marks extinction without keeping it active', () => {
    const defs = [collapse]
    const outcome = evaluateEvents(world(defs), makeMetrics({ population: 500 }), 1, 0, defs)
    expect(outcome.extinct).toBe(true)
    expect(outcome.active).toEqual([])
    expect(outcome.started).toHaveLength(1)
  })

  it('links causes to influencing events and recent decisions', () => {
    const defs = [shortage, awakening, outbreak]
    const s = world(defs, {
      active: [
        { def: 2, record: 3, start: 99 },
        { def: 1, record: 4, start: 10 },
      ],
      eras: Era.agricultural,
      lastDecision: { tick: 80, sectors: ['agriculture', 'research'] },
    })
    const causes = evaluateEvents(s, makeMetrics({ foodSecurity: 0.8 }), 1, 5, defs).started[0]
      ?.causes
    expect(causes).toEqual([
      { kind: 'condition', metric: 'foodSecurity', op: '<', threshold: 0.9, value: 0.8 },
      { kind: 'decision', tick: 80, sectors: ['agriculture'] },
    ])

    const recentEra = world(defs, {
      active: [{ def: 1, record: 4, start: 70 }],
      eras: Era.agricultural,
    })
    const withEra = evaluateEvents(recentEra, makeMetrics({ foodSecurity: 0.8 }), 1, 5, defs)
    expect(withEra.started[0]?.causes).toContainEqual({ kind: 'event', record: 4 })
  })

  it('links a recent crossing and forgets an old one', () => {
    const defs = [shortage]
    const recent = world(defs, { lastCrossing: { tick: 80, kind: 'resource' } })
    const old = world(defs, { lastCrossing: { tick: 10, kind: 'resource' } })
    const metrics = makeMetrics({ foodSecurity: 0.8 })
    expect(evaluateEvents(recent, metrics, 1, 0, defs).started[0]?.causes).toContainEqual({
      kind: 'crossing',
      tick: 80,
      crossing: 'resource',
    })
    expect(evaluateEvents(old, metrics, 1, 0, defs).started[0]?.causes).toEqual([
      { kind: 'condition', metric: 'foodSecurity', op: '<', threshold: 0.9, value: 0.8 },
    ])
  })

  it('blames a crossing only for what it touched', () => {
    const defs = [awakening, shortage]
    const s = world(defs, { lastCrossing: { tick: 80, kind: 'knowledge' } })
    const outcome = evaluateEvents(
      s,
      makeMetrics({ technology: 30, foodSecurity: 0.8 }),
      1,
      0,
      defs,
    )
    const of = (event: string) => outcome.started.find((r) => r.event === event)?.causes
    expect(of('agricultural_revolution')).toContainEqual({
      kind: 'crossing',
      tick: 80,
      crossing: 'knowledge',
    })
    expect(of('famine')?.some((cause) => cause.kind === 'crossing')).toBe(false)
  })

  it('does not link a cause that started in the same year', () => {
    const defs = [awakening, shortage]
    const outcome = evaluateEvents(
      world(defs),
      makeMetrics({ technology: 25, foodSecurity: 0.8 }),
      1,
      5,
      defs,
    )
    expect(outcome.started.map((r) => r.event)).toEqual(['agricultural_revolution', 'famine'])
    expect(outcome.started[1]?.causes).not.toContainEqual({ kind: 'event', record: 5 })
  })
})

describe('collectModifiers', () => {
  it('multiplies factors and adds offsets across active events', () => {
    const defs = [shortage, outbreak]
    const mods = collectModifiers(
      [
        { def: 0, record: 0, start: 0 },
        { def: 1, record: 1, start: 0 },
      ],
      defs,
    )
    expect(mods).toMatchObject({
      production: 1,
      economy: 1,
      research: 1,
      stability: 0,
      harvest: 0.9,
    })
    expect(mods.mortality).toBeCloseTo(0.03, 12)
  })
})

describe('computeMetrics', () => {
  it('derives crowding, energy ratio and five-year economic trend', () => {
    const s = makeState({ economy: 1.2, recentEconomy: [1, 1.05, 1.1, 1.15, 1.18] })
    const d = derive(s, TEST_WORLD, NEUTRAL_MODIFIERS, 0.5)
    const m = computeMetrics(s, d)
    expect(m.crowding).toBeCloseTo(s.population / d.carryingCapacity, 12)
    expect(m.energyRatio).toBeCloseTo(s.energy / d.energyTarget, 12)
    expect(m.economyTrend).toBeCloseTo(1.2, 12)
  })

  it('derives the debt ratio the same way debt.ts computes it', () => {
    const debts: Debt[] = [{ kind: 'knowledge', owed: 10, since: 0, origin: 'B' }]
    const s = makeState({ debts })
    const d = derive(s, TEST_WORLD, NEUTRAL_MODIFIERS, 0.5)
    expect(computeMetrics(s, d).debtRatio).toBeCloseTo(debtRatio(debts, s), 12)
  })

  it('flags an active paradox, and separately whether its deadline has passed', () => {
    const paradox: Paradox = { kind: 'debt', since: 50, deadline: 150 }
    const before = makeState({ tick: 100, paradox })
    const overdue = makeState({ tick: 150, paradox })
    const none = makeState({ tick: 100, paradox: null })
    const metricsOf = (s: WorldState) =>
      computeMetrics(s, derive(s, TEST_WORLD, NEUTRAL_MODIFIERS, 0.5))

    expect(metricsOf(before).paradoxActive).toBe(1)
    expect(metricsOf(before).paradoxOverdue).toBe(0)
    expect(metricsOf(overdue).paradoxActive).toBe(1)
    expect(metricsOf(overdue).paradoxOverdue).toBe(1)
    expect(metricsOf(none).paradoxActive).toBe(0)
    expect(metricsOf(none).paradoxOverdue).toBe(0)
  })
})

describe('debt events', () => {
  it('starts debt_strain once the ratio passes 0.35 and releases it once it falls under 0.2', () => {
    const s = world(EVENTS)
    const started = evaluateEvents(s, makeMetrics({ debtRatio: 0.4 }), 1, 0).started
    expect(started.map((r) => r.event)).toContain('debt_strain')

    const strainIndex = EVENTS.findIndex((d) => d.id === 'debt_strain')
    const active = world(EVENTS, { active: [{ def: strainIndex, record: 0, start: 90 }] })
    expect(evaluateEvents(active, makeMetrics({ debtRatio: 0.3 }), 1, 1).ended).toEqual([])
    expect(evaluateEvents(active, makeMetrics({ debtRatio: 0.1 }), 1, 1).ended).toEqual([0])
  })

  it('pulses foreign_rejection only when debt is heavy and stability is already low', () => {
    const s = world(EVENTS)
    const heavyAndUnstable = evaluateEvents(
      s,
      makeMetrics({ debtRatio: 0.6, stability: 40 }),
      1,
      0,
    ).started
    expect(heavyAndUnstable.map((r) => r.event)).toContain('foreign_rejection')

    const heavyButStable = evaluateEvents(
      s,
      makeMetrics({ debtRatio: 0.6, stability: 60 }),
      1,
      0,
    ).started
    expect(heavyButStable.map((r) => r.event)).not.toContain('foreign_rejection')
  })

  it('starts dependency once debt passes 0.8 and releases it once it falls under 0.5', () => {
    const s = world(EVENTS)
    const started = evaluateEvents(s, makeMetrics({ debtRatio: 0.9 }), 1, 0).started
    expect(started.map((r) => r.event)).toContain('dependency')

    const depIndex = EVENTS.findIndex((d) => d.id === 'dependency')
    const active = world(EVENTS, { active: [{ def: depIndex, record: 0, start: 90 }] })
    expect(evaluateEvents(active, makeMetrics({ debtRatio: 0.6 }), 1, 1).ended).toEqual([])
    expect(evaluateEvents(active, makeMetrics({ debtRatio: 0.4 }), 1, 1).ended).toEqual([0])
  })
})

describe('paradox and collapse', () => {
  it('starts paradox the instant the state carries one, and ends it once it clears', () => {
    const s = world(EVENTS)
    const started = evaluateEvents(s, makeMetrics({ paradoxActive: 1 }), 1, 0).started
    expect(started.map((r) => r.event)).toContain('paradox')

    const paradoxIndex = EVENTS.findIndex((d) => d.id === 'paradox')
    const active = world(EVENTS, { active: [{ def: paradoxIndex, record: 0, start: 50 }] })
    expect(evaluateEvents(active, makeMetrics({ paradoxActive: 1 }), 1, 1).ended).toEqual([])
    expect(evaluateEvents(active, makeMetrics({ paradoxActive: 0 }), 1, 1).ended).toEqual([0])
  })

  it('collapses, as a terminal event, once the overdue metric flags a missed deadline', () => {
    const s = world(EVENTS)
    const outcome = evaluateEvents(s, makeMetrics({ paradoxOverdue: 1 }), 1, 0)
    // FEAT: um fim que não é a extinção — quem lê o desfecho precisa poder distinguir os dois
    expect(outcome.collapsed).toBe(true)
    expect(outcome.extinct).toBe(false)
    expect(outcome.started.map((r) => r.event)).toContain('collapse')
    expect(outcome.active).toEqual([])
  })

  it('traces a paradox back to the crossing that caused it', () => {
    const s = world(EVENTS, { lastCrossing: { tick: 80, kind: 'knowledge' } })
    const outcome = evaluateEvents(s, makeMetrics({ paradoxActive: 1 }), 1, 0)
    const record = outcome.started.find((r) => r.event === 'paradox')
    expect(record?.causes).toContainEqual({ kind: 'crossing', tick: 80, crossing: 'knowledge' })
  })

  it('names the crossing behind the heaviest debt, however far outside the causal window it lies', () => {
    // FIX: uma dívida só vira paradoxo depois de PARADOX_PATIENCE anos, que é mais que CAUSAL_WINDOW
    const debts: Debt[] = [
      { kind: 'doctrine', owed: 2, since: 5, origin: 'C' },
      { kind: 'resource', owed: 9, since: 1, origin: 'B' },
    ]
    const paradox: Paradox = { kind: 'debt', since: 100, deadline: 300 }
    const s = world(EVENTS, { debts, paradox, lastCrossing: { tick: 5, kind: 'doctrine' } })
    expect(s.tick - 1).toBeGreaterThan(CAUSAL_WINDOW)
    const outcome = evaluateEvents(s, makeMetrics({ paradoxActive: 1 }), 1, 0)
    const record = outcome.started.find((r) => r.event === 'paradox')
    expect(record?.causes).toContainEqual({ kind: 'crossing', tick: 1, crossing: 'resource' })
    expect(record?.causes.filter((cause) => cause.kind === 'crossing')).toHaveLength(1)
  })

  it('names no crossing for a leap or circular paradox beyond the one the window already carries', () => {
    const paradox: Paradox = { kind: 'circular', since: 100, deadline: 300 }
    const debts: Debt[] = [{ kind: 'knowledge', owed: 9, since: 1, origin: 'B' }]
    const s = world(EVENTS, { debts, paradox, lastCrossing: { tick: 100, kind: 'knowledge' } })
    const outcome = evaluateEvents(s, makeMetrics({ paradoxActive: 1 }), 1, 0)
    const record = outcome.started.find((r) => r.event === 'paradox')
    expect(record?.causes).toContainEqual({ kind: 'crossing', tick: 100, crossing: 'knowledge' })
    expect(record?.causes.filter((cause) => cause.kind === 'crossing')).toHaveLength(1)
  })

  it('traces a collapse back to the paradox that is still active when it fires', () => {
    const paradoxIndex = EVENTS.findIndex((d) => d.id === 'paradox')
    const s = world(EVENTS, { active: [{ def: paradoxIndex, record: 3, start: 50 }] })
    const outcome = evaluateEvents(s, makeMetrics({ paradoxActive: 1, paradoxOverdue: 1 }), 1, 10)
    const record = outcome.started.find((r) => r.event === 'collapse')
    expect(record?.causes).toContainEqual({ kind: 'event', record: 3 })
  })
})

describe('space era', () => {
  it('opens only once technology, energy and economy are all high at once', () => {
    const s = world(EVENTS)
    const started = evaluateEvents(
      s,
      makeMetrics({ technology: 95, energy: 13, economy: 9 }),
      1,
      0,
    ).started
    expect(started.map((r) => r.event)).toContain('space_era')
  })

  it('stays shut on the energy the reference scripts actually reach, tech and economy notwithstanding', () => {
    const s = world(EVENTS)
    // FEAT: 9/11 é o teto medido dos doze roteiros de referência (spec §3); 13 é a folga calibrada
    const started = evaluateEvents(
      s,
      makeMetrics({ technology: 100, energy: 9, economy: 11 }),
      1,
      0,
    ).started
    expect(started.map((r) => r.event)).not.toContain('space_era')
  })
})

describe('the demographic transition', () => {
  const index = EVENTS.findIndex((def) => def.id === 'demographic_transition')
  const active = [{ def: index, record: 0, start: 0 }]

  it('is a condition, not an era, so it owns no bit at all', () => {
    expect(EVENTS[index]?.kind).toBe('condition')
    expect(EVENTS[index]?.era).toBeUndefined()
  })

  // FEAT: o conserto que a auditoria pediu — o bit sem leitor virou efeito com leitor, e este teste
  // falha se alguém tirar o efeito da tabela
  it('lowers the birth rate the engine actually integrates', () => {
    const s = makeState({ economy: 4 })
    const mods = collectModifiers(active)
    expect(mods.birth).toBeLessThan(1)
    const quiet = derive(s, TEST_WORLD, NEUTRAL_MODIFIERS, 0.5)
    const transitioned = derive(s, TEST_WORLD, mods, 0.5)
    expect(transitioned.birthRate).toBeLessThan(quiet.birthRate)
    expect(transitioned.birthRate).toBeCloseTo(quiet.birthRate * (mods.birth ?? 1), 12)
  })

  it('raises what each person produces, which is the other half of its name', () => {
    const s = makeState({ economy: 4 })
    const mods = collectModifiers(active)
    expect(mods.economy).toBeGreaterThan(1)
    const quiet = integrate(s, derive(s, TEST_WORLD, NEUTRAL_MODIFIERS, 0.5), NEUTRAL_MODIFIERS)
    const transitioned = integrate(s, derive(s, TEST_WORLD, mods, 0.5), mods)
    expect(transitioned.economy).toBeGreaterThan(quiet.economy)
    expect(transitioned.population).toBeLessThan(quiet.population)
  })

  it('lets go once the prosperity that opened it is gone', () => {
    const s = world(EVENTS, { active })
    const outcome = evaluateEvents(s, makeMetrics({ economy: 1 }), 1, 0)
    expect(outcome.ended).toEqual([0])
    expect(outcome.active).toEqual([])
  })
})

describe('the two rungs the ladder was missing', () => {
  it('opens the classical age on technology and economy, and nothing else', () => {
    const started = evaluateEvents(
      world(EVENTS),
      makeMetrics({ technology: 36, economy: 4 }),
      1,
      0,
    ).started
    expect(started.map((r) => r.event)).toContain('era_classical')
  })

  it('keeps the classical age shut on a rich world that never learned anything', () => {
    const started = evaluateEvents(
      world(EVENTS),
      makeMetrics({ technology: 34, economy: 40 }),
      1,
      0,
    ).started
    expect(started.map((r) => r.event)).not.toContain('era_classical')
  })

  it('opens the electric age on technology and energy, and nothing else', () => {
    const started = evaluateEvents(
      world(EVENTS),
      makeMetrics({ technology: 76, energy: 7 }),
      1,
      0,
    ).started
    expect(started.map((r) => r.event)).toContain('era_electric')
  })

  it('keeps the electric age shut on a learned world that never lit a lamp', () => {
    const started = evaluateEvents(
      world(EVENTS),
      makeMetrics({ technology: 99, energy: 5 }),
      1,
      0,
    ).started
    expect(started.map((r) => r.event)).not.toContain('era_electric')
  })

  it('writes each rung into the bit its own name owns', () => {
    const outcome = evaluateEvents(
      world(EVENTS),
      makeMetrics({ technology: 76, economy: 4, energy: 7 }),
      1,
      0,
    )
    expect(outcome.eras & Era.classical).toBe(Era.classical)
    expect(outcome.eras & Era.electric).toBe(Era.electric)
  })
})

// FEAT: a obra move coeficiente desde a camada permanente, então ela tem voz na cadeia causal
describe('the works in the causal chain', () => {
  const chemistry = workIndex('chemistry')
  const dying = makeMetrics({ environment: 20 })
  const crisis = (s: WorldState) =>
    evaluateEvents(s, dying, 1, 30).started.find((r) => r.event === 'ecological_crisis')?.causes

  it('names a completed work as the cause of the crisis its effect caused', () => {
    const s = world(EVENTS, { works: [{ def: chemistry, done: 40, record: 12 }] })
    expect(crisis(s)).toContainEqual({ kind: 'event', record: 12 })
  })

  // FEAT: a marca da obra não expira, então ela não tem janela causal como a decisão tem
  it('still names the work a thousand years after it was finished', () => {
    const s = world(EVENTS, { tick: 3000, works: [{ def: chemistry, done: 40, record: 12 }] })
    expect(crisis(s)).toContainEqual({ kind: 'event', record: 12 })
  })

  // FIX: o reator move a energia, e a poluição é proporcional à energia — a obra que destruiu a
  // biosfera tem de ser nomeada por ela, como a fatia de indústria já era pelo mesmo caminho
  it('names the reactor for the biosphere its energy destroyed', () => {
    const s = world(EVENTS, { works: [{ def: workIndex('reactor'), done: 40, record: 12 }] })
    expect(crisis(s)).toContainEqual({ kind: 'event', record: 12 })
  })

  it('blames a work only for what it touched', () => {
    const granary = workIndex('granary')
    const s = world(EVENTS, { works: [{ def: granary, done: 40, record: 12 }] })
    expect(crisis(s)?.some((cause) => cause.kind === 'event')).toBe(false)
  })

  // FEAT: `smoke` acima de 1 é mais poluição, então a chave empurra o ambiente para baixo — e a obra
  // de mitigação, cujo fator fica ABAIXO de 1, nunca é culpada pela crise que ela veio segurar
  // FEAT: nenhuma obra do catálogo fuma MAIS, e o único evento sobre ambiente rompe para baixo, então
  // hoje a direção desta chave não é observável na culpa: a tabela a declara para quando for
  it('never blames the mitigation ladder for the crisis it was built to hold back', () => {
    for (const id of ['reforestation', 'filters', 'cleanGrid', 'closedCycle'] as const) {
      const s = world(EVENTS, { works: [{ def: workIndex(id), done: 40, record: 12 }] })
      expect(
        crisis(s)?.some((cause) => cause.kind === 'event'),
        id,
      ).toBe(false)
    }
  })

  // FIX: e só para o lado do rompimento — uma obra que empurra a métrica para o lado bom não é
  // causa da quebra dela, senão toda crise vira culpa das melhorias que vieram antes
  const named = (works: readonly Work[], metrics: Metrics, event: EventId, seed = 1) =>
    evaluateEvents(world(EVENTS, { works }), metrics, seed, 30)
      .started.find((r) => r.event === event)
      ?.causes.filter((cause) => cause.kind === 'event').length ?? -1

  // FEAT: a epidemia só dispara em 8% dos sorteios, então a varredura procura a semente que a abre
  const namedOnce = (works: readonly Work[], metrics: Metrics, event: EventId) => {
    for (let seed = 1; seed < 200; seed++) {
      const count = named(works, metrics, event, seed)
      if (count >= 0) return count
    }
    throw new Error(`${event} never fired`)
  }

  it('never blames the healers for the die-off they spent centuries delaying', () => {
    const healers = ['aqueduct', 'sanitation', 'medicine'] as const
    const works = healers.map((id, i) => ({ def: workIndex(id), done: 40, record: 12 + i }))
    expect(named(works, makeMetrics({ population: 500 }), 'extinction')).toBe(0)
  })

  // FIX: a razão de energia multiplica o alvo no denominador enquanto o nível ainda é o velho —
  // construir o reator abre a falta, e a frase verdadeira é "você o ergueu e não tinha como enchê-lo"
  const short = makeMetrics({ energyRatio: 0.5, economyTrend: 0.95 })

  it('names the reactor for the shortfall its own grid could not yet feed', () => {
    const works = [{ def: workIndex('reactor'), done: 40, record: 12 }]
    expect(named(works, short, 'energy_crisis')).toBe(1)
  })

  // FIX: o estaleiro fica fora: medido, ele moveu o alvo em zero nas histórias sem frota e em 1e-9
  // nas com frota pequena, contra um vão de 0,246 — o coeficiente dele multiplica uma soma vazia
  it('never names the shipyard for it: its coefficient multiplies an empty sum', () => {
    const works = [{ def: workIndex('shipyard'), done: 40, record: 12 }]
    expect(named(works, short, 'energy_crisis')).toBe(0)
  })

  it('never names a work that leaves the energy ratio alone', () => {
    const quiet = ['irrigation', 'granary', 'writing', 'medicine'] as const
    const works = quiet.map((id, i) => ({ def: workIndex(id), done: 40, record: 12 + i }))
    expect(named(works, short, 'energy_crisis')).toBe(0)
  })

  // FEAT: a fome malthusiana da irrigação é real e de segunda ordem, e esta engine não a modela —
  // fica de fora de propósito, porque uma causa faltando é lacuna e uma causa errada é mentira
  it('never blames the irrigation for the famine, and leaves that gap on purpose', () => {
    const works = [{ def: workIndex('irrigation'), done: 40, record: 12 }]
    expect(named(works, makeMetrics({ foodSecurity: 0.5 }), 'famine')).toBe(0)
  })

  it('still names the irrigation for the revolution its food opened', () => {
    const works = [{ def: workIndex('irrigation'), done: 40, record: 12 }]
    const fed = makeMetrics({ technology: 25, foodSecurity: 1.5 })
    expect(named(works, fed, 'agricultural_revolution')).toBe(1)
  })

  // FEAT: a frase, medida numa história de verdade em vez de num mapa: o mundo fecha o reator e a
  // crise de energia que vem atrás nomeia o reator, e nenhuma fome da mesma história nomeia obra
  it('names the reactor in a history that built it and then ran short of energy', () => {
    const w = new Worldline(1)
    // FIX: cinco mil anos porque o foguete agora custa séculos, e nesta alocação o reator só fecha
    // em 4845 — o horizonte antigo de 2.800 parava a história antes da obra que a frase mede
    for (let year = 0; year < 5000 && !w.ended; year++) {
      const next = w.present.building
        ? undefined
        : WORKS.find((_, def) => isCommissionable(w.present, def))
      if (next) w.commission(next.id)
      w.advance(1)
    }
    const reactor = w.present.works.find((work) => WORKS[work.def]?.id === 'reactor')
    if (!reactor) throw new Error('the history must build the reactor')
    const crisis = w.records.find((r) => r.event === 'energy_crisis' && r.start > reactor.done)
    // FIX: a lei é a ordem e a proximidade, nunca o ano exato: a razão de energia cai no ano seguinte
    // ao reator, mas a crise pede também que a economia vire, e o ano em que as duas coincidem varia
    expect(crisis).toBeDefined()
    expect(crisis?.start).toBeGreaterThan(reactor.done)
    expect(crisis?.start).toBeLessThanOrEqual(reactor.done + 5)
    expect(crisis?.causes).toContainEqual({ kind: 'event', record: reactor.record })

    const built = new Set(w.present.works.map((work) => work.record))
    const lies = ['famine', 'extinction', 'collapse', 'epidemic', 'civil_unrest'] as const
    let counted = 0
    for (const record of w.records) {
      if (!lies.some((event) => event === record.event)) continue
      counted++
      expect(
        record.causes.some((c) => c.kind === 'event' && built.has(c.record)),
        record.event,
      ).toBe(false)
    }
    expect(counted).toBeGreaterThan(10)
  })

  // FEAT: uma chave cega é cega nos DOIS lados — a obra que só move variância (o calendário) ou só
  // o preço da frota (o estaleiro) não é causa de acontecimento nenhum, em direção nenhuma
  it('never names a work whose only effect is a blind one, whatever breaks', () => {
    const sweep = (id: WorkId) => {
      const works = [{ def: workIndex(id), done: 40, record: 12 }]
      let count = 0
      for (const def of EVENTS) {
        const breached = { ...makeMetrics() } as Record<Metric, number>
        for (const c of def.trigger)
          breached[c.metric] = c.op === '<' ? c.value / 2 : c.value * 2 + 1
        for (const record of evaluateEvents(world(EVENTS, { works }), breached as Metrics, 1, 30)
          .started) {
          count += record.causes.filter((c) => c.kind === 'event' && c.record === 12).length
        }
      }
      return count
    }
    expect(sweep('calendar')).toBe(0)
    expect(sweep('shipyard')).toBe(0)
    // FEAT: e a varredura está viva, porque a química é nomeada por ela
    expect(sweep('chemistry')).toBeGreaterThan(0)
  })

  // FEAT: a obra que fechou neste ano só move coeficiente no ano seguinte, então não é causa hoje
  it('never names a work finished this very year', () => {
    const today = world(EVENTS, { works: [{ def: chemistry, done: 100, record: 12 }] })
    expect(today.tick).toBe(100)
    expect(crisis(today)?.some((cause) => cause.kind === 'event')).toBe(false)
    const yesterday = world(EVENTS, { works: [{ def: chemistry, done: 99, record: 12 }] })
    expect(crisis(yesterday)).toContainEqual({ kind: 'event', record: 12 })
  })

  // FEAT: o teto, com as trinta e duas obras de pé: a era espacial nomeia as dezessete que empurraram
  // os três portões dela para cima, e as mentiras seguem valendo zero
  it('bounds how many works one record can ever name', () => {
    const all = WORKS.map((_, def) => ({ def, done: 40, record: 100 + def }))
    const climbed = Era.agricultural | Era.classical | Era.industrial | Era.electric
    const s = world(EVENTS, { works: all, eras: climbed })
    const reached = evaluateEvents(
      s,
      makeMetrics({ technology: 95, energy: 20, economy: 12 }),
      1,
      0,
    )
    const era = reached.started.find((r) => r.event === 'space_era')
    expect(reached.started.map((r) => r.event)).toEqual(['space_era'])
    expect(era?.causes.filter((cause) => cause.kind === 'event')).toHaveLength(17)
    expect(era?.causes).toHaveLength(20)

    // FEAT: as três que levantam o alvo respondem pela falta, e mais nenhuma
    expect(named(all, short, 'energy_crisis')).toBe(3)

    // FIX: epidemic entra na lista porque inverter `capacity` faria o aqueduto e a arcologia —
    // obras que só levantam a lotação possível — causarem a epidemia por superlotação
    for (const event of [
      'famine',
      'extinction',
      'recession',
      'civil_unrest',
      'epidemic',
    ] as const) {
      const def = EVENTS.find((d) => d.id === event)
      if (!def) throw new Error(`missing ${event}`)
      const breached = { ...makeMetrics() } as Record<Metric, number>
      for (const c of def.trigger) breached[c.metric] = c.op === '<' ? c.value / 2 : c.value * 2 + 1
      expect(namedOnce(all, breached as Metrics, event), event).toBe(0)
    }
  })

  it('names the works slice of a recent decision, because the slice now moves metrics', () => {
    const s = world(EVENTS, { lastDecision: { tick: 100 - CAUSAL_WINDOW, sectors: ['works'] } })
    expect(crisis(s)).toContainEqual({
      kind: 'decision',
      tick: 100 - CAUSAL_WINDOW,
      sectors: ['works'],
    })
  })

  it('gives the work receipt the metrics the catalogue moves', () => {
    const receipt = EVENTS.find((def) => def.id === 'work_done')
    expect(receipt?.influences).toContain('environment')
    expect(receipt?.influences).toContain('foodSecurity')
    expect(receipt?.influences).not.toContain('paradoxActive')
  })

  // FEAT: vazio só é correto onde um fim não propaga para lugar nenhum
  it('leaves influences empty only on the terminal events', () => {
    for (const def of EVENTS) {
      if (def.influences.length === 0) expect(def.kind, def.id).toBe('terminal')
    }
  })
})

describe('EVENTS table', () => {
  it('is internally consistent', () => {
    expect(EVENTS.map((d) => d.id)).toEqual([...EVENT_IDS])
    const eraBits = EVENTS.flatMap((d) => (d.era === undefined ? [] : [d.era]))
    expect(new Set(eraBits).size).toBe(eraBits.length)
    for (const def of EVENTS) {
      if (def.kind === 'condition') expect(def.release?.length).toBeGreaterThan(0)
      if (def.kind === 'pulse') expect(def.duration).toBeGreaterThan(0)
      if (def.kind === 'era') expect(def.era).toBeDefined()
      for (const id of [...(def.excludes ?? []), ...(def.interrupts ?? [])]) {
        expect(EVENT_IDS).toContain(id)
      }
    }
  })
})
