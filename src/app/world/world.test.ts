import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CROSSING_KINDS,
  crossingAmounts,
  DOSES,
  type Crossing,
  type CrossingKind,
} from '../../engine/crossing.ts'
import { HORIZON, MODEL_VERSION } from '../../engine/params.ts'
import type { Allocation, Decision } from '../../engine/state.ts'
import { Worldline } from '../../engine/worldline.ts'
import { WORLDLINE_IDS } from '../../worker/protocol.ts'
import { parseWorldFile, serializeWorld } from './file.ts'
import {
  decodeLink,
  decodeMultiverse,
  encodeLink,
  encodeMultiverse,
  isCompatibleVersion,
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
    crossings: [],
  }))

const PARCELS: Readonly<Record<CrossingKind, number>> = {
  knowledge: 1,
  resource: 2,
  doctrine: 0,
  people: 1,
}

const crossing = fc
  .record({
    tick: fc.integer({ min: 0, max: HORIZON - 1 }),
    kind: fc.constantFrom(...CROSSING_KINDS),
    dose: fc.constantFrom(...DOSES),
    cost: fc.integer({ min: 0, max: 255 }),
    parcels: fc.array(fc.double({ min: 0, max: 1e9, noNaN: true }), {
      minLength: 2,
      maxLength: 2,
    }),
    world: fc.constantFrom(...WORLDLINE_IDS),
    leaving: fc.boolean(),
    circular: fc.boolean(),
    allocation,
  })
  .map((draw): Crossing => {
    const doctrine = draw.kind === 'doctrine'
    return {
      tick: draw.tick,
      kind: draw.kind,
      dose: draw.dose,
      amounts: draw.parcels.slice(0, PARCELS[draw.kind]),
      origin: { world: draw.world, tick: draw.tick },
      cost: draw.cost,
      direction: draw.kind === 'people' && draw.leaving ? 'out' : 'in',
      ...(doctrine ? { allocation: draw.allocation } : {}),
      ...(draw.circular ? { circular: true } : {}),
    }
  })

const log = fc
  .array(crossing, { maxLength: 6 })
  .map((list) => [...list].sort((a, b) => a.tick - b.tick))

