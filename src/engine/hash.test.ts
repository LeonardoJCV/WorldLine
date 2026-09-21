import { describe, expect, it } from 'vitest'
import { genesis } from './genesis.ts'
import { hashState } from './hash.ts'

describe('hashState', () => {
  const { state } = genesis(482913)

  it('is stable for the same state', () => {
    expect(hashState(state)).toBe(hashState({ ...state }))
    expect(hashState(state)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('reacts to the smallest change in any field', () => {
    const base = hashState(state)
    expect(hashState({ ...state, population: state.population * (1 + 1e-15) })).not.toBe(base)
    expect(hashState({ ...state, eras: 1 })).not.toBe(base)
    expect(hashState({ ...state, active: [{ def: 3, record: 0, start: 0 }] })).not.toBe(base)
    expect(hashState({ ...state, lastDecision: { tick: 0, sectors: ['industry'] } })).not.toBe(base)
    expect(
      hashState({ ...state, allocation: { ...state.allocation, agriculture: 39, industry: 31 } }),
    ).not.toBe(base)
  })

  it('pins the genesis hash', () => {
    expect(hashState(state)).toMatchInlineSnapshot(`"77ebb9f5"`)
  })
})
