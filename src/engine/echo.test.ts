import { describe, expect, it } from 'vitest'
import { ASSIMILATION, addEcho, assimilate, ECHO_EPSILON, type Echo } from './echo.ts'
import { genesis } from './genesis.ts'

const base = genesis(1).state

describe('addEcho', () => {
  it('keeps one entry per target', () => {
    const once = addEcho([], 'technology', 10)
    const twice = addEcho(once, 'technology', 5)
    expect(twice).toEqual([{ target: 'technology', remaining: 15 }])
  })

  it('ignores broken or empty amounts', () => {
    expect(addEcho([], 'food', 0)).toEqual([])
    expect(addEcho([], 'food', NaN)).toEqual([])
    expect(addEcho([], 'food', -3)).toEqual([])
  })
})

describe('assimilate', () => {
  it('does nothing without echoes', () => {
    const result = assimilate(base)
    expect(result.echoes).toBe(base.echoes)
    expect(result.technology).toBe(base.technology)
  })

  it('hands a fifth of what is left to the variable and shrinks the rest', () => {
    const echoes: Echo[] = [{ target: 'technology', remaining: 100 }]
    const result = assimilate({ ...base, echoes })
    expect(result.technology).toBeCloseTo(base.technology + 20, 6)
    expect(result.echoes[0]?.remaining).toBeCloseTo(72, 6)
  })

  it('converges to nothing', () => {
    let state = { ...base, echoes: [{ target: 'food', remaining: 1000 }] as readonly Echo[] }
    let given = 0
    for (let year = 0; year < 400 && state.echoes.length > 0; year++) {
      const result = assimilate(state)
      given += result.food - state.food
      state = { ...state, food: result.food, echoes: result.echoes }
    }
    expect(state.echoes).toHaveLength(0)
    expect(given).toBeGreaterThan(600)
    expect(given).toBeLessThan(720)
  })

  it('drops an echo under the epsilon', () => {
    const result = assimilate({
      ...base,
      echoes: [{ target: 'energy', remaining: ECHO_EPSILON / 2 }],
    })
    expect(result.echoes).toHaveLength(0)
  })

  it('assimilates every target at once', () => {
    const result = assimilate({
      ...base,
      echoes: [
        { target: 'technology', remaining: 10 },
        { target: 'food', remaining: 10 },
        { target: 'energy', remaining: 10 },
      ],
    })
    expect(result.technology).toBeCloseTo(base.technology + 10 * ASSIMILATION, 6)
    expect(result.food).toBeCloseTo(base.food + 10 * ASSIMILATION, 6)
    expect(result.energy).toBeCloseTo(base.energy + 10 * ASSIMILATION, 6)
  })
})
