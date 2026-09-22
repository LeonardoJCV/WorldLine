import { describe, expect, it } from 'vitest'
import { causalDistance } from '../../engine/distance.ts'
import { crossingAmounts, crossingCost, DOSES } from '../../engine/crossing.ts'
import type { Status, Variable } from '../../engine/state.ts'
import { MAX_WORLDLINES, type Snapshot } from '../../worker/protocol.ts'
import { crossBlock, crossQuote, DOSES_FOR, type CrossBlockInput } from './cross.ts'

function snapshot(
  values: Partial<Record<Variable, number>> = {},
  status: Status = 'running',
): Snapshot {
  return {
    tick: 100,
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
    worlds: 2,
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
    expect(crossBlock(baseInput({ worlds: 1, origin: null }))).toEqual({
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
    expect(crossBlock(baseInput({ cursor: 50, worlds: MAX_WORLDLINES }))).toEqual({
      key: 'cross.limit',
      params: {},
    })
  })

  it('allows a past crossing under the worldline limit', () => {
    expect(crossBlock(baseInput({ cursor: 50, worlds: MAX_WORLDLINES - 1 }))).toBeNull()
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
    expect(crossBlock(baseInput({ worlds: 2, originEnded: true, destinationEnded: true }))).toEqual(
      { key: 'cross.originExtinct', params: {} },
    )
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
          worlds: 1,
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
          worlds: MAX_WORLDLINES,
          credit: 0,
        }),
      ),
    ).toEqual({ key: 'cross.destinationEnded', params: {} })
  })

  it('prioritises people-only-now over the worldline limit and over credit', () => {
    expect(
      crossBlock(baseInput({ kind: 'people', cursor: 50, worlds: MAX_WORLDLINES, credit: 0 })),
    ).toEqual({ key: 'cross.peopleOnlyNow', params: {} })
  })

  it('prioritises the worldline limit over insufficient credit', () => {
    expect(crossBlock(baseInput({ cursor: 50, worlds: MAX_WORLDLINES, credit: 0 }))).toEqual({
      key: 'cross.limit',
      params: {},
    })
  })
})
