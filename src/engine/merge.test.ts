import { describe, expect, it } from 'vitest'
import type { Colony } from './colony.ts'
import type { Debt } from './debt.ts'
import { mergeColonies, mergeStates, mergeWeights, settleDebts, type Merge } from './merge.ts'
import { INHERIT_SHOCK, MERGE_SHOCK } from './params.ts'
import { NEVER, VARIABLES, type Variable, type WorldState } from './state.ts'
import { makeState } from './testing.ts'

function world(overrides: Partial<WorldState> = {}): WorldState {
  return makeState(overrides)
}

function incoming(values: Partial<Record<Variable, number>>, rest: Partial<Merge> = {}): Merge {
  const full = {} as Record<Variable, number>
  for (const variable of VARIABLES) full[variable] = values[variable] ?? 0
  return { tick: 0, self: 'A', other: 'B', direction: 'in', natal: 0, values: full, ...rest }
}

function debt(overrides: Partial<Debt> = {}): Debt {
  return { kind: 'resource', owed: 10, since: 0, origin: 'C', ...overrides }
}

function colony(overrides: Partial<Colony> = {}): Colony {
  return { body: 3, founded: 0, population: 1000, support: 0, record: 0, ...overrides }
}

describe('mergeWeights', () => {
  it('weighs each history by its people', () => {
    expect(mergeWeights(3_000_000, 1_000_000)).toEqual({ a: 0.75, b: 0.25 })
  })

  it('splits evenly when nobody is left on either side', () => {
    expect(mergeWeights(0, 0)).toEqual({ a: 0.5, b: 0.5 })
  })
})

describe('mergeStates', () => {
  it('adds the people and the granary, because those are things and not qualities', () => {
    const merged = mergeStates(
      world({ population: 3_000_000, food: 500_000 }),
      incoming({ population: 1_000_000, food: 200_000 }),
    )
    expect(merged.population).toBe(4_000_000)
    expect(merged.food).toBe(700_000)
  })

  it('blends the levels by how many people each history brings', () => {
    const merged = mergeStates(
      world({ population: 3_000_000, technology: 90, economy: 12, energy: 8, environment: 40 }),
      incoming({ population: 1_000_000, technology: 50, economy: 4, energy: 4, environment: 80 }),
    )
    expect(merged.technology).toBeCloseTo(80)
    expect(merged.economy).toBeCloseTo(10)
    expect(merged.energy).toBeCloseTo(7)
    expect(merged.environment).toBeCloseTo(50)
  })

  it('never lets a level leave its range, however lopsided the seam', () => {
    for (const [pa, pb] of [
      [1, 10_000_000],
      [10_000_000, 1],
      [0, 0],
    ] as const) {
      const merged = mergeStates(
        world({ population: pa, technology: 100, environment: 0, stability: 100 }),
        incoming({ population: pb, technology: 0, environment: 100, stability: 0 }),
      )
      for (const variable of ['technology', 'economy', 'environment', 'stability'] as const) {
        expect(merged[variable]).toBeGreaterThanOrEqual(0)
        expect(merged[variable]).toBeLessThanOrEqual(100)
      }
    }
  })

  it('shakes the stability, and by less than losing a whole planet does', () => {
    const merged = mergeStates(
      world({ population: 1_000, stability: 80 }),
      incoming({ population: 1_000, stability: 80 }),
    )
    expect(merged.stability).toBeCloseTo(80 - MERGE_SHOCK)
    expect(MERGE_SHOCK).toBeLessThan(INHERIT_SHOCK)
  })

  it('keeps the shaken stability off the floor instead of going negative', () => {
    expect(mergeStates(world({ stability: 2 }), incoming({ stability: 2 })).stability).toBe(0)
  })

  it('leaves the year, the allocation and the eras of the receiving history alone', () => {
    const before = world({ tick: 1450, eras: 7 })
    const merged = mergeStates(before, incoming({}))
    expect(merged.tick).toBe(before.tick)
    expect(merged.eras).toBe(before.eras)
    expect(merged.allocation).toEqual(before.allocation)
  })

  it('is the same seam whichever order the two histories are named', () => {
    const a = world({ population: 3_000_000, technology: 90 })
    const b = { population: 1_000_000, technology: 50 }
    const left = mergeStates(a, incoming(b))
    const right = mergeStates(
      world({ population: b.population, technology: b.technology }),
      incoming({ population: a.population, technology: a.technology }),
    )
    expect(left.technology).toBeCloseTo(right.technology)
    expect(left.population).toBe(right.population)
  })
})

