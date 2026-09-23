import { describe, expect, it } from 'vitest'
import {
  addDebt,
  circularParadox,
  clampRepayment,
  debtOf,
  debtRatio,
  heaviestDebt,
  leapParadox,
  repay,
  resolveParadox,
  totalOwed,
  type Debt,
  type Paradox,
} from './debt.ts'
import { PARADOX_GRACE, PARADOX_LEAP, PARADOX_PATIENCE, PARADOX_RATIO } from './params.ts'
import type { Derived } from './rules.ts'
import { Era, type Allocation } from './state.ts'
import type { Crossing } from './crossing.ts'
import { worldDerived } from './events.ts'
import { TEST_WORLD, makeState } from './testing.ts'

const GIFTED_ALLOCATION: Allocation = {
  agriculture: 20,
  industry: 40,
  research: 30,
  conservation: 10,
}

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

  it('charges knowledge and resource at the crossing cost', () => {
    for (const kind of ['knowledge', 'resource'] as const) {
      const crossing = makeCrossing({ kind, cost: 7, tick: 42, origin: { world: 'C', tick: 42 } })
      const debt = debtOf(crossing)
      expect(debt).toEqual({ kind, owed: 7, since: 42, origin: 'C' })
    }
  })

  it('charges doctrine at the crossing cost and carries the gifted allocation', () => {
    const crossing = makeCrossing({
      kind: 'doctrine',
      cost: 7,
      tick: 42,
      origin: { world: 'C', tick: 42 },
      amounts: [],
      allocation: GIFTED_ALLOCATION,
    })
    const debt = debtOf(crossing)
    expect(debt).toEqual({
      kind: 'doctrine',
      owed: 7,
      since: 42,
      origin: 'C',
      allocation: GIFTED_ALLOCATION,
    })
  })
})

describe('addDebt', () => {
  it('sums debts of the same kind and origin, keeping the older since', () => {
    const first: Debt = { kind: 'knowledge', owed: 5, since: 100, origin: 'B' }
    const second: Debt = { kind: 'knowledge', owed: 3, since: 250, origin: 'B' }
    const result = addDebt([first], second)
    expect(result).toEqual([{ kind: 'knowledge', owed: 8, since: 100, origin: 'B' }])
  })

  it('adopts the allocation of the newest doctrine gift, the one the world is now asked to keep', () => {
    const kept: Allocation = { agriculture: 10, industry: 40, research: 30, conservation: 20 }
    const first: Debt = {
      kind: 'doctrine',
      owed: 2,
      since: 100,
      origin: 'B',
      allocation: GIFTED_ALLOCATION,
    }
    const second: Debt = { kind: 'doctrine', owed: 3, since: 200, origin: 'B', allocation: kept }
    const merged = addDebt([first], second)
    expect(merged).toEqual([
      { kind: 'doctrine', owed: 5, since: 100, origin: 'B', allocation: kept },
    ])

    // FIX: antes a dívida somada media a primeira doutrina e nunca caía, por mais séculos que passassem
    const running = makeState({ allocation: kept })
    const after = repay(merged, running, makeDerived(), 300)
    expect(after[0]?.owed).toBeLessThan(5)
  })

  it('keeps debts of the same kind separate when the origin differs', () => {
    const fromB: Debt = { kind: 'knowledge', owed: 5, since: 100, origin: 'B' }
    const fromC: Debt = { kind: 'knowledge', owed: 4, since: 120, origin: 'C' }
    const result = addDebt([fromB], fromC)
    expect(result).toEqual([fromB, fromC])
  })
})

