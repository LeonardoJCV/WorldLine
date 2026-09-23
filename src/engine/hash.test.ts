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

  it('ignores the crossing fields while they are empty', () => {
    expect(hashState({ ...state, echoes: [], lastCrossing: null })).toBe(hashState(state))
  })

  it('separates two worlds that assimilate different things', () => {
    const a = hashState({ ...state, echoes: [{ target: 'technology', remaining: 10 }] })
    const b = hashState({ ...state, echoes: [{ target: 'food', remaining: 10 }] })
    expect(a).not.toBe(b)
    expect(a).not.toBe(hashState(state))
  })

  it('does not confuse an echo with a last crossing', () => {
    const a = hashState({ ...state, echoes: [{ target: 'technology', remaining: 0 }] })
    const b = hashState({ ...state, lastCrossing: { tick: 0, kind: 'knowledge' } })
    expect(a).not.toBe(b)
  })

  it('separates two worlds by their last crossing', () => {
    const base = hashState(state)
    const a = hashState({ ...state, lastCrossing: { tick: 0, kind: 'knowledge' } })
    const b = hashState({ ...state, lastCrossing: { tick: 0, kind: 'people' } })
    expect(a).not.toBe(b)
    expect(a).not.toBe(base)
  })

  it('pins the genesis hash', () => {
    expect(hashState(state)).toMatchInlineSnapshot(`"77ebb9f5"`)
  })

  it('ignores the debt fields while they are empty', () => {
    expect(hashState({ ...state, debts: [], paradox: null })).toBe(hashState(state))
  })

  it('separates two worlds that owe different things', () => {
    const a = hashState({
      ...state,
      debts: [{ kind: 'knowledge', owed: 10, since: 0, origin: 'other' }],
    })
    const b = hashState({
      ...state,
      debts: [{ kind: 'resource', owed: 10, since: 0, origin: 'other' }],
    })
    expect(a).not.toBe(b)
    expect(a).not.toBe(hashState(state))
  })

  it('separates a collapsed world from an extinct one', () => {
    const a = hashState({ ...state, status: 'extinct' })
    const b = hashState({ ...state, status: 'collapsed' })
    expect(a).not.toBe(b)
  })

  it('ignores a new event that never fired, but reacts once one has', () => {
    // FIX: os cinco eventos da dívida (Tarefa 4) só entram no hash depois que dispararam uma vez;
    // um mundo que nunca cruzou nada tem lastEnded[11..] sempre em NEVER e reproduz o fingerprint antigo
    const untouched = [...state.lastEnded]
    untouched[11] = -1_000_000
    expect(hashState({ ...state, lastEnded: untouched })).toBe(hashState(state))

    const touched = [...state.lastEnded]
    touched[11] = 400
    expect(hashState({ ...state, lastEnded: touched })).not.toBe(hashState(state))
  })
})
