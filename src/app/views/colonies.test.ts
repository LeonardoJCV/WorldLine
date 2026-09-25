import { describe, expect, it } from 'vitest'
import type { Colony } from '../../engine/colony.ts'
import type { EventRecord } from '../../engine/events.ts'
import { COLONY_SEED_POP, COLONY_SELF } from '../../engine/params.ts'
import { system } from '../../engine/system.ts'
import {
  bodyName,
  colonyView,
  homeBody,
  inheritanceHeir,
  inheritanceView,
  lastInheritance,
} from './colonies.ts'

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
})

describe('homeBody', () => {
  it('is the body the system itself marks as home', () => {
    for (const seed of [1, 2, 3, 482913, 999999]) {
      const bodies = system(seed)
      expect(bodies[homeBody(seed)]?.home).toBe(true)
    }
  })
})

// FEAT: a mesma cadeia que o motor grava — a herança aponta para o colapso e para a fundação
const FOUNDED: EventRecord = { event: 'colony_founded', start: 1803, end: 1803, causes: [] }
const COLLAPSE: EventRecord = { event: 'collapse', start: 2283, end: null, causes: [] }
const MOVED: EventRecord = {
  event: 'inheritance',
  start: 2283,
  end: 2283,
  causes: [
    { kind: 'event', record: 1 },
    { kind: 'event', record: 0 },
  ],
}
const RECORDS: readonly EventRecord[] = [FOUNDED, COLLAPSE, MOVED]

describe('lastInheritance', () => {
  it('is null on a history that never changed worlds', () => {
    expect(lastInheritance([FOUNDED, COLLAPSE])).toBeNull()
  })

  it('finds the inheritance among the records', () => {
    expect(lastInheritance(RECORDS)).toBe(MOVED)
  })

  it('keeps the latest when a history changed worlds more than once', () => {
    const again: EventRecord = { ...MOVED, start: 4000, end: 4000 }
    expect(lastInheritance([...RECORDS, again])).toBe(again)
    expect(lastInheritance([again, ...RECORDS])).toBe(again)
  })
})

describe('inheritanceHeir', () => {
  it('follows the pointer the engine wrote, not a rule of its own', () => {
    const heir = colony({ body: 1, record: 0, population: 835_635 })
    const other = colony({ body: 3, record: 9, population: 2_000_000 })
    expect(inheritanceHeir(MOVED, RECORDS, [other, heir])).toBe(heir)
  })

  it('ignores causes that do not point at a founding', () => {
    const wrong = colony({ body: 2, record: 1 })
    expect(inheritanceHeir(MOVED, RECORDS, [wrong])).toBeNull()
  })

  it('is null when the heir was never seen on screen', () => {
    expect(inheritanceHeir(MOVED, RECORDS, [])).toBeNull()
  })
})

describe('inheritanceView', () => {
  it('says where the history went, from where, in what year and with how many', () => {
    const heir = colony({ body: 1, record: 0, population: 835_635 })
    const view = inheritanceView(MOVED, heir, 482913, homeBody(482913))
    expect(view).toEqual({
      year: 2283,
      body: bodyName(482913, 1),
      home: bodyName(482913, homeBody(482913)),
      people: 835_635,
    })
  })
})
