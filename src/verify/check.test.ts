import { describe, expect, it } from 'vitest'
import { GOLDEN_CASES, INHERITANCE_CASE } from '../engine/golden.ts'
import { CAUSAL_WINDOW } from '../engine/params.ts'
import { Worldline } from '../engine/worldline.ts'
import {
  COLLAPSE_CASE,
  COLLAPSE_CROSSINGS,
  COLLAPSE_DECISIONS,
  runCollapseCheck,
  runGoldenChecks,
  runInheritanceCheck,
} from './check.ts'

describe('runGoldenChecks', () => {
  it('reproduces every reference fingerprint', () => {
    const results = runGoldenChecks()
    expect(results).toHaveLength(GOLDEN_CASES.length)
    expect(results.filter((result) => !result.ok)).toEqual([])
  })
})

describe('runCollapseCheck', () => {
  it('reaches a collapse and reproduces its fingerprint', () => {
    const result = runCollapseCheck()
    expect(result.status).toBe('collapsed')
    expect(result.reached).toBe(result.year)
    expect(result.ok).toBe(true)
  })

  it('names the crossing that opened the debt, decades after the window would have closed', () => {
    const world = new Worldline(COLLAPSE_CASE.seed, COLLAPSE_DECISIONS, null, COLLAPSE_CROSSINGS)
    world.advance(COLLAPSE_CASE.year)
    const gift = COLLAPSE_CROSSINGS[0]
    const paradox = world.records.find((record) => record.event === 'paradox')
    expect(paradox).toBeDefined()
    expect((paradox?.start ?? 0) - (gift?.tick ?? 0)).toBeGreaterThan(CAUSAL_WINDOW)
    expect(paradox?.causes).toContainEqual({
      kind: 'crossing',
      tick: gift?.tick,
      crossing: gift?.kind,
    })
  })
})

describe('runInheritanceCheck', () => {
  it('reaches the inheritance and reproduces its fingerprint', () => {
    const result = runInheritanceCheck()
    expect(result.status).toBe('running')
    expect(result.moved).toBe(INHERITANCE_CASE.ended)
    expect(result.settled).toBe(INHERITANCE_CASE.founded)
    expect(result.home).not.toBeNull()
    expect(result.computed).toBe(INHERITANCE_CASE.hash)
    expect(result.ok).toBe(true)
  })

  it('proves the history changed home instead of ending', () => {
    // FEAT: o ano da queda vem antes do primeiro ano na casa nova, e a fundação vem antes dos dois
    expect(INHERITANCE_CASE.founded).toBeLessThan(INHERITANCE_CASE.ended)
    expect(INHERITANCE_CASE.ended).toBeLessThan(INHERITANCE_CASE.year)
  })
})
