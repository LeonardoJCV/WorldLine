import { describe, expect, it } from 'vitest'
import type { Debt, Paradox } from '../../engine/debt.ts'
import type { EventId, EventRecord } from '../../engine/events.ts'
import { debtView, endingYear, paradoxView, repayHint } from './debt.ts'

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    kind: 'knowledge',
    owed: 10,
    since: 1,
    origin: 'alpha',
    ...overrides,
  }
}

describe('debtView', () => {
  it('is null with an empty list', () => {
    expect(debtView([], null)).toBeNull()
    expect(debtView([], [debt()])).toBeNull()
  })

  it('sums the total owed', () => {
    const debts = [debt({ owed: 10 }), debt({ owed: 5, kind: 'resource', origin: 'beta' })]
    expect(debtView(debts, null)?.total).toBe(15)
  })

  it('lists kinds and origins without duplicates, in a stable order', () => {
    const debts = [
      debt({ kind: 'knowledge', origin: 'alpha' }),
      debt({ kind: 'resource', origin: 'beta' }),
      debt({ kind: 'knowledge', origin: 'gamma' }),
      debt({ kind: 'resource', origin: 'alpha' }),
    ]
    const view = debtView(debts, null)
    expect(view?.kinds).toEqual(['knowledge', 'resource'])
    expect(view?.origins).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('reports a falling trend when the total dropped', () => {
    const previous = [debt({ owed: 20 })]
    const current = [debt({ owed: 10 })]
    expect(debtView(current, previous)?.trend).toBe('falling')
  })

  it('reports a rising trend when the total grew', () => {
    const previous = [debt({ owed: 10 })]
    const current = [debt({ owed: 20 })]
    expect(debtView(current, previous)?.trend).toBe('rising')
  })

  it('reports a steady trend when the total is unchanged', () => {
    const previous = [debt({ owed: 10 })]
    const current = [debt({ owed: 10 })]
    expect(debtView(current, previous)?.trend).toBe('steady')
  })

  it('reports a steady trend when there is nothing to compare', () => {
    const current = [debt({ owed: 10 })]
    expect(debtView(current, null)?.trend).toBe('steady')
  })
})

describe('paradoxView', () => {
  it('is null without a paradox', () => {
    expect(paradoxView(null, [debt()], 10)).toBeNull()
  })

  it('computes yearsLeft from the deadline and the observed year', () => {
    const paradox: Paradox = { kind: 'debt', since: 5, deadline: 15 }
    expect(paradoxView(paradox, [debt()], 10)?.yearsLeft).toBe(5)
  })

  it('never lets yearsLeft go negative', () => {
    const paradox: Paradox = { kind: 'debt', since: 5, deadline: 15 }
    expect(paradoxView(paradox, [debt()], 20)?.yearsLeft).toBe(0)
  })

  it('reflects what is still owed', () => {
    const paradox: Paradox = { kind: 'debt', since: 5, deadline: 15 }
    const debts = [debt({ owed: 10 }), debt({ owed: 5, kind: 'resource', origin: 'beta' })]
    expect(paradoxView(paradox, debts, 10)?.owed).toBe(15)
  })
})

describe('repayHint', () => {
  it('gives a null hint with no open kind', () => {
    expect(repayHint([])).toBeNull()
  })

  it('gives the single hint for one open kind', () => {
    expect(repayHint(['knowledge'])).toBe('research')
    expect(repayHint(['resource'])).toBe('production')
    expect(repayHint(['doctrine'])).toBe('doctrine')
  })

  it('gives mixed for more than one open kind', () => {
    expect(repayHint(['knowledge', 'resource'])).toBe('mixed')
  })
})

describe('endingYear', () => {
  function record(event: EventId, start: number): EventRecord {
    return { event, start, end: null, causes: [] }
  }

  it('is null without that ending on record', () => {
    expect(endingYear([], 'collapse')).toBeNull()
    expect(endingYear([record('paradox', 79)], 'collapse')).toBeNull()
    expect(endingYear([record('collapse', 279)], 'extinction')).toBeNull()
  })

  it('takes the year the engine wrote, not the year the clock stopped', () => {
    expect(endingYear([record('paradox', 79), record('collapse', 279)], 'collapse')).toBe(279)
    expect(endingYear([record('famine', 900), record('extinction', 1165)], 'extinction')).toBe(1165)
  })
})
