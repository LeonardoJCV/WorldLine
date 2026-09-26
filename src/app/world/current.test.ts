import { describe, expect, it } from 'vitest'
import type { Crossing } from '../../engine/crossing.ts'
import type { Merge } from '../../engine/merge.ts'
import { MODEL_VERSION } from '../../engine/params.ts'
import type { Snapshot } from '../../worker/protocol.ts'
import type { WorldView } from '../sim/store.ts'
import { currentLink } from './current.ts'
import { SEAMED_VERSION } from './link.ts'

const present = { tick: 90 } as Snapshot
const early = {
  tick: 10,
  allocation: { agriculture: 30, industry: 30, research: 30, conservation: 10 },
}
const late = {
  tick: 50,
  allocation: { agriculture: 10, industry: 40, research: 40, conservation: 10 },
}

const fromC: Crossing = {
  tick: 70,
  kind: 'knowledge',
  dose: 1,
  amounts: [4],
  origin: { world: 'C', tick: 70 },
  cost: 3,
  direction: 'in',
}
const inherited: Crossing = { ...fromC, tick: 20, origin: { world: 'A', tick: 20 } }
const own: Crossing = { ...fromC, tick: 80, origin: { world: 'A', tick: 80 } }
const orphan: Crossing = { ...fromC, tick: 85, origin: { world: 'F', tick: 85 } }

// FEAT: uma costura antiga com um mundo que já saiu do multiverso, e outra com a história C
const withGone: Merge = { tick: 30, self: 'A', other: 'F', direction: 'in', natal: 2 }
const seam: Merge = { tick: 88, self: 'A', other: 'C', direction: 'in', natal: 2 }
const away: Merge = { tick: 88, self: 'C', other: 'A', direction: 'out', natal: 2 }

const worlds: WorldView[] = [
  {
    info: { id: 'A', parent: null, fork: 0, generation: 1 },
    present,
    events: [],
    crossings: [fromC],
    decisions: [early],
    debts: [],
    previousDebts: null,
    paradox: null,
    colonies: [],
    merges: [],
  },
  {
    info: { id: 'C', parent: 'A', fork: 40, generation: 3 },
    present,
    events: [],
    crossings: [inherited, own, orphan],
    decisions: [early, late],
    debts: [],
    previousDebts: null,
    paradox: null,
    colonies: [],
    merges: [],
  },
  {
    info: { id: 'B', parent: 'C', fork: 60, generation: 4 },
    present,
    events: [],
    crossings: [],
    decisions: [early, late],
    debts: [],
    previousDebts: null,
    paradox: null,
    colonies: [],
    merges: [],
  },
]

const seamed: WorldView[] = worlds.map((world, index) => {
  if (index === 0) return { ...world, merges: [withGone, seam] }
  // FEAT: a costura de 30 é passado herdado do pai, anterior à bifurcação de C no ano 40
  if (index === 1) return { ...world, merges: [withGone, away] }
  return world
})

describe('currentLink', () => {
  it('describes the multiverse in creation order with parent indexes and own decisions', () => {
    expect(currentLink({ seed: 7, now: 90, worlds })).toMatchObject({
      seed: 7,
      tick: 90,
      decisions: [early],
      branches: [
        { parent: 0, fork: 40, decisions: [late] },
        { parent: 1, fork: 60, decisions: [] },
      ],
    })
  })

  it('keeps the crossings each world opened after its fork', () => {
    const link = currentLink({ seed: 7, now: 90, worlds })
    expect(link?.crossings).toEqual([{ ...fromC, origin: { world: 'B', tick: 70 } }])
    expect(link?.branches[0]?.crossings).toEqual([
      own,
      { ...orphan, origin: { world: '', tick: 85 } },
    ])
    expect(link?.branches[1]?.crossings).toEqual([])
  })

  it('returns nothing before a world exists', () => {
    expect(currentLink({ seed: null, now: 0, worlds: [] })).toBeNull()
  })

  it('names both sides of a seam by position and drops the one it inherited', () => {
    const link = currentLink({ seed: 7, now: 90, worlds: seamed })
    expect(link?.version).toBe(SEAMED_VERSION)
    expect(link?.merges).toEqual([
      { tick: 30, self: 'A', other: '', direction: 'in' },
      { tick: 88, self: 'A', other: 'B', direction: 'in' },
    ])
    expect(link?.branches[0]?.merges).toEqual([
      { tick: 88, self: 'B', other: 'A', direction: 'out' },
    ])
    expect(link?.branches[1]?.merges).toBeUndefined()
  })

  it('leaves a multiverse that never sewed anything on the version it had', () => {
    const link = currentLink({ seed: 7, now: 90, worlds })
    expect(link?.version).toBe(MODEL_VERSION)
    expect(link?.merges).toBeUndefined()
    expect(link?.branches.map((branch) => branch.merges)).toEqual([undefined, undefined])
  })
})
