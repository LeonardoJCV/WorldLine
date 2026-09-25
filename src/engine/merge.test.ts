import { describe, expect, it } from 'vitest'
import { mergeStates, mergeWeights, type Merge } from './merge.ts'
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
