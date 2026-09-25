import { describe, expect, it } from 'vitest'
import type { Debt } from './debt.ts'
import { mergeStates, mergeWeights, settleDebts, type Merge } from './merge.ts'
import { INHERIT_SHOCK, MERGE_SHOCK } from './params.ts'
import { VARIABLES, type Variable, type WorldState } from './state.ts'
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

describe('mergeWeights', () => {
  it('weighs each history by its people', () => {
    expect(mergeWeights(3_000_000, 1_000_000)).toEqual({ a: 0.75, b: 0.25 })
  })

  it('splits evenly when nobody is left on either side', () => {
    // FEAT: na prática as duas estão vivas, mas uma média ponderada deste motor nunca divide por zero
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
    // FEAT: a costura é comutativa nas variáveis; quem sobrevive muda a letra, não a aritmética
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
    // FEAT: a dívida mais velha é a que manda no prazo, então é o ano dela que fica
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
    // FEAT: a herança apaga tudo porque custa um planeta; aqui não custa, e apagar seria a saída grátis
    const merged = mergeStates(
      world({ debts: [debt({ owed: 60, origin: 'C' })], strain: 9 }),
      incoming({}),
    )
    expect(merged.debts).not.toEqual([])
    expect(merged.strain).toBe(9)
  })
})