describe('heaviestDebt', () => {
  it('is null with an empty ledger and otherwise names the biggest open debt', () => {
    const small: Debt = { kind: 'doctrine', owed: 2, since: 10, origin: 'B' }
    const big: Debt = { kind: 'knowledge', owed: 9, since: 40, origin: 'C' }
    expect(heaviestDebt([])).toBeNull()
    expect(heaviestDebt([small, big])).toBe(big)
    expect(heaviestDebt([big, small])).toBe(big)
  })

  it('keeps the first of a tie, so the same ledger always names the same crossing', () => {
    const first: Debt = { kind: 'knowledge', owed: 4, since: 10, origin: 'B' }
    const tied: Debt = { kind: 'resource', owed: 4, since: 20, origin: 'C' }
    expect(heaviestDebt([first, tied])).toBe(first)
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

  it('abates resource by its own food production above consumption, plus its own energy target', () => {
    const debts: Debt[] = [{ kind: 'resource', owed: 1, since: 0, origin: 'B' }]
    const surplus = repay(
      debts,
      makeState({ population: 1000 }),
      makeDerived({ foodProduction: 1e8, energyTarget: 5 }),
      1,
    )
    const scarce = repay(
      debts,
      makeState({ population: 1000 }),
      makeDerived({ foodProduction: 0, energyTarget: 0 }),
      1,
    )
    // FEAT: a produção do próprio mundo, acima do que ele consome, já quita a dívida de 1 crédito
    expect(surplus.length).toBe(0)
    expect(scarce[0]?.owed).toBe(1)
  })

  it('does not let a resource gift measurably speed up its own repayment', () => {
    // FIX: foodProduction e energyTarget não leem s.food/s.energy, então inflar o estoque (o que
    // uma travessia de recurso faz pelos ecos) não pode acelerar a quitação da própria dívida
    const debts: Debt[] = [{ kind: 'resource', owed: 100, since: 0, origin: 'B' }]
    const derived = makeDerived({ foodProduction: 5e5, energyTarget: 2 })
    const withoutGift = repay(
      debts,
      makeState({ population: 1000, food: 1000, energy: 0.5 }),
      derived,
      1,
    )
    const withHugeGift = repay(
      debts,
      makeState({ population: 1000, food: 5e6, energy: 50 }),
      derived,
      1,
    )
    expect(withHugeGift[0]?.owed).toBe(withoutGift[0]?.owed)
  })

  it('abates doctrine only in years the world keeps, by its own decision, the exact allocation it received', () => {
    const debts: Debt[] = [
      { kind: 'doctrine', owed: 1, since: 10, origin: 'B', allocation: GIFTED_ALLOCATION },
    ]
    const sameYear = repay(debts, makeState({ allocation: GIFTED_ALLOCATION }), makeDerived(), 10)
    // FEAT: não abate no ano em que a doutrina chega
    expect(sameYear[0]?.owed).toBe(1)

    const kept = repay(debts, makeState({ allocation: GIFTED_ALLOCATION }), makeDerived(), 11)
    expect(kept[0]?.owed ?? 0).toBeLessThan(1)
  })

  it('does not abate doctrine once the world abandons the gifted allocation, however much time passes', () => {
    const debts: Debt[] = [
      { kind: 'doctrine', owed: 1, since: 10, origin: 'B', allocation: GIFTED_ALLOCATION },
    ]
    // FEAT: a alocação padrão de makeState, diferente da doada
    const ownAllocation = makeState().allocation
    const abandoned = repay(debts, makeState({ allocation: ownAllocation }), makeDerived(), 50)
    expect(abandoned[0]?.owed).toBe(1)
  })

  it('never grows a knowledge debt when assimilation pushes technology past 100 before the clamp', () => {
    const owed: Debt = { kind: 'knowledge', owed: 5, since: 0, origin: 'B' }
    const overshot = makeState({ technology: 104 })
    expect(repay([owed], overshot, makeDerived(), 10)[0]?.owed).toBe(5)
  })

  it('drops a debt below DEBT_EPSILON from the list', () => {
    const debts: Debt[] = [{ kind: 'doctrine', owed: 1e-9, since: 0, origin: 'B' }]
    expect(repay(debts, makeState(), makeDerived(), 5)).toEqual([])
  })
})

describe('clampRepayment', () => {
  it('never lets a repayment push owed below zero', () => {
    expect(clampRepayment(0.5, 10)).toBe(0)
    expect(clampRepayment(0, 5)).toBe(0)
  })

  it('subtracts normally when the gain does not cover the whole debt', () => {
    expect(clampRepayment(5, 2)).toBe(3)
  })
})

describe('leapParadox — magnitude, per kind', () => {
  it('fires for knowledge when what arrives is more than PARADOX_LEAP times the technology the world has', () => {
    const state = makeState({ technology: 10, eras: Era.agricultural | Era.industrial })
    const tooMuch = makeCrossing({ kind: 'knowledge', dose: 1, amounts: [31] })
    const proportional = makeCrossing({ kind: 'knowledge', dose: 1, amounts: [15] })
    expect(leapParadox(tooMuch, state, TEST_WORLD)).toBe(true)
    expect(leapParadox(proportional, state, TEST_WORLD)).toBe(false)
  })

  it('checks a resource crossing against what the world makes in a year, parcel by parcel', () => {
    // FIX: comida e energia são medidas contra a produção do ano, não contra o estoque
    const state = makeState({ food: 100, energy: 10, eras: Era.agricultural | Era.industrial })
    const d = worldDerived(state, TEST_WORLD)
    const over = (value: number) => PARADOX_LEAP * value * 1.01
    const under = (value: number) => PARADOX_LEAP * value * 0.99
    const tooMuchFood = makeCrossing({
      kind: 'resource',
      dose: 1,
      amounts: [over(d.foodProduction), under(d.energyTarget)],
    })
    const tooMuchEnergy = makeCrossing({
      kind: 'resource',
      dose: 1,
      amounts: [under(d.foodProduction), over(d.energyTarget)],
    })
    const proportional = makeCrossing({
      kind: 'resource',
      dose: 1,
      amounts: [under(d.foodProduction), under(d.energyTarget)],
    })
    expect(leapParadox(tooMuchFood, state, TEST_WORLD)).toBe(true)
    expect(leapParadox(tooMuchEnergy, state, TEST_WORLD)).toBe(true)
    expect(leapParadox(proportional, state, TEST_WORLD)).toBe(false)
  })

  it('does not call a bag of food a leap just because the world ate its whole reserve', () => {
    // FIX: um mundo que vive do que colhe carrega estoque perto de zero; qualquer ajuda parecia
    // três vezes "o que ele tem", e um saco de comida num mundo faminto é o caso menos paradoxal
    const hungry = makeState({ food: 0, energy: 0, eras: Era.agricultural | Era.industrial })
    const bag = makeCrossing({ kind: 'resource', dose: 1, amounts: [1000, 0.1] })
    expect(leapParadox(bag, hungry, TEST_WORLD)).toBe(false)
  })

  it('never fires for people, whatever the migration: without debt no paradox survives the year it is born', () => {
    const state = makeState({ population: 1000 })
    const tooMany = makeCrossing({ kind: 'people', dose: 1, amounts: [3001] })
    const proportional = makeCrossing({ kind: 'people', dose: 1, amounts: [2000] })
    expect(leapParadox(tooMany, state, TEST_WORLD)).toBe(false)
    expect(leapParadox(proportional, state, TEST_WORLD)).toBe(false)
  })

  it('never fires on magnitude for doctrine: a doctrine crossing carries no amounts to compare', () => {
    const state = makeState({ eras: Era.agricultural | Era.industrial })
    const doctrine = makeCrossing({
      kind: 'doctrine',
      dose: 1,
      amounts: [],
      allocation: GIFTED_ALLOCATION,
    })
    expect(leapParadox(doctrine, state, TEST_WORLD)).toBe(false)
  })
})

describe('leapParadox — era: only a gift that alone unlocks an era out of reach', () => {
  it('fires for knowledge when technology is the last unmet condition of the industrial era', () => {
    const state = makeState({ technology: 35, energy: 2, eras: Era.agricultural })
    const pushesPastIndustrial = makeCrossing({ kind: 'knowledge', dose: 1, amounts: [10] })
    expect(leapParadox(pushesPastIndustrial, state, TEST_WORLD)).toBe(true)
  })

  it('fires for resource energy when energy is the last unmet condition of the industrial era', () => {
    const state = makeState({ technology: 50, energy: 1, eras: 0 })
    const pushesEnergy = makeCrossing({ kind: 'resource', dose: 1, amounts: [1, 0.3] })
    expect(leapParadox(pushesEnergy, state, TEST_WORLD)).toBe(true)
  })

  it('does not fire when another condition of that era is still centuries away', () => {
    // FIX: o portão de energia industrial cedia a um presente de recurso comum enquanto quem
    // tranca a era é a tecnologia; vencer uma condição sozinha não adianta a história
    const state = makeState({ technology: 5, energy: 1, eras: 0 })
    const pushesEnergy = makeCrossing({ kind: 'resource', dose: 1, amounts: [1, 0.3] })
    expect(leapParadox(pushesEnergy, state, TEST_WORLD)).toBe(false)
  })

  it('does not fire for knowledge that stays under every unreached era gate', () => {
    const state = makeState({ technology: 35, energy: 2, eras: Era.agricultural })
    const modest = makeCrossing({ kind: 'knowledge', dose: 1, amounts: [2] })
    expect(leapParadox(modest, state, TEST_WORLD)).toBe(false)
  })

  it('does not fire for knowledge crossing a gate the world has already reached', () => {
    const state = makeState({ technology: 35, energy: 2, eras: Era.agricultural | Era.industrial })
    const pushesPast40 = makeCrossing({ kind: 'knowledge', dose: 1, amounts: [10] })
    expect(leapParadox(pushesPast40, state, TEST_WORLD)).toBe(false)
  })

  it('does not fire when the era would arrive this year with or without the gift', () => {
    const state = makeState({ technology: 45, energy: 2, eras: Era.agricultural })
    const extra = makeCrossing({ kind: 'knowledge', dose: 1, amounts: [1] })
    expect(leapParadox(extra, state, TEST_WORLD)).toBe(false)
  })

  it('never fires era-based for doctrine or people: no era-event condition is keyed to those metrics', () => {
    const state = makeState({ eras: 0, population: 1000 })
    const doctrine = makeCrossing({
      kind: 'doctrine',
      dose: 1,
      amounts: [],
      allocation: GIFTED_ALLOCATION,
    })
    const people = makeCrossing({ kind: 'people', dose: 1, amounts: [100] })
    expect(leapParadox(doctrine, state, TEST_WORLD)).toBe(false)
    expect(leapParadox(people, state, TEST_WORLD)).toBe(false)
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
