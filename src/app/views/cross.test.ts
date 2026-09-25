import { describe, expect, it } from 'vitest'
import { causalDistance } from '../../engine/distance.ts'
import { crossingAmounts, crossingCost, DOSES, type Crossing } from '../../engine/crossing.ts'
import type { EventId, EventRecord } from '../../engine/events.ts'
import { HORIZON } from '../../engine/params.ts'
import type { Decision, Status, Variable } from '../../engine/state.ts'
import { MAX_WORLDLINES, type Snapshot, type WorldlineId } from '../../worker/protocol.ts'
import {
  crossBlock,
  crossCarriesPreviousAllocation,
  crossOrigins,
  crossQuote,
  DOSES_FOR,
  historyRows,
  streamClick,
  worldEnded,
  type CrossBlockInput,
} from './cross.ts'

function snapshot(
  values: Partial<Record<Variable, number>> = {},
  status: Status = 'running',
  tick = 100,
): Snapshot {
  return {
    tick,
    values: {
      population: 1_000,
      food: 500,
      energy: 5,
      technology: 20,
      economy: 5,
      environment: 60,
      stability: 60,
      ...values,
    },
    previous: null,
    eras: 0,
    active: [],
    allocation: { agriculture: 25, industry: 25, research: 25, conservation: 25 },
    status,
    home: null,
  }
}

const origin = snapshot({ technology: 40, population: 2_000 })
const destination = snapshot({ technology: 10, population: 500, food: 100 })

function baseInput(overrides: Partial<CrossBlockInput> = {}): CrossBlockInput {
  return {
    kind: 'knowledge',
    dose: 1,
    cursor: null,
    credit: 100,
    usableOrigins: 1,
    totalWorlds: 2,
    origin,
    destination,
    originEnded: false,
    destinationEnded: false,
    ...overrides,
  }
}

describe('DOSES_FOR', () => {
  it('offers only dose 1 for doctrine, because its effect does not scale with dose', () => {
    expect(DOSES_FOR('doctrine')).toEqual([1])
  })

  it('offers every dose for knowledge, resource and people', () => {
    expect(DOSES_FOR('knowledge')).toEqual(DOSES)
    expect(DOSES_FOR('resource')).toEqual(DOSES)
    expect(DOSES_FOR('people')).toEqual(DOSES)
  })
})

function world(id: WorldlineId, present: Snapshot) {
  return { info: { id }, present }
}

describe('worldEnded', () => {
  it('counts an extinct worldline as ended', () => {
    expect(worldEnded(snapshot({}, 'extinct'))).toBe(true)
  })

  it('counts a collapsed worldline as ended, so it is never offered as an end of a crossing', () => {
    expect(worldEnded(snapshot({}, 'collapsed'))).toBe(true)
  })

  it('counts a worldline that reached the horizon as ended', () => {
    expect(worldEnded(snapshot({}, 'running', HORIZON))).toBe(true)
  })

  it('counts a living worldline short of the horizon as alive', () => {
    expect(worldEnded(snapshot({}, 'running', HORIZON - 1))).toBe(false)
  })
})

describe('crossOrigins', () => {
  const alive = snapshot()
  const dead = snapshot({}, 'extinct')

  it('drops the destination itself and every worldline that has ended', () => {
    const worlds = [world('A', alive), world('B', dead), world('C', alive)]
    expect(crossOrigins(worlds, 'C').map((candidate) => candidate.info.id)).toEqual(['A'])
  })

  it('leaves nothing to choose when the only other worldline is extinct', () => {
    expect(crossOrigins([world('A', alive), world('B', dead)], 'A')).toEqual([])
  })

  it('refuses the crossing for want of a worldline, not for want of a choice', () => {
    const worlds = [world('A', alive), world('B', dead)]
    const usable = crossOrigins(worlds, 'A')
    expect(
      crossBlock(
        baseInput({ usableOrigins: usable.length, totalWorlds: worlds.length, origin: null }),
      ),
    ).toEqual({
      key: 'cross.needsWorlds',
      params: {},
    })
  })

  it('regression: a lone extinct worldline among six does not undercount the past-crossing cap (C1)', () => {
    // FIX: a origem só conta quem está vivo, mas o teto de seis conta toda worldline, viva ou não
    const worlds = [
      world('A', alive),
      world('B', alive),
      world('C', alive),
      world('D', alive),
      world('E', dead),
      world('F', alive),
    ]
    const usable = crossOrigins(worlds, 'F')
    expect(usable.length).toBe(4)
    expect(
      crossBlock(
        baseInput({
          cursor: 50,
          usableOrigins: usable.length,
          totalWorlds: worlds.length,
          origin: usable[0]?.present ?? null,
        }),
      ),
    ).toEqual({ key: 'cross.limit', params: {} })
  })
})

