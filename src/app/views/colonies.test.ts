import { describe, expect, it } from 'vitest'
import type { Colony } from '../../engine/colony.ts'
import { COLONY_SEED_POP, COLONY_SELF } from '../../engine/params.ts'
import { system } from '../../engine/system.ts'
import { bodyName, colonyView } from './colonies.ts'

function colony(overrides: Partial<Colony> = {}): Colony {
  return {
    body: 1,
    founded: 1,
    population: 1000,
    support: 0,
    record: 0,
    ...overrides,
  }
}

describe('bodyName', () => {
  it('is deterministic for a given seed and index', () => {
    expect(bodyName(482913, 1)).toBe(bodyName(482913, 1))
  })

  it('changes with the seed and the body', () => {
    expect(bodyName(482913, 1)).not.toBe(bodyName(7, 1))
    expect(bodyName(482913, 1)).not.toBe(bodyName(482913, 2))
  })

  it('reads like a name, not an index', () => {
    for (const seed of [1, 2, 3, 482913]) {
      for (const body of system(seed)) {
        expect(bodyName(seed, body.index)).toMatch(/^[A-Z][a-z]{3,11}$/)
      }
    }
  })

  it('does not collide within one system', () => {
    for (const seed of [1, 2, 3, 482913, 999999]) {
      const bodies = system(seed)
      const names = bodies.map((body) => bodyName(seed, body.index))
      expect(new Set(names).size).toBe(names.length)
    }
  })
})

describe('colonyView', () => {
  it('is null without colonies', () => {
    expect(colonyView([], 482913)).toBeNull()
  })

  it('counts the colonies', () => {
    const view = colonyView([colony({ body: 1 }), colony({ body: 2 })], 482913)
    expect(view?.count).toBe(2)
  })

  it('names the leader after the body it lives on', () => {
    const view = colonyView([colony({ body: 2 })], 482913)
    expect(view?.leader?.body).toBe(bodyName(482913, 2))
  })

  it('picks the colony closest to self-sufficiency as leader', () => {
    const near = colony({ body: 1, support: 0.7, population: 50_000 })
    const far = colony({ body: 2, support: 0.1, population: 10_000 })
    const view = colonyView([far, near], 482913)
    expect(view?.leader?.body).toBe(bodyName(482913, 1))
  })

  it('breaks a support tie by population, deterministically', () => {
    const smaller = colony({ body: 1, support: 0.5, population: 10_000 })
    const bigger = colony({ body: 2, support: 0.5, population: 20_000 })
    const view = colonyView([smaller, bigger], 482913)
    expect(view?.leader?.body).toBe(bodyName(482913, 2))
  })

  it('breaks a support and population tie by body index, deterministically', () => {
    const a = colony({ body: 3, support: 0.5, population: 10_000 })
    const b = colony({ body: 1, support: 0.5, population: 10_000 })
    const view1 = colonyView([a, b], 482913)
    const view2 = colonyView([b, a], 482913)
    expect(view1?.leader?.body).toBe(bodyName(482913, 1))
    expect(view2?.leader?.body).toBe(bodyName(482913, 1))
  })

  it('reports the leader self-sufficient only past the engine threshold', () => {
    const below = colony({ body: 1, support: COLONY_SELF - 0.01, population: COLONY_SEED_POP })
    const above = colony({ body: 1, support: COLONY_SELF, population: COLONY_SEED_POP })
    expect(colonyView([below], 482913)?.leader?.self).toBe(false)
    expect(colonyView([above], 482913)?.leader?.self).toBe(true)
  })

  it('reflects the engine threshold in anySelf without recomputing the rule', () => {
    const short = colony({ body: 1, support: COLONY_SELF, population: COLONY_SEED_POP - 1 })
    const enough = colony({ body: 2, support: COLONY_SELF, population: COLONY_SEED_POP })
    expect(colonyView([short], 482913)?.anySelf).toBe(false)
    expect(colonyView([short, enough], 482913)?.anySelf).toBe(true)
  })
})