function withExtraByte(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return btoa(`${binary}\0`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

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

  it('trusts every version that opens the same world', () => {
    expect(isCompatibleVersion(1)).toBe(true)
    expect(isCompatibleVersion(MODEL_VERSION)).toBe(true)
    expect(isCompatibleVersion(0)).toBe(false)
    expect(isCompatibleVersion(MODEL_VERSION + 1)).toBe(false)
    expect(isCompatibleVersion(7)).toBe(false)
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
      link: { version: 1, seed: 482913, tick: 0, decisions: [], crossings: [], branches: [] },
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
  crossings: [],
  branches: [
    { parent: 0, fork: 100, decisions: [{ tick: 100, allocation: starved }], crossings: [] },
    { parent: 1, fork: 200, decisions: [], crossings: [] },
  ],
}

const arrival: Crossing = {
  tick: 120,
  kind: 'resource',
  dose: 2,
  amounts: [12.5, 0.25],
  origin: { world: 'B', tick: 120 },
  cost: 6,
  direction: 'in',
}

const doctrine: Crossing = {
  tick: 200,
  kind: 'doctrine',
  dose: 1,
  amounts: [],
  origin: { world: 'A', tick: 200 },
  cost: 2,
  direction: 'in',
  allocation: starved,
}

const departure: Crossing = {
  tick: 260,
  kind: 'people',
  dose: 3,
  amounts: [4096],
  origin: { world: 'C', tick: 260 },
  cost: 9,
  direction: 'out',
}

const crossed: MultiverseLink = {
  ...tree,
  crossings: [arrival, departure],
  branches: [
    {
      parent: 0,
      fork: 100,
      decisions: [{ tick: 100, allocation: starved }],
      crossings: [doctrine],
    },
    { parent: 1, fork: 200, decisions: [], crossings: [] },
  ],
}

// FEAT: gravado pelo escritor da versão 1, antes das travessias existirem
const VERSION_1 = 'AQAHXmEBQAACAGQFMigFAPooHhQKAgAAZAABAGQFMigFAQDIAAA'

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

  it('carries crossings back and forth', () => {
    expect(decodeMultiverse(encodeMultiverse(crossed))).toEqual(crossed)
  })

  it('carries the crossings of a world without branches', () => {
    const alone: MultiverseLink = { ...sample, branches: [], crossings: [arrival, departure] }
    expect(decodeMultiverse(encodeMultiverse(alone))).toEqual(alone)
    expect(linkHash(alone)).toMatch(/^#\/m\//)
  })

  it('keeps an amount exact, so a shared world reproduces the same history', () => {
    const source = new Worldline(482913)
    source.advance(400)
    const amounts = crossingAmounts('knowledge', 3, source.present)
    const first = amounts[0] ?? 0
    // FEAT: um valor que a precisão simples perderia, para o teste valer alguma coisa
    expect(Math.fround(first)).not.toBe(first)
    const gift: Crossing = {
      tick: 400,
      kind: 'knowledge',
      dose: 3,
      amounts,
      origin: { world: 'B', tick: 400 },
      cost: 14,
      direction: 'in',
    }
    const value: MultiverseLink = { ...sample, tick: 600, branches: [], crossings: [gift] }
    const back = decodeMultiverse(encodeMultiverse(value))
    expect(back?.crossings?.[0]?.amounts[0]).toBe(first)
    const sent = new Worldline(sample.seed, sample.decisions, null, [gift])
    const opened = new Worldline(sample.seed, sample.decisions, null, back?.crossings ?? [])
    sent.advance(600)
    opened.advance(600)
    expect(opened.hashAt(600)).toBe(sent.hashAt(600))
  })

  it('carries the circular flag, so a world that collapsed from a loop reopens collapsed', () => {
    // FEAT: pesquisa zerada nunca quita o presente, e o ciclo marca o paradoxo no ano zero
    const idle: Decision[] = [
      { tick: 0, allocation: { agriculture: 40, industry: 60, research: 0, conservation: 0 } },
    ]
    const plain: Crossing = {
      tick: 0,
      kind: 'knowledge',
      dose: 3,
      amounts: [10],
      origin: { world: 'B', tick: 0 },
      cost: 9,
      direction: 'in',
    }
    const loop: Crossing = { ...plain, circular: true }
    const value: MultiverseLink = {
      version: MODEL_VERSION,
      seed: 482913,
      tick: 0,
      decisions: idle,
      branches: [],
      crossings: [loop],
    }
    const back = decodeMultiverse(encodeMultiverse(value))
    expect(back).toEqual(value)
    const file = parseWorldFile(serializeWorld({ name: 'Loop', link: value }))
    expect(file?.link).toEqual(value)

    const sent = new Worldline(value.seed, idle, null, [loop])
    const opened = new Worldline(value.seed, idle, null, back?.crossings ?? [])
    const dropped = new Worldline(value.seed, idle, null, [plain])
    sent.advance(600)
    opened.advance(600)
    dropped.advance(600)
    const year = sent.present.tick
    expect(sent.present.status).toBe('collapsed')
    expect(opened.present.tick).toBe(year)
    expect(opened.present.status).toBe('collapsed')
    // FIX: sem a bandeira o mundo reaberto colapsava noutro ano, com outra impressão digital
    expect(opened.hashAt(year)).toBe(sent.hashAt(year))
    expect(dropped.present.tick).not.toBe(year)
  })

  it('round-trips any crossing log', () => {
    fc.assert(
      fc.property(link, log, (base, crossings) => {
        const value: MultiverseLink = { ...base, branches: [], crossings }
        expect(decodeMultiverse(encodeMultiverse(value))).toEqual(value)
        return true
      }),
    )
  })

  it('still reads a version 1 link', () => {
    expect(decodeMultiverse(VERSION_1)).toEqual({ ...tree, version: 1 })
  })

  it('refuses trailing bytes', () => {
    expect(decodeMultiverse(withExtraByte(encodeMultiverse(crossed)))).toBeNull()
    expect(decodeMultiverse(withExtraByte(VERSION_1))).toBeNull()
  })

  it('refuses a corrupted crossing log without throwing', () => {
    const swapped: MultiverseLink = { ...crossed, crossings: [departure, arrival] }
    expect(decodeMultiverse(encodeMultiverse(swapped))).toBeNull()
    expect(isValidMultiverse({ ...crossed, crossings: [{ ...arrival, amounts: [1] }] })).toBe(false)
    expect(isValidMultiverse({ ...crossed, crossings: [{ ...arrival, cost: 1e9 }] })).toBe(false)
    expect(
      isValidMultiverse({
        ...crossed,
        crossings: [{ ...arrival, kind: 'gossip' }] as unknown as Crossing[],
      }),
    ).toBe(false)
    expect(
      isValidMultiverse({
        ...crossed,
        crossings: [],
        branches: [{ parent: 0, fork: 100, decisions: [], crossings: [{ ...doctrine, tick: 50 }] }],
      }),
    ).toBe(false)
    expect(
      isValidMultiverse({ ...crossed, crossings: 'x' as unknown as readonly Crossing[] }),
    ).toBe(false)
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
      link: { version: 1, seed: 482913, tick: 0, decisions: [], crossings: [], branches: [] },
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

  it('writes crossings to world files and reads files without them', () => {
    const text = serializeWorld({ name: 'Crossed', link: crossed })
    expect(JSON.parse(text)).toMatchObject({
      version: MODEL_VERSION,
      crossings: [arrival, departure],
    })
    expect(parseWorldFile(text)).toEqual({ name: 'Crossed', link: crossed })
    const legacy = serializeWorld({ name: 'Old', link: tree }).replace(
      /,?\s*"crossings": \[\]/g,
      '',
    )
    expect(parseWorldFile(legacy)?.link).toEqual(tree)
  })

  it('rejects a world file whose crossings break the rules', () => {
    const text = serializeWorld({ name: 'Crossed', link: crossed })
    expect(parseWorldFile(text.replace('"cost": 6', '"cost": -1'))).toBeNull()
    expect(parseWorldFile(text.replace('"kind": "resource"', '"kind": "gossip"'))).toBeNull()
    expect(parseWorldFile(text.replace('"tick": 120', '"tick": 1e9'))).toBeNull()
    expect(parseWorldFile(text.replace('"crossings": [', '"crossings": "none", "spare": ['))).toBe(
      null,
    )
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