describe('streamClick', () => {
  const alive = snapshot()
  const dead = snapshot({}, 'extinct')

  it('sets the origin when the stream clicked is a living worldline in cross mode', () => {
    const worlds = [world('A', alive), world('B', alive)]
    expect(streamClick('cross', 'A', 'B', worlds)).toBe('origin')
  })

  it('falls back to focus when the stream clicked has ended, so it stays reachable', () => {
    const worlds = [world('A', dead), world('B', alive)]
    expect(streamClick('cross', 'A', 'B', worlds)).toBe('focus')
  })

  it('always focuses outside cross mode, even for a living worldline', () => {
    const worlds = [world('A', alive), world('B', alive)]
    expect(streamClick('observe', 'A', 'B', worlds)).toBe('focus')
    expect(streamClick('intervene', 'A', 'B', worlds)).toBe('focus')
  })
})

describe('crossQuote', () => {
  it('costs and carries the same as the host, for the same states', () => {
    const distance = causalDistance(origin.values, destination.values)
    const quote = crossQuote({ kind: 'knowledge', dose: 2, origin, destination })
    expect(quote.cost).toBe(crossingCost('knowledge', 2, distance))
    expect(quote.amounts).toEqual(crossingAmounts('knowledge', 2, origin.values))
  })

  it('prices doctrine as 1 × (1 + distance), unaffected by dose', () => {
    const distance = causalDistance(origin.values, destination.values)
    const quote = crossQuote({ kind: 'doctrine', dose: 1, origin, destination })
    expect(quote.cost).toBe(Math.max(1, Math.ceil(1 * (1 + Math.min(1, distance)))))
    expect(quote.amounts).toEqual([])
  })
})

describe('crossBlock', () => {
  it('allows a crossing when nothing stands in the way', () => {
    expect(crossBlock(baseInput())).toBeNull()
  })

  it('blocks when there is no other worldline to cross with', () => {
    expect(crossBlock(baseInput({ usableOrigins: 0, origin: null }))).toEqual({
      key: 'cross.needsWorlds',
      params: {},
    })
  })

  it('blocks when no origin has been chosen yet', () => {
    expect(crossBlock(baseInput({ origin: null }))).toEqual({
      key: 'cross.pickOrigin',
      params: {},
    })
  })

  it('blocks when the origin worldline has ended', () => {
    expect(crossBlock(baseInput({ originEnded: true }))).toEqual({
      key: 'cross.originExtinct',
      params: {},
    })
  })

  it('blocks when the destination worldline has ended', () => {
    expect(crossBlock(baseInput({ destinationEnded: true }))).toEqual({
      key: 'cross.destinationEnded',
      params: {},
    })
  })

  it('blocks people crossing into a past year', () => {
    expect(crossBlock(baseInput({ kind: 'people', cursor: 50 }))).toEqual({
      key: 'cross.peopleOnlyNow',
      params: {},
    })
  })

  it('allows people crossing into the present', () => {
    expect(crossBlock(baseInput({ kind: 'people', cursor: null }))).toBeNull()
  })

  it('blocks a past crossing once the worldline limit is reached', () => {
    expect(crossBlock(baseInput({ cursor: 50, totalWorlds: MAX_WORLDLINES }))).toEqual({
      key: 'cross.limit',
      params: {},
    })
  })

  it('allows a past crossing under the worldline limit', () => {
    expect(crossBlock(baseInput({ cursor: 50, totalWorlds: MAX_WORLDLINES - 1 }))).toBeNull()
  })

  it('blocks when credit is not enough, and says how much is missing', () => {
    const distance = causalDistance(origin.values, destination.values)
    const cost = crossingCost('knowledge', 1, distance)
    const credit = cost - 1
    expect(crossBlock(baseInput({ credit }))).toEqual({
      key: 'cross.credit',
      params: { cost, missing: cost - credit },
    })
  })

  it('lets a crossing through once credit covers its exact cost', () => {
    const distance = causalDistance(origin.values, destination.values)
    const cost = crossingCost('knowledge', 1, distance)
    expect(crossBlock(baseInput({ credit: cost }))).toBeNull()
  })

  it('prioritises the reasons in a fixed order: origin extinct before insufficient credit', () => {
    expect(crossBlock(baseInput({ originEnded: true, credit: 0 }))).toEqual({
      key: 'cross.originExtinct',
      params: {},
    })
  })

  it('prioritises origin extinct over destination ended', () => {
    expect(
      crossBlock(baseInput({ usableOrigins: 1, originEnded: true, destinationEnded: true })),
    ).toEqual({ key: 'cross.originExtinct', params: {} })
  })

  it('prioritises pick-origin over origin extinct', () => {
    expect(crossBlock(baseInput({ origin: null, originEnded: true }))).toEqual({
      key: 'cross.pickOrigin',
      params: {},
    })
  })

  it('prioritises no-worldline over every other reason', () => {
    expect(
      crossBlock(
        baseInput({
          usableOrigins: 0,
          origin: null,
          originEnded: true,
          destinationEnded: true,
          credit: 0,
        }),
      ),
    ).toEqual({ key: 'cross.needsWorlds', params: {} })
  })

  it('prioritises destination ended over people-in-the-past and the worldline limit', () => {
    expect(
      crossBlock(
        baseInput({
          kind: 'people',
          cursor: 50,
          destinationEnded: true,
          totalWorlds: MAX_WORLDLINES,
          credit: 0,
        }),
      ),
    ).toEqual({ key: 'cross.destinationEnded', params: {} })
  })

  it('prioritises people-only-now over the worldline limit and over credit', () => {
    expect(
      crossBlock(baseInput({ kind: 'people', cursor: 50, totalWorlds: MAX_WORLDLINES, credit: 0 })),
    ).toEqual({ key: 'cross.peopleOnlyNow', params: {} })
  })

  it('prioritises the worldline limit over insufficient credit', () => {
    expect(crossBlock(baseInput({ cursor: 50, totalWorlds: MAX_WORLDLINES, credit: 0 }))).toEqual({
      key: 'cross.limit',
      params: {},
    })
  })
})

