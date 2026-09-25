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
    expect(hashState({ ...state, debts: [], paradox: null, strain: 0 })).toBe(hashState(state))
  })

  it('separates two worlds that carried the strain for different lengths of time', () => {
    const a = hashState({ ...state, strain: 12 })
    const b = hashState({ ...state, strain: 13 })
    expect(a).not.toBe(b)
    expect(a).not.toBe(hashState(state))
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

  it('ignores the colonies block while it is empty', () => {
    expect(hashState({ ...state, colonies: [] })).toBe(hashState(state))
  })

  it('separates two worlds that keep different colonies', () => {
    const a = hashState({
      ...state,
      colonies: [{ body: 2, founded: 400, population: 1000, support: 0.2, record: 3 }],
    })
    const b = hashState({
      ...state,
      colonies: [{ body: 3, founded: 400, population: 1000, support: 0.2, record: 3 }],
    })
    expect(a).not.toBe(b)
    expect(a).not.toBe(hashState(state))
  })

  it('ignores the merge field while it is empty', () => {
    const merged = { ...state, lastMerge: { tick: 1450, other: 'B' } }
    expect(hashState(merged)).not.toBe(hashState(state))
    // FIX: comparado ao hash fixo, não a uma nova chamada, para pegar um campo que vaza mesmo vazio
    expect(hashState({ ...merged, lastMerge: null })).toBe('77ebb9f5')
  })

  it('hashes the year of a merge but never the name of the other history', () => {
    // FEAT: a identidade da outra é nome em recibo, não física — a mesma exclusão de Debt.origin
    const merged = { ...state, lastMerge: { tick: 1450, other: 'B' } }
    expect(hashState(merged)).toBe(hashState({ ...merged, lastMerge: { tick: 1450, other: 'F' } }))
    expect(hashState(merged)).not.toBe(
      hashState({ ...merged, lastMerge: { tick: 1451, other: 'B' } }),
    )
  })

  it('gives each of the four statuses its own code, and leaves the three old ones where they were', () => {
    const running = hashState(state)
    const extinct = hashState({ ...state, status: 'extinct' })
    const collapsed = hashState({ ...state, status: 'collapsed' })
    const merged = hashState({ ...state, status: 'merged' })
    // FIX: comparação par a par, não só contra 'merged', para pegar uma colisão entre dois antigos
    expect(new Set([running, extinct, collapsed, merged]).size).toBe(4)
    expect(running).toBe('77ebb9f5')
    expect(extinct).toBe('26389b1a')
    expect(collapsed).toBe('1f93f1b5')
  })

  it('pins a state with several optional blocks populated at once, so no block can move', () => {
    // FIX: nenhum teste isolado prova a ordem dos blocos condicionais; este cobre todos de uma vez
    const composite = {
      ...state,
      echoes: [{ target: 'technology' as const, remaining: 10 }],
      lastCrossing: { tick: 5, kind: 'knowledge' as const },
      debts: [{ kind: 'knowledge' as const, owed: 10, since: 0, origin: 'other' }],
      paradox: { kind: 'circular' as const, since: 2, deadline: 10 },
      strain: 3,
      colonies: [{ body: 2, founded: 400, population: 1000, support: 0.2, record: 3 }],
      home: 2,
      lastMerge: { tick: 1450, other: 'B' },
    }
    expect(hashState(composite)).toBe('18c12365')
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
