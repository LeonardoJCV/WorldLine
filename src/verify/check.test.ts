import { describe, expect, it } from 'vitest'
import {
  GOLDEN_CASES,
  GOLDEN_SCRIPTS,
  INHERITANCE_CASE,
  MERGE_CASE,
  mergeSeam,
} from '../engine/golden.ts'
import { CAUSAL_WINDOW } from '../engine/params.ts'
import { Worldline } from '../engine/worldline.ts'
import {
  COLLAPSE_CASE,
  COLLAPSE_CROSSINGS,
  COLLAPSE_DECISIONS,
  runCollapseCheck,
  runGoldenChecks,
  runInheritanceCheck,
  runMergeCheck,
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

describe('runMergeCheck', () => {
  it('seams two histories into one and reproduces the fingerprint of the one that received', () => {
    const result = runMergeCheck()
    expect(result.status).toBe('running')
    expect(result.away).toBe('merged')
    expect(result.seam).toBe(MERGE_CASE.tick)
    expect(result.lived).toBe(0)
    expect(result.settled).toBe(true)
    expect(result.computed).toBe(MERGE_CASE.hash)
    expect(result.ok).toBe(true)
  })

  it('keeps the years of the case consistent, the seam before the year that is pinned', () => {
    expect(MERGE_CASE.tick).toBeLessThan(MERGE_CASE.year)
    expect(MERGE_CASE.script).not.toBe(MERGE_CASE.other)
  })

  it('keeps every published fingerprint distinct, all seventeen of them', () => {
    // FEAT: dois casos com o mesmo hash seriam duas provas valendo uma; o Set pega a colisão
    const published = [
      ...GOLDEN_CASES.map((golden) => golden.hash),
      COLLAPSE_CASE.hash,
      INHERITANCE_CASE.hash,
      MERGE_CASE.hash,
    ]
    expect(published).toHaveLength(17)
    expect(new Set(published).size).toBe(17)
  })
})

describe('the works the reference histories never build', () => {
  // FEAT: nenhum roteiro comissiona nada, então os dezessete têm de sair com a obra vazia — e é
  // essa afirmação, e não a confiança, que sustenta que nenhum fingerprint se moveu nesta tarefa
  const idle = (world: Worldline) => {
    expect(world.commissions).toEqual([])
    expect(world.present.works).toEqual([])
    expect(world.present.building).toBeNull()
  }

  it('leaves all seventeen fingerprints alone, with no work done and none under way', () => {
    for (const { seed, script, year, hash } of GOLDEN_CASES) {
      const plan = GOLDEN_SCRIPTS[script]
      const world = new Worldline(seed, plan.decisions, null, plan.crossings)
      world.advance(year)
      idle(world)
      expect(world.hashAt(year)).toBe(hash)
    }

    const collapsing = new Worldline(
      COLLAPSE_CASE.seed,
      COLLAPSE_DECISIONS,
      null,
      COLLAPSE_CROSSINGS,
    )
    collapsing.advance(COLLAPSE_CASE.year)
    idle(collapsing)
    expect(collapsing.hashAt(COLLAPSE_CASE.year)).toBe(COLLAPSE_CASE.hash)

    const inherited = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
    const heir = new Worldline(
      INHERITANCE_CASE.seed,
      inherited.decisions,
      null,
      inherited.crossings,
    )
    heir.advance(INHERITANCE_CASE.year)
    idle(heir)
    expect(heir.hashAt(INHERITANCE_CASE.year)).toBe(INHERITANCE_CASE.hash)

    const host = GOLDEN_SCRIPTS[MERGE_CASE.script]
    const guest = GOLDEN_SCRIPTS[MERGE_CASE.other]
    const receives = new Worldline(MERGE_CASE.seed, host.decisions, null, host.crossings)
    const departs = new Worldline(MERGE_CASE.seed, guest.decisions, null, guest.crossings)
    receives.advance(MERGE_CASE.tick)
    departs.advance(MERGE_CASE.tick)
    receives.merge(mergeSeam(departs.present).receives)
    receives.advance(MERGE_CASE.year - MERGE_CASE.tick)
    idle(receives)
    idle(departs)
    expect(receives.hashAt(MERGE_CASE.year)).toBe(MERGE_CASE.hash)
  })
})
