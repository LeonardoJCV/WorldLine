import { describe, expect, it } from 'vitest'
import { GOLDEN_CASES } from '../engine/golden.ts'
import { runGoldenChecks } from './check.ts'

describe('runGoldenChecks', () => {
  it('reproduces every reference fingerprint', () => {
    const results = runGoldenChecks()
    expect(results).toHaveLength(GOLDEN_CASES.length)
    expect(results.filter((result) => !result.ok)).toEqual([])
  })
})