describe('settleDebts', () => {
  it('drops what the two owed each other, because it became internal', () => {
    const own = [debt({ owed: 40, origin: 'B' })]
    const theirs = [debt({ owed: 25, origin: 'A' })]
    expect(settleDebts(own, theirs, ['A', 'B'])).toEqual([])
  })

  it('keeps what either owed a third history, and adds the two together', () => {
    const own = [debt({ kind: 'knowledge', owed: 60, origin: 'C', since: 1200 })]
    const theirs = [debt({ kind: 'knowledge', owed: 10, origin: 'C', since: 900 })]
    const settled = settleDebts(own, theirs, ['A', 'B'])
    expect(settled).toHaveLength(1)
    expect(settled[0]?.owed).toBe(70)
    expect(settled[0]?.since).toBe(900)
  })

  it('does not blend two debts of different kinds to the same history', () => {
    const own = [debt({ kind: 'knowledge', owed: 60, origin: 'C' })]
    const theirs = [debt({ kind: 'resource', owed: 10, origin: 'C' })]
    expect(settleDebts(own, theirs, ['A', 'B'])).toHaveLength(2)
  })

  it('settles the mutual part and keeps the third-party part in the same seam', () => {
    const own = [debt({ owed: 40, origin: 'B' }), debt({ owed: 60, origin: 'C' })]
    const theirs = [debt({ owed: 25, origin: 'A' }), debt({ owed: 10, origin: 'C' })]
    const settled = settleDebts(own, theirs, ['A', 'B'])
    expect(settled.map((d) => d.origin)).toEqual(['C'])
    expect(settled[0]?.owed).toBe(70)
  })
})

describe('mergeStates, the ledger', () => {
  it('takes the paradox whose deadline comes first, because that is the one that kills', () => {
    const merged = mergeStates(
      world({ paradox: { kind: 'debt', since: 1000, deadline: 1200 } }),
      incoming({}, { paradox: { kind: 'leap', since: 1050, deadline: 1150 } }),
    )
    expect(merged.paradox?.deadline).toBe(1150)
    expect(merged.paradox?.kind).toBe('leap')
  })

  it('keeps the only paradox there is when one side has none', () => {
    const p = { kind: 'debt', since: 1000, deadline: 1200 } as const
    expect(mergeStates(world({ paradox: p }), incoming({}, { paradox: null })).paradox).toEqual(p)
    expect(mergeStates(world({ paradox: null }), incoming({}, { paradox: p })).paradox).toEqual(p)
  })

  it('carries the worse strain of the two', () => {
    expect(mergeStates(world({ strain: 12 }), incoming({}, { strain: 40 })).strain).toBe(40)
    expect(mergeStates(world({ strain: 40 }), incoming({}, { strain: 12 })).strain).toBe(40)
  })

  it('lets both sets of echoes arrive, because they are effects already in flight', () => {
    const mine = [{ target: 'technology', remaining: 3 }] as const
    const theirs = [{ target: 'food', remaining: 5 }] as const
    const merged = mergeStates(world({ echoes: mine }), incoming({}, { echoes: theirs }))
    expect(merged.echoes).toHaveLength(2)
  })

  it('does not wipe the ledger the way inheritance does', () => {
    const merged = mergeStates(
      world({ debts: [debt({ owed: 60, origin: 'C' })], strain: 9 }),
      incoming({}),
    )
    expect(merged.debts).not.toEqual([])
    expect(merged.strain).toBe(9)
  })
})