describe('crossCarriesPreviousAllocation', () => {
  const decisions: readonly Decision[] = [
    { tick: 10, allocation: { agriculture: 25, industry: 25, research: 25, conservation: 25 } },
  ]

  it('warns when a doctrine crossing lands on the exact year the origin just decided', () => {
    expect(crossCarriesPreviousAllocation('doctrine', 10, decisions)).toBe(true)
  })

  it('stays quiet when the origin decided a different year', () => {
    expect(crossCarriesPreviousAllocation('doctrine', 11, decisions)).toBe(false)
  })

  it('stays quiet for kinds other than doctrine, even on the same year', () => {
    expect(crossCarriesPreviousAllocation('knowledge', 10, decisions)).toBe(false)
  })

  it('stays quiet when there is no year to check', () => {
    expect(crossCarriesPreviousAllocation('doctrine', null, decisions)).toBe(false)
  })
})

describe('historyRows', () => {
  const record = (event: EventId, start: number): EventRecord => ({
    event,
    start,
    end: null,
    causes: [],
  })

  const crossing = (tick: number, overrides: Partial<Crossing> = {}): Crossing => ({
    tick,
    kind: 'knowledge',
    dose: 1,
    amounts: [1],
    origin: { world: 'A', tick },
    cost: 3,
    direction: 'in',
    ...overrides,
  })

  it('keeps the events newest first and the index each one has in the record list', () => {
    const events = [record('famine', 10), record('civil_unrest', 40), record('epidemic', 25)]
    expect(historyRows(events, [], 200)).toEqual([
      { kind: 'event', year: 40, index: 1, record: events[1] },
      { kind: 'event', year: 25, index: 2, record: events[2] },
      { kind: 'event', year: 10, index: 0, record: events[0] },
    ])
  })

  it('files a crossing by its year among the events', () => {
    const events = [record('famine', 10), record('epidemic', 60)]
    expect(historyRows(events, [crossing(30)], 200).map((row) => [row.kind, row.year])).toEqual([
      ['event', 60],
      ['crossing', 30],
      ['event', 10],
    ])
  })

  it('keeps the event of a year above the crossing of the same year', () => {
    const rows = historyRows([record('famine', 30)], [crossing(30)], 200)
    expect(rows.map((row) => row.kind)).toEqual(['event', 'crossing'])
  })

  it('carries the direction and the origin of each crossing', () => {
    const rows = historyRows(
      [],
      [crossing(30, { direction: 'out', origin: { world: 'C', tick: 5 } })],
      200,
    )
    expect(rows[0]).toMatchObject({ kind: 'crossing', year: 30 })
    expect(rows[0]?.kind === 'crossing' && rows[0].crossing.direction).toBe('out')
  })

  it('never returns more rows than the limit, keeping the most recent ones', () => {
    const events = Array.from({ length: 5 }, (_, i) => record('famine', i * 10))
    const rows = historyRows(events, [crossing(45)], 3)
    expect(rows.map((row) => row.year)).toEqual([45, 40, 30])
  })
})
