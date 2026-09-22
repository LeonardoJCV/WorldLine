import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { HORIZON, MODEL_VERSION } from '../../engine/params.ts'
import type { Allocation, Decision } from '../../engine/state.ts'
import { parseWorldFile, serializeWorld } from './file.ts'
import {
  decodeLink,
  decodeMultiverse,
  encodeLink,
  encodeMultiverse,
  isValidLink,
  isValidMultiverse,
  linkHash,
  toMultiverse,
  type MultiverseLink,
  type WorldLink,
} from './link.ts'
import { toSavedWorld } from './library.ts'
import { parseRoute } from './route.ts'
import { seedFromText } from './seed.ts'

const starved: Allocation = { agriculture: 5, industry: 50, research: 40, conservation: 5 }
const sample: WorldLink = {
  version: MODEL_VERSION,
  seed: 482913,
  tick: 320,
  decisions: [
    { tick: 100, allocation: starved },
    { tick: 250, allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 } },
  ],
}

const allocation = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
  )
  .map((cuts): Allocation => {
    const [a, b, c] = [...cuts].sort((x, y) => x - y) as [number, number, number]
    return { agriculture: a, industry: b - a, research: c - b, conservation: 100 - c }
  })

const link = fc
  .record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    tick: fc.integer({ min: 0, max: HORIZON }),
    decisions: fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: HORIZON - 1 }), allocation), {
      maxLength: 8,
      selector: ([tick]) => tick,
    }),
  })
  .map(({ seed, tick, decisions }): WorldLink => ({
    version: MODEL_VERSION,
    seed,
    tick,
    decisions: decisions
      .sort(([a], [b]) => a - b)
      .map(([at, alloc]): Decision => ({ tick: at, allocation: alloc })),
  }))

describe('seedFromText', () => {
  it('keeps whole numbers as they are', () => {
    expect(seedFromText('482913')).toBe(482913)
    expect(seedFromText(' 0 ')).toBe(0)
  })

  it('turns words into a stable seed', () => {
    expect(seedFromText('atlantis')).toBe(3286682525)
    expect(seedFromText(' Atlantis ')).toBe(3286682525)
    expect(seedFromText('eden')).not.toBe(seedFromText('atlantis'))
  })

  it('rejects empty text and numbers beyond the seed range', () => {
    expect(seedFromText('   ')).toBeNull()
    expect(seedFromText('99999999999')).toBeNull()
  })
})

describe('world link', () => {
  it('encodes a world without decisions compactly', () => {
    expect(encodeLink({ version: 1, seed: 482913, tick: 0, decisions: [] })).toBe('AQAHXmEAAAAA')
  })

  it('round-trips any valid world', () => {
    fc.assert(
      fc.property(link, (value) => {
        expect(decodeLink(encodeLink(value))).toEqual(value)
        return true
      }),
    )
  })

  it('rejects damaged or invalid payloads', () => {
    expect(decodeLink('')).toBeNull()
    expect(decodeLink('not base64!')).toBeNull()
    expect(decodeLink(encodeLink(sample).slice(0, -3))).toBeNull()
    expect(
      isValidLink({
        ...sample,
        decisions: [{ tick: 10, allocation: { ...starved, research: 0 } }],
      }),
    ).toBe(false)
    expect(isValidLink({ ...sample, tick: HORIZON + 1 })).toBe(false)
  })

  it('builds the observatory hash', () => {
    expect(linkHash(toMultiverse({ version: 1, seed: 482913, tick: 0, decisions: [] }))).toBe(
      '#/w/AQAHXmEAAAAA',
    )
  })

  it('rejects malformed payloads from untrusted storage without throwing', () => {
    expect(
      isValidLink({ version: 1, seed: 1, tick: 0, decisions: undefined } as unknown as WorldLink),
    ).toBe(false)
    expect(
      isValidLink({ version: 1, seed: 1, tick: 0, decisions: [null] } as unknown as WorldLink),
    ).toBe(false)
    expect(
      isValidLink({
        version: 1,
        seed: 1,
        tick: 0,
        decisions: [{ tick: 3 }],
      } as unknown as WorldLink),
    ).toBe(false)
  })
})

describe('parseRoute', () => {
  it('opens the observatory for a world link', () => {
    expect(parseRoute('#/w/AQAHXmEAAAAA', '')).toEqual({
      screen: 'observatory',
      link: { version: 1, seed: 482913, tick: 0, decisions: [], branches: [] },
      lens: 'current',
    })
  })

  it('opens the observatory for a seed query, words included', () => {
    expect(parseRoute('', '?seed=atlantis')).toEqual({
      screen: 'observatory',
      link: { version: MODEL_VERSION, seed: 3286682525, tick: 0, decisions: [], branches: [] },
      lens: 'current',
    })
  })

  it('falls back to genesis', () => {
    expect(parseRoute('', '')).toEqual({ screen: 'genesis' })
    expect(parseRoute('#/w/broken', '')).toEqual({ screen: 'genesis' })
  })

  it('opens the planet lens from the link suffix', () => {
    expect(parseRoute(`${linkHash(tree)}/planet`, '')).toEqual({
      screen: 'observatory',
      link: tree,
      lens: 'planet',
    })
  })
})

