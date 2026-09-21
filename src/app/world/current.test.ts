import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../worker/protocol.ts'
import type { WorldView } from '../sim/store.ts'
import { currentLink } from './current.ts'

const present = { tick: 90 } as Snapshot
const early = {
  tick: 10,
  allocation: { agriculture: 30, industry: 30, research: 30, conservation: 10 },
}
const late = {
  tick: 50,
  allocation: { agriculture: 10, industry: 40, research: 40, conservation: 10 },
}

const worlds: WorldView[] = [
  {
    info: { id: 'A', parent: null, fork: 0, generation: 1 },
    present,
    events: [],
    decisions: [early],
  },
  {
    info: { id: 'C', parent: 'A', fork: 40, generation: 3 },
    present,
    events: [],
    decisions: [early, late],
  },
  {
    info: { id: 'B', parent: 'C', fork: 60, generation: 4 },
    present,
    events: [],
    decisions: [early, late],
  },
]

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

  it('returns nothing before a world exists', () => {
    expect(currentLink({ seed: null, now: 0, worlds: [] })).toBeNull()
  })
})
