import { describe, expect, it } from 'vitest'
import {
  addDebt,
  circularParadox,
  debtOf,
  debtRatio,
  leapParadox,
  repay,
  resolveParadox,
  totalOwed,
  type Debt,
  type Paradox,
} from './debt.ts'
import { PARADOX_GRACE, PARADOX_PATIENCE, PARADOX_RATIO } from './params.ts'
import type { Derived } from './rules.ts'
import { Era } from './state.ts'
import type { Crossing } from './crossing.ts'
import { makeState } from './testing.ts'

function makeCrossing(overrides: Partial<Crossing> = {}): Crossing {
  return {
    tick: 100,
    kind: 'knowledge',
    dose: 1,
    amounts: [1],
    origin: { world: 'B', tick: 100 },
    cost: 9,
    direction: 'in',
    ...overrides,
  }
}

function makeDerived(overrides: Partial<Derived> = {}): Derived {
  return {
    labor: 5e5,
    clean: 0.2,
    capacity: 1e6,
    carryingCapacity: 9e5,
    foodProduction: 3e5,
    foodAvailable: 4e5,
    foodSecurity: 1.1,
    energyTarget: 1,
    pollution: 0.1,
    birthRate: 0.03,
    deathRate: 0.02,
    ...overrides,
  }
}

describe('debtOf', () => {
  it('never charges people: someone who arrives left somewhere else', () => {
    const crossing = makeCrossing({ kind: 'people', amounts: [1000] })
    expect(debtOf(crossing)).toBeNull()
  })

  it('charges knowledge, resource and doctrine at the crossing cost', () => {
    for (const kind of ['knowledge', 'resource', 'doctrine'] as const) {
      const crossing = makeCrossing({ kind, cost: 7, tick: 42, origin: { world: 'C', tick: 42 } })
      const debt = debtOf(crossing)
      expect(debt).toEqual({ kind, owed: 7, since: 42, origin: 'C' })
    }
  })
})

describe('addDebt', () => {
  it('sums debts of the same kind and origin, keeping the older since', () => {
    const first: Debt = { kind: 'knowledge', owed: 5, since: 100, origin: 'B' }
    const second: Debt = { kind: 'knowledge', owed: 3, since: 250, origin: 'B' }
    const result = addDebt([first], second)
    expect(result).toEqual([{ kind: 'knowledge', owed: 8, since: 100, origin: 'B' }])
  })

  it('keeps debts of the same kind separate when the origin differs', () => {
    const fromB: Debt = { kind: 'knowledge', owed: 5, since: 100, origin: 'B' }
    const fromC: Debt = { kind: 'knowledge', owed: 4, since: 120, origin: 'C' }
    const result = addDebt([fromB], fromC)
    expect(result).toEqual([fromB, fromC])
  })
})

describe('totalOwed / debtRatio', () => {
  it('is zero with an empty list', () => {
    expect(totalOwed([])).toBe(0)
    expect(debtRatio([], makeState())).toBe(0)
  })

  it('falls as the world grows (bigger economy, same debt, smaller ratio)', () => {
    const debts: Debt[] = [{ kind: 'knowledge', owed: 10, since: 0, origin: 'B' }]
    const small = debtRatio(debts, makeState({ economy: 1 }))
    const big = debtRatio(debts, makeState({ economy: 10 }))
    expect(big).toBeLessThan(small)
  })

  it('is never NaN, even at population zero', () => {
    const state = makeState({ population: 0, economy: 0 })
    expect(debtRatio([], state)).toBe(0)
    const debts: Debt[] = [{ kind: 'resource', owed: 4, since: 0, origin: 'B' }]
    expect(Number.isNaN(debtRatio(debts, state))).toBe(false)
    expect(Number.isFinite(debtRatio(debts, state))).toBe(true)
  })
})

describe('repay', () => {
  it('abates knowledge by the technology gain of the own research sector', () => {
    const debts: Debt[] = [{ kind: 'knowledge', owed: 5, since: 0, origin: 'B' }]
    const researching = makeState({
      allocation: { agriculture: 20, industry: 20, research: 60, conservation: 0 },
    })
    const idle = makeState({
      allocation: { agriculture: 60, industry: 20, research: 0, conservation: 20 },
    })
    const afterResearch = repay(debts, researching, makeDerived(), 1)
    const afterIdle = repay(debts, idle, makeDerived(), 1)
    expect(afterResearch[0]?.owed).toBeLessThan(debts[0]?.owed ?? 0)
    expect(afterIdle[0]?.owed).toBe(debts[0]?.owed)
  })

  it('abates resource by the surplus of food and energy above what the world needs', () => {
    const debts: Debt[] = [{ kind: 'resource', owed: 1, since: 0, origin: 'B' }]
    const surplus = repay(
      debts,
      makeState({ population: 1000, energy: 5 }),
      makeDerived({ foodAvailable: 1e8, energyTarget: 1 }),
      1,
    )
    const scarce = repay(
      debts,
      makeState({ population: 1000, energy: 0.1 }),
      makeDerived({ foodAvailable: 900, energyTarget: 1 }),
      1,
    )
    // FEAT: a fartura por si só já quita a dívida de 1 crédito
    expect(surplus.length).toBe(0)
    expect(scarce[0]?.owed).toBe(1)
  })

  it('abates doctrine by each year kept, but not the year it arrives', () => {
    const debts: Debt[] = [{ kind: 'doctrine', owed: 1, since: 10, origin: 'B' }]
    const sameYear = repay(debts, makeState(), makeDerived(), 10)
    expect(sameYear[0]?.owed).toBe(1)
    const nextYear = repay(debts, makeState(), makeDerived(), 11)
    expect(nextYear[0]?.owed ?? 0).toBeLessThan(1)
  })

  it('drops a debt below DEBT_EPSILON from the list', () => {
    const debts: Debt[] = [{ kind: 'doctrine', owed: 1e-9, since: 0, origin: 'B' }]
    expect(repay(debts, makeState(), makeDerived(), 5)).toEqual([])
  })

  it('never goes negative, however large the repayment', () => {
    const debts: Debt[] = [
      { kind: 'resource', owed: 0.5, since: 0, origin: 'B' },
      { kind: 'knowledge', owed: 0.5, since: 0, origin: 'B' },
    ]
    const result = repay(
      debts,
      makeState({
        population: 10,
        allocation: { agriculture: 10, industry: 10, research: 80, conservation: 0 },
      }),
      makeDerived({ foodAvailable: 1e9, energyTarget: 0 }),
      1,
    )
    expect(totalOwed(result)).toBeGreaterThanOrEqual(0)
    for (const debt of result) expect(debt.owed).toBeGreaterThanOrEqual(0)
  })
})