describe('world file', () => {
  it('round-trips through readable JSON', () => {
    const text = serializeWorld({ name: 'Harvest years', link: toMultiverse(sample) })
    expect(JSON.parse(text)).toMatchObject({
      format: 'worldline',
      name: 'Harvest years',
      seed: 482913,
    })
    expect(parseWorldFile(text)).toEqual({ name: 'Harvest years', link: toMultiverse(sample) })
  })

  it('rejects files that are not worlds', () => {
    expect(parseWorldFile('{')).toBeNull()
    expect(parseWorldFile(JSON.stringify({ format: 'other' }))).toBeNull()
    expect(
      parseWorldFile(
        serializeWorld({ name: 'x', link: toMultiverse(sample) }).replace(
          '"agriculture": 5',
          '"agriculture": 6',
        ),
      ),
    ).toBeNull()
  })
})

const tree: MultiverseLink = {
  ...sample,
  branches: [
    { parent: 0, fork: 100, decisions: [{ tick: 100, allocation: starved }] },
    { parent: 1, fork: 200, decisions: [] },
  ],
}

describe('multiverse link', () => {
  it('round-trips a tree of worldlines', () => {
    expect(decodeMultiverse(encodeMultiverse(tree))).toEqual(tree)
  })

  it('keeps single worlds on the short #/w/ form and trees on #/m/', () => {
    expect(linkHash(toMultiverse({ version: 1, seed: 482913, tick: 0, decisions: [] }))).toBe(
      '#/w/AQAHXmEAAAAA',
    )
    expect(linkHash(tree)).toMatch(/^#\/m\/[A-Za-z0-9_-]+$/)
  })

  it('rejects damaged or invalid multiverse payloads without throwing', () => {
    expect(decodeMultiverse('')).toBeNull()
    expect(decodeMultiverse('not base64!')).toBeNull()
    expect(decodeMultiverse(encodeMultiverse(tree).slice(0, -5))).toBeNull()
  })

  it('rejects impossible trees', () => {
    expect(isValidMultiverse({ ...tree, branches: [{ parent: 1, fork: 10, decisions: [] }] })).toBe(
      false,
    )
    expect(
      isValidMultiverse({ ...tree, branches: [{ parent: 0, fork: tree.tick + 1, decisions: [] }] }),
    ).toBe(false)
    expect(
      isValidMultiverse({
        ...tree,
        branches: [{ parent: 0, fork: 100, decisions: [{ tick: 90, allocation: starved }] }],
      }),
    ).toBe(false)
    expect(
      isValidMultiverse({
        ...tree,
        branches: Array.from({ length: 6 }, () => ({ parent: 0, fork: 1, decisions: [] })),
      }),
    ).toBe(false)
    expect(isValidMultiverse({ ...tree, branches: undefined } as unknown as MultiverseLink)).toBe(
      false,
    )
  })

  it('routes #/m/ links and converts older links', () => {
    expect(parseRoute(linkHash(tree), '')).toEqual({
      screen: 'observatory',
      link: tree,
      lens: 'current',
    })
    expect(parseRoute('#/w/AQAHXmEAAAAA', '')).toEqual({
      screen: 'observatory',
      link: { version: 1, seed: 482913, tick: 0, decisions: [], branches: [] },
      lens: 'current',
    })
  })

  it('writes branches to world files and reads files without them', () => {
    const text = serializeWorld({ name: 'Two futures', link: tree })
    expect(parseWorldFile(text)).toEqual({ name: 'Two futures', link: tree })
    const legacy = serializeWorld({ name: 'Old', link: toMultiverse(sample) }).replace(
      /,\s*"branches": \[\]/,
      '',
    )
    expect(parseWorldFile(legacy)?.link.branches).toEqual([])
  })
})

describe('library', () => {
  it('converts saved worlds tolerantly', () => {
    const legacyRow = {
      id: 'a',
      name: 'Old world',
      savedAt: 1,
      link: { version: MODEL_VERSION, seed: 482913, tick: 0, decisions: [] },
    }
    expect(toSavedWorld(legacyRow)?.link.branches).toEqual([])
    expect(toSavedWorld({ ...legacyRow, link: { ...legacyRow.link, branches: 'x' } })).toBeNull()
  })
})
