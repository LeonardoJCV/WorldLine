import { describe, expect, it } from 'vitest'
import { GOLDEN_CASES } from '../engine/golden.ts'
import { runCollapseCheck, runGoldenChecks } from './check.ts'

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
})
