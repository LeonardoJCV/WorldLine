import { describe, expect, it } from 'vitest'
import {
  EVENTS,
  EVENT_IDS,
  collectModifiers,
  computeMetrics,
  evaluateEvents,
  type EventDef,
} from './events.ts'
import { NEUTRAL_MODIFIERS, derive } from './rules.ts'
import { Era, NEVER, type WorldState } from './state.ts'
import { TEST_WORLD, makeMetrics, makeState } from './testing.ts'

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