describe('leapParadox', () => {
  it('fires when what arrives is more than PARADOX_LEAP times what the world has', () => {
    const state = makeState({ technology: 10 })
    const tooMuch = makeCrossing({ kind: 'knowledge', dose: 1, amounts: [31] })
    expect(leapParadox(tooMuch, state)).toBe(true)
  })

  it('fires when the crossing belongs to an era the world has not reached', () => {
    const state = makeState({ technology: 100, eras: 0 })
    const advanced = makeCrossing({ kind: 'knowledge', dose: 2, amounts: [1] })
    expect(leapParadox(advanced, state)).toBe(true)
  })

  it('does not fire for a proportional gift within reach of the era', () => {
    const state = makeState({ technology: 10, eras: Era.agricultural | Era.industrial })
    const modest = makeCrossing({ kind: 'knowledge', dose: 2, amounts: [15] })
    expect(leapParadox(modest, state)).toBe(false)
  })
})

describe('circularParadox', () => {
  it('flags the second crossing that closes a two-world loop (A receives from B, then B receives from A)', () => {
    const ledgers = new Map<string, readonly Debt[]>([
      ['A', [{ kind: 'knowledge', owed: 5, since: 0, origin: 'B' }]],
    ])
    expect(circularParadox('A', 'B', ledgers)).toBe(true)
  })

  it('flags a longer chain A owes B, B owes C, and A now gives to C (closing A-B-C-A)', () => {
    const ledgers = new Map<string, readonly Debt[]>([
      ['A', [{ kind: 'knowledge', owed: 5, since: 0, origin: 'B' }]],
      ['B', [{ kind: 'resource', owed: 2, since: 0, origin: 'C' }]],
    ])
    expect(circularParadox('A', 'C', ledgers)).toBe(true)
  })

  it('is false when the origin owes someone, but that path never reaches the destination', () => {
    const ledgers = new Map<string, readonly Debt[]>([
      ['C', [{ kind: 'knowledge', owed: 5, since: 0, origin: 'D' }]],
    ])
    expect(circularParadox('C', 'A', ledgers)).toBe(false)
  })

  it('is false for a crossing from a world to itself', () => {
    const ledgers = new Map<string, readonly Debt[]>([
      ['A', [{ kind: 'knowledge', owed: 5, since: 0, origin: 'A' }]],
    ])
    expect(circularParadox('A', 'A', ledgers)).toBe(false)
  })
})

describe('resolveParadox', () => {
  const debts: Debt[] = [{ kind: 'knowledge', owed: 5, since: 0, origin: 'B' }]

  it('installs a debt paradox after PARADOX_PATIENCE years above the ratio', () => {
    let strain = PARADOX_PATIENCE - 2
    const almost = resolveParadox(null, debts, PARADOX_RATIO + 0.1, strain, 100)
    expect(almost.paradox).toBeNull()
    strain = almost.strain
    const installed = resolveParadox(null, debts, PARADOX_RATIO + 0.1, strain, 101)
    expect(installed.paradox).toEqual({ kind: 'debt', since: 101, deadline: 101 + PARADOX_GRACE })
    expect(installed.collapsed).toBe(false)
  })

  it('discharges the paradox when the debt is paid off before the deadline', () => {
    const current: Paradox = { kind: 'debt', since: 100, deadline: 100 + PARADOX_GRACE }
    const result = resolveParadox(current, [], 0, 40, 150)
    expect(result.paradox).toBeNull()
    expect(result.collapsed).toBe(false)
    expect(result.strain).toBe(0)
  })

  it('collapses when the deadline passes with debt still open', () => {
    const current: Paradox = { kind: 'leap', since: 100, deadline: 130 }
    const result = resolveParadox(current, debts, 1, 0, 130)
    expect(result.collapsed).toBe(true)
    expect(result.paradox).toEqual(current)
  })

  it('installs nothing and zeroes the counter without any debt', () => {
    const result = resolveParadox(null, [], 0, 12, 5)
    expect(result.paradox).toBeNull()
    expect(result.strain).toBe(0)
  })
})