describe('mergeStates, homes', () => {
  it('adds the people when both histories live on the same body', () => {
    const merged = mergeStates(
      world({ population: 3_000_000, home: null }),
      incoming({ population: 1_000_000 }, { home: null }),
    )
    expect(merged.population).toBe(4_000_000)
    expect(merged.home).toBeNull()
    expect(merged.colonies).toEqual([])
  })

  it('treats null and the shared natal index as the same home', () => {
    const merged = mergeStates(
      world({ population: 3_000_000, home: null }),
      incoming({ population: 1_000_000 }, { natal: 7, home: 7 }),
    )
    expect(merged.population).toBe(4_000_000)
    expect(merged.colonies).toEqual([])
  })

  it('moves the lighter history home into a colony instead of inventing people', () => {
    const merged = mergeStates(
      world({ population: 3_000_000, home: null }),
      incoming({ population: 1_000_000 }, { home: 5 }),
    )
    expect(merged.home).toBeNull()
    expect(merged.population).toBe(3_000_000)
    const moved = merged.colonies.find((colony) => colony.body === 5)
    expect(moved?.population).toBe(1_000_000)
    expect(moved?.support).toBe(1)
  })

  it('conserves the people whichever way the homes fall', () => {
    for (const [ha, hb] of [
      [null, null],
      [null, 5],
      [5, null],
      [2, 4],
    ] as const) {
      const merged = mergeStates(
        world({ population: 3_000_000, home: ha }),
        incoming({ population: 1_000_000 }, { home: hb }),
      )
      const total = merged.population + merged.colonies.reduce((sum, c) => sum + c.population, 0)
      expect(total).toBe(4_000_000)
    }
  })

  it('lives where the heavier history lived, not where the receiving one did', () => {
    const merged = mergeStates(
      world({ population: 1_000_000, home: 2 }),
      incoming({ population: 9_000_000 }, { home: 4 }),
    )
    expect(merged.home).toBe(4)
    expect(merged.population).toBe(9_000_000)
    expect(merged.colonies.find((c) => c.body === 2)?.population).toBe(1_000_000)
  })

  it('folds a foreign colony into the population instead of leaving it on the body that becomes home', () => {
    const merged = mergeStates(
      world({ population: 3_000_000, home: 2, colonies: [] }),
      incoming(
        { population: 1_000_000 },
        { home: 4, colonies: [colony({ body: 2, population: 50_000, support: 0.6 })] },
      ),
    )
    expect(merged.home).toBe(2)
    expect(merged.population).toBe(3_050_000)
    expect(merged.colonies.find((c) => c.body === 2)).toBeUndefined()
    expect(merged.colonies.find((c) => c.body === 4)?.population).toBe(1_000_000)
  })

  it('never lets a colony crossing the seam alone carry a causal record into the survivor', () => {
    const merged = mergeStates(
      world({ population: 3_000_000, home: null }),
      incoming({ population: 1_000_000 }, { home: 5, colonies: [colony({ body: 7, record: 9 })] }),
    )
    expect(merged.colonies.find((c) => c.body === 7)?.record).toBe(NEVER)
  })
})

describe('mergeColonies', () => {
  it('joins the two fleets', () => {
    const merged = mergeColonies([colony({ body: 1 })], [colony({ body: 4 })], { a: 0.5, b: 0.5 })
    expect(merged.map((c) => c.body).sort()).toEqual([1, 4])
  })

  it('adds the settlers and blends the support where both settled one body', () => {
    const merged = mergeColonies(
      [colony({ body: 4, population: 300_000, support: 0.9 })],
      [colony({ body: 4, population: 100_000, support: 0.5 })],
      { a: 0.75, b: 0.25 },
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.population).toBe(400_000)
    expect(merged[0]?.support).toBeCloseTo(0.8)
  })

  it('keeps the older founding year when two colonies become one', () => {
    const merged = mergeColonies(
      [colony({ body: 4, founded: 2200 })],
      [colony({ body: 4, founded: 1900 })],
      { a: 0.5, b: 0.5 },
    )
    expect(merged[0]?.founded).toBe(1900)
  })

  it('orders the fleet by body so the same seam always reads the same', () => {
    const merged = mergeColonies([colony({ body: 4 })], [colony({ body: 1 })], { a: 0.5, b: 0.5 })
    expect(merged.map((c) => c.body)).toEqual([1, 4])
  })

  it('never keeps a record that points into the other side, native or merged', () => {
    const solo = mergeColonies([], [colony({ body: 4, record: 9 })], { a: 0.5, b: 0.5 })
    expect(solo[0]?.record).toBe(NEVER)

    const incomingOlder = mergeColonies(
      [colony({ body: 4, founded: 2200, record: 1 })],
      [colony({ body: 4, founded: 1900, record: 9 })],
      { a: 0.5, b: 0.5 },
    )
    expect(incomingOlder[0]?.record).toBe(NEVER)

    const ownOlder = mergeColonies(
      [colony({ body: 4, founded: 1900, record: 1 })],
      [colony({ body: 4, founded: 2200, record: 9 })],
      { a: 0.5, b: 0.5 },
    )
    expect(ownOlder[0]?.record).toBe(1)
  })
})
