import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CROSSING_KINDS,
  crossingAmounts,
  DOSES,
  type Crossing,
  type CrossingKind,
} from '../../engine/crossing.ts'
import { GOLDEN_SCRIPTS, INHERITANCE_CASE } from '../../engine/golden.ts'
import { hashState } from '../../engine/hash.ts'
import { HORIZON, MODEL_VERSION } from '../../engine/params.ts'
import type { Allocation, Decision } from '../../engine/state.ts'
import { system } from '../../engine/system.ts'
import { Worldline } from '../../engine/worldline.ts'
import { SimulationHost } from '../../worker/host.ts'
import {
  toSnapshot,
  WORLDLINE_IDS,
  type FromWorker,
  type MergeSpec,
  type WorldProgress,
} from '../../worker/protocol.ts'
import { FakeClock } from '../../worker/testing.ts'
import type { WorldView } from '../sim/store.ts'
import { currentLink } from './current.ts'
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
  SEAMED_VERSION,
  toMultiverse,
  type MultiverseLink,
  type WorldLink,
} from './link.ts'
import { toSavedWorld } from './library.ts'
import { parseRoute } from './route.ts'
import { seedFromText } from './seed.ts'

const starved: Allocation = { agriculture: 5, industry: 50, research: 40, conservation: 5 }
const balanced: Allocation = { agriculture: 40, industry: 30, research: 20, conservation: 10 }
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

function withoutBytes(text: string, count: number): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return btoa(binary.slice(0, -count)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
    expect(isCompatibleVersion(SEAMED_VERSION)).toBe(true)
    expect(isCompatibleVersion(0)).toBe(false)
    expect(isCompatibleVersion(SEAMED_VERSION + 1)).toBe(false)
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

  it('opens the system lens from the link suffix, on both route shapes', () => {
    expect(parseRoute(`${linkHash(tree)}/system`, '')).toEqual({
      screen: 'observatory',
      link: tree,
      lens: 'system',
    })
    expect(parseRoute('#/w/AQAHXmEAAAAA/system', '')).toEqual({
      screen: 'observatory',
      link: { version: 1, seed: 482913, tick: 0, decisions: [], crossings: [], branches: [] },
      lens: 'system',
    })
  })

  it('falls back to genesis on an unknown suffix', () => {
    expect(parseRoute('#/w/AQAHXmEAAAAA/moon', '')).toEqual({ screen: 'genesis' })
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

// FEAT: os bytes que o escritor da versão 2 produzia antes da costura existir, copiados dele
const SEAMLESS_TREE = 'AgAHXmEBQAACAGQFMigFAPooHhQKAgAAZAABAGQFMigFAQDIAAAAAAA'
const SEAMLESS_CROSSED =
  'AgAHXmEBQAACAGQFMigFAPooHhQKAgAAZAABAGQFMigFAQDIAAACAHgBAgAGAQB4AkApAAAAAAAAP9AAAAAAAAABBAMDAQkCAQQBQLAAAAAAAAABAMgCAQACAADIAAUyKAUA'

// FEAT: os nomes são posições no link: a raiz é A, o primeiro galho é B, o segundo é C
const arrived: MergeSpec = { tick: 320, self: 'A', other: 'B', direction: 'in' }
const flowed: MergeSpec = { tick: 320, self: 'B', other: 'A', direction: 'out' }

const confluence: MultiverseLink = {
  ...tree,
  version: SEAMED_VERSION,
  merges: [arrived],
  branches: [
    {
      parent: 0,
      fork: 100,
      decisions: [{ tick: 100, allocation: starved }],
      crossings: [],
      merges: [flowed],
    },
    { parent: 1, fork: 200, decisions: [], crossings: [] },
  ],
}

describe('multiverse link', () => {
  it('round-trips a tree of worldlines', () => {
    expect(decodeMultiverse(encodeMultiverse(tree))).toEqual(tree)
  })

  it('writes a multiverse without a seam on the very bytes it always wrote', () => {
    expect(encodeMultiverse(tree)).toBe(SEAMLESS_TREE)
    expect(encodeMultiverse(crossed)).toBe(SEAMLESS_CROSSED)
    expect(linkHash(tree)).toBe(`#/m/${SEAMLESS_TREE}`)
    // FEAT: nenhum link já salvo muda de versão por causa de uma costura que ele não tem
    expect(decodeMultiverse(SEAMLESS_TREE)?.version).toBe(MODEL_VERSION)
    expect(decodeMultiverse(SEAMLESS_CROSSED)?.version).toBe(MODEL_VERSION)
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

describe('a link to a history that outlived its world', () => {
  it('reopens it on the same body, with the same fingerprint', () => {
    const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
    const value: MultiverseLink = {
      version: MODEL_VERSION,
      seed: INHERITANCE_CASE.seed,
      tick: INHERITANCE_CASE.year,
      decisions: plan.decisions,
      branches: [],
      crossings: plan.crossings,
    }
    const back = decodeMultiverse(encodeMultiverse(value))
    expect(back).toEqual(value)
    const file = parseWorldFile(serializeWorld({ name: 'Heir', link: value }))
    expect(file?.link).toEqual(value)

    const sent = new Worldline(value.seed, plan.decisions, null, plan.crossings)
    const opened = new Worldline(value.seed, back?.decisions ?? [], null, back?.crossings ?? [])
    sent.advance(INHERITANCE_CASE.year)
    opened.advance(INHERITANCE_CASE.year)
    expect(sent.present.status).toBe('running')
    expect(sent.present.home).not.toBeNull()
    expect(opened.present.home).toBe(sent.present.home)
    expect(hashState(opened.present)).toBe(INHERITANCE_CASE.hash)
    expect(hashState(opened.present)).toBe(hashState(sent.present))
  })
})

interface Sewn {
  readonly survivor: Worldline
  readonly departed: Worldline
}

// FEAT: o consumidor em miniatura — nada além do que voltou do link entra nesta reconstrução
function sew(link: MultiverseLink): Sewn {
  const spec = link.branches[0]
  const seam = link.merges?.[0]
  const away = spec?.merges?.[0]
  if (!spec || !seam || !away) throw new Error('the link dropped the confluence')
  const home = system(link.seed).find((body) => body.home)
  if (!home) throw new Error(`world ${link.seed} has no home body`)
  const survivor = new Worldline(link.seed, link.decisions, null, link.crossings ?? [])
  survivor.advance(seam.tick)
  const departed = new Worldline(
    link.seed,
    [...link.decisions.filter((decision) => decision.tick < spec.fork), ...spec.decisions],
    { parent: survivor, tick: spec.fork },
    spec.crossings ?? [],
  )
  departed.advance(away.tick)
  const leaving = departed.present
  survivor.merge({
    tick: seam.tick,
    self: seam.self,
    other: seam.other,
    direction: seam.direction,
    natal: home.index,
    values: toSnapshot(leaving).values,
    debts: leaving.debts,
    echoes: leaving.echoes,
    paradox: leaving.paradox,
    strain: leaving.strain,
    colonies: leaving.colonies,
    home: leaving.home,
  })
  departed.merge({
    tick: away.tick,
    self: away.self,
    other: away.other,
    direction: away.direction,
    natal: home.index,
  })
  departed.advance(1)
  survivor.advance(link.tick - seam.tick)
  return { survivor, departed }
}

// FEAT: o hospedeiro de verdade costura; o teste não tem opinião sobre o que uma costura carrega
function sewnByTheHost(): { readonly worlds: WorldProgress[]; readonly now: number } {
  const sent: FromWorker[] = []
  const host = new SimulationHost((message) => sent.push(message), new FakeClock())
  host.handle({ type: 'open', seed: sample.seed, tick: 0, root: [], branches: [] })
  host.handle({ type: 'step', years: 300 })
  host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 100, allocation: balanced })
  host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 100, allocation: starved })
  // FEAT: uma dívida com uma terceira história, que a costura precisa levar junto para a anfitriã
  host.handle({
    type: 'cross',
    requestId: 3,
    origin: 'C',
    destination: 'B',
    kind: 'knowledge',
    dose: 1,
  })
  host.handle({ type: 'step', years: 1 })
  host.handle({ type: 'merge', requestId: 4, survivor: 'A', other: 'B' })
  host.handle({ type: 'step', years: 5 })
  const progress = sent.filter((message) => message.type === 'progress').at(-1)
  if (!progress) throw new Error('the host reported nothing')
  return { worlds: [...progress.worlds], now: progress.now }
}

function viewOf(world: WorldProgress): WorldView {
  return {
    info: world.info,
    present: world.present,
    events: [],
    decisions: world.decisions,
    crossings: world.crossings,
    merges: world.merges,
    debts: world.debts,
    previousDebts: null,
    paradox: world.paradox,
    colonies: world.colonies,
  }
}

describe('a link that carries a confluence', () => {
  it('rises to version 3 and brings both sides of the seam back', () => {
    const text = encodeMultiverse(confluence)
    expect(decodeMultiverse(text)).toEqual(confluence)
    expect(text).not.toBe(SEAMLESS_TREE)
    // FEAT: a versão sai do que o link carrega, não do número que veio escrito nele
    expect(decodeMultiverse(encodeMultiverse({ ...confluence, version: 1 }))?.version).toBe(
      SEAMED_VERSION,
    )
    expect(decodeMultiverse(SEAMLESS_TREE)?.merges).toBeUndefined()
    expect(decodeMultiverse(SEAMLESS_TREE)?.branches[0]?.merges).toBeUndefined()
  })

  it('reopens, from the link alone, the confluence the host actually sewed', () => {
    const { worlds, now } = sewnByTheHost()
    const link = currentLink({ seed: sample.seed, now, worlds: worlds.map(viewOf) })
    if (!link) throw new Error('the host gave no link')
    const back = decodeMultiverse(encodeMultiverse(link))
    expect(back).toEqual(link)
    expect(back?.version).toBe(SEAMED_VERSION)
    if (!back) throw new Error('the link did not survive')

    const host = { survivor: worlds[0], departed: worlds[1] }
    if (!host.survivor || !host.departed) throw new Error('the host lost a history')
    const opened = sew(back)
    // FEAT: `previous` é a âncora que o hospedeiro guarda para a tela, não estado do modelo
    expect(toSnapshot(opened.survivor.present)).toEqual({
      ...host.survivor.present,
      previous: null,
    })
    expect(toSnapshot(opened.departed.present)).toEqual({
      ...host.departed.present,
      previous: null,
    })
    expect(host.departed.present.status).toBe('merged')
    // FEAT: o Snapshot não carrega o livro-razão, então a dívida herdada se confere à parte
    expect(host.survivor.debts.map((debt) => debt.origin)).toEqual(['C'])
    expect(opened.survivor.present.debts).toEqual(host.survivor.debts)

    // FIX: sem a costura a sobrevivente segue outra história, então a igualdade acima não é de graça
    const unseamed = new Worldline(link.seed, link.decisions, null, link.crossings ?? [])
    unseamed.advance(link.tick)
    expect(unseamed.present.tick).toBe(opened.survivor.present.tick)
    expect(hashState(unseamed.present)).not.toBe(hashState(opened.survivor.present))
  })

  it('refuses a seam block cut short instead of reading half of it', () => {
    const text = encodeMultiverse(confluence)
    // FEAT: treze bytes de costura — contagem e registro de cada worldline; nenhum corte é legível
    for (let cut = 1; cut <= 13; cut++) {
      expect(decodeMultiverse(withoutBytes(text, cut))).toBeNull()
    }
    expect(decodeMultiverse(withExtraByte(text))).toBeNull()
  })

  it('refuses a confluence the engine would refuse, without throwing', () => {
    expect(isValidMultiverse({ ...confluence, merges: [arrived, { ...arrived, tick: 310 }] })).toBe(
      false,
    )
    expect(
      isValidMultiverse({
        ...confluence,
        merges: [
          { ...flowed, tick: 300 },
          { ...arrived, tick: 310 },
        ],
      }),
    ).toBe(false)
    expect(isValidMultiverse({ ...confluence, merges: [{ ...arrived, other: 'A' }] })).toBe(false)
    expect(
      isValidMultiverse({ ...confluence, merges: [{ ...arrived, tick: confluence.tick + 1 }] }),
    ).toBe(false)
    expect(
      isValidMultiverse({
        ...confluence,
        merges: [{ ...arrived, direction: 'sideways' }] as unknown as readonly MergeSpec[],
      }),
    ).toBe(false)
    expect(
      isValidMultiverse({ ...confluence, merges: 'x' as unknown as readonly MergeSpec[] }),
    ).toBe(false)
    // FIX: `self` que discorda do bloco faria `settleDebts` apagar dívida de uma história inocente
    expect(isValidMultiverse({ ...confluence, merges: [{ ...arrived, self: 'C' }] })).toBe(false)
    expect(
      isValidMultiverse({
        ...confluence,
        branches: [
          { parent: 0, fork: 100, decisions: [], merges: [{ ...flowed, self: 'A', other: 'C' }] },
        ],
      }),
    ).toBe(false)
    expect(
      isValidMultiverse({
        ...confluence,
        merges: [],
        branches: [{ parent: 0, fork: 100, decisions: [], merges: [{ ...flowed, tick: 50 }] }],
      }),
    ).toBe(false)
    expect(
      decodeMultiverse(
        encodeMultiverse({
          ...confluence,
          merges: [
            { ...flowed, tick: 300 },
            { ...arrived, tick: 310 },
          ],
        }),
      ),
    ).toBeNull()
  })

  it('refuses a seam in the last year of the horizon, which the engine throws on', () => {
    const edge: MultiverseLink = {
      version: SEAMED_VERSION,
      seed: sample.seed,
      tick: HORIZON,
      decisions: [],
      crossings: [],
      // FEAT: a costura nomeia B, então o link tem de carregar B para ela ser remontável
      branches: [{ parent: 0, fork: 0, decisions: [], crossings: [] }],
      merges: [{ tick: HORIZON, self: 'A', other: 'B', direction: 'in' }],
    }
    expect(isValidMultiverse(edge)).toBe(false)
    expect(decodeMultiverse(encodeMultiverse(edge))).toBeNull()
    // FEAT: sem a recusa o link reabriria e quem estouraria seria a engine, com o mundo já aberto
    expect(
      () =>
        new Worldline(
          sample.seed,
          [],
          null,
          [],
          [{ tick: HORIZON, self: 'A', other: 'B', direction: 'in', natal: 0 }],
        ),
    ).toThrow(RangeError)
    const inside: MergeSpec = { tick: HORIZON - 1, self: 'A', other: 'B', direction: 'in' }
    expect(isValidMultiverse({ ...edge, merges: [inside] })).toBe(true)
  })

  it('refuses a confluence that names a history the link does not carry', () => {
    const lone: MultiverseLink = {
      ...sample,
      version: SEAMED_VERSION,
      crossings: [],
      branches: [],
      // FEAT: 255 segue lido como ausente, e o byte continua legível; o que não existe é o mundo
      merges: [{ tick: 320, self: 'A', other: '', direction: 'in' }],
    }
    // FEAT: a costura ainda vai e volta pelos bytes, e a forma longa segue sendo a dela
    expect(linkHash(lone)).toMatch(/^#\/m\//)
    // FIX: sem a outra história o hospedeiro não remonta o recibo, então o link não reabre mundo
    expect(isValidMultiverse(lone)).toBe(false)
    expect(decodeMultiverse(encodeMultiverse(lone))).toBeNull()
    expect(isValidMultiverse({ ...lone, merges: [{ ...arrived, other: 'C' }] })).toBe(false)
    // FEAT: a recusa é estreita: com a história no link a mesma costura passa
    const pair: MultiverseLink = {
      ...lone,
      branches: [{ parent: 0, fork: 0, decisions: [], crossings: [], merges: [flowed] }],
      merges: [arrived],
    }
    expect(isValidMultiverse(pair)).toBe(true)
    expect(decodeMultiverse(encodeMultiverse(pair))).toEqual(pair)
  })
})

// FEAT: o último relatório de uma história, que é onde o mundo reaberto tem de bater com o vivido
function told(world: WorldProgress) {
  return {
    info: world.info,
    present: world.present,
    decisions: world.decisions,
    crossings: world.crossings,
    merges: world.merges,
    debts: world.debts,
    paradox: world.paradox,
    colonies: world.colonies,
  }
}

// FEAT: a história do costurador e, depois da costura, uma filha que tem de nascer já costurada
function sewnThenBranched() {
  const sent: FromWorker[] = []
  const host = new SimulationHost((message) => sent.push(message), new FakeClock())
  host.handle({ type: 'open', seed: sample.seed, tick: 0, root: [], branches: [] })
  host.handle({ type: 'step', years: 300 })
  host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 100, allocation: balanced })
  host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 100, allocation: starved })
  host.handle({
    type: 'cross',
    requestId: 3,
    origin: 'C',
    destination: 'B',
    kind: 'knowledge',
    dose: 1,
  })
  host.handle({ type: 'step', years: 1 })
  host.handle({ type: 'merge', requestId: 4, survivor: 'A', other: 'B' })
  host.handle({ type: 'step', years: 1 })
  host.handle({ type: 'branch', requestId: 5, parent: 'A', tick: 302, allocation: balanced })
  host.handle({ type: 'step', years: 5 })
  const progress = sent.filter((message) => message.type === 'progress').at(-1)
  if (!progress) throw new Error('the host reported nothing')
  return { worlds: [...progress.worlds], now: progress.now, credit: progress.credit }
}

// FEAT: o hospedeiro de verdade reabrindo, sem nada além do que voltou do link
function reopen(link: MultiverseLink) {
  const sent: FromWorker[] = []
  const host = new SimulationHost((message) => sent.push(message), new FakeClock())
  host.handle({
    type: 'open',
    seed: link.seed,
    tick: link.tick,
    root: link.decisions,
    branches: link.branches,
    crossings: link.crossings ?? [],
    merges: link.merges ?? [],
  })
  const failure = sent.find((message) => message.type === 'error')
  if (failure) throw new Error(failure.type === 'error' ? failure.message : 'the host failed')
  const progress = sent.filter((message) => message.type === 'progress').at(-1)
  if (!progress) throw new Error('the reopened host reported nothing')
  return { worlds: [...progress.worlds], now: progress.now, credit: progress.credit }
}

describe('a seamed multiverse reopened from its own link', () => {
  it('brings every history back the way it was lived, the branch after the seam included', () => {
    const lived = sewnThenBranched()
    const link = currentLink({
      seed: sample.seed,
      now: lived.now,
      worlds: lived.worlds.map(viewOf),
    })
    if (!link) throw new Error('the host gave no link')
    const back = decodeMultiverse(encodeMultiverse(link))
    if (!back) throw new Error('the link did not survive')
    expect(back).toEqual(link)
    expect(back.version).toBe(SEAMED_VERSION)

    const again = reopen(back)
    expect(again.now).toBe(lived.now)
    expect(again.credit).toBe(lived.credit)
    expect(again.worlds.map(told)).toEqual(lived.worlds.map(told))
    expect(again.worlds.map((world) => world.present.status)).toEqual([
      'running',
      'merged',
      'running',
      'running',
    ])

    // FEAT: a sobrevivente reaberta é o estado cuja impressão digital o consumidor em miniatura nomeia
    const reference = sew(back).survivor
    expect(toSnapshot(reference.present)).toEqual({
      ...(again.worlds[0]?.present ?? null),
      previous: null,
    })
    const unseamed = new Worldline(back.seed, back.decisions, null, back.crossings ?? [])
    unseamed.advance(back.tick)
    expect(hashState(unseamed.present)).not.toBe(hashState(reference.present))
  })

  it('reopens the same multiverse from the world file as from the link', () => {
    const lived = sewnThenBranched()
    const link = currentLink({
      seed: sample.seed,
      now: lived.now,
      worlds: lived.worlds.map(viewOf),
    })
    if (!link) throw new Error('the host gave no link')
    const file = parseWorldFile(serializeWorld({ name: 'Confluence', link }))
    if (!file) throw new Error('the file did not survive')
    expect(file.link).toEqual(link)
    expect(reopen(file.link).worlds.map(told)).toEqual(lived.worlds.map(told))
  })

  it('reopens a link without a seam exactly as it always did', () => {
    const plain = decodeMultiverse(SEAMLESS_TREE)
    if (!plain) throw new Error('the seamless link did not decode')
    expect(plain.version).toBe(MODEL_VERSION)
    expect(plain.merges).toBeUndefined()
    const again = reopen(plain)
    expect(again.worlds.map((world) => world.info.id)).toEqual(['A', 'B', 'C'])
    expect(again.worlds.every((world) => world.merges.length === 0)).toBe(true)
    expect(again.now).toBe(plain.tick)
  })
})

describe('a world file that carries a confluence', () => {
  it('writes the seam and a version that describes what it wrote', () => {
    const text = serializeWorld({ name: 'Confluence', link: confluence })
    expect(JSON.parse(text)).toMatchObject({ version: SEAMED_VERSION, merges: [arrived] })
    expect(parseWorldFile(text)).toEqual({ name: 'Confluence', link: confluence })
    // FIX: sem as costuras no arquivo o mundo reabria sem elas, e a versão 3 mentia sobre isso
    const dropped = text.replace(/"merges": \[[^\]]*\]/g, '"merges": []')
    expect(parseWorldFile(dropped)?.link.merges).toBeUndefined()
    expect(parseWorldFile(dropped)?.link).not.toEqual(confluence)
    // FIX: a versão vinha copiada do link, então um mundo sem costura nenhuma se dizia costurado
    const plain = serializeWorld({ name: 'Plain', link: { ...tree, version: SEAMED_VERSION } })
    expect(JSON.parse(plain).version).toBe(MODEL_VERSION)
    expect(parseWorldFile(plain)?.link).toEqual(tree)
  })

  it('refuses a confluence in a file that the link rules refuse', () => {
    const text = serializeWorld({ name: 'Confluence', link: confluence })
    // FIX: `parseWorldFile` nunca extraía `merges`, então nesta porta a recusa da T3 era inerte
    expect(parseWorldFile(text.replace('"self": "A"', '"self": "C"'))).toBeNull()
    expect(parseWorldFile(text.replace('"direction": "in"', '"direction": "sideways"'))).toBeNull()
    expect(parseWorldFile(text.replace('"other": "B"', '"other": "A"'))).toBeNull()
    expect(parseWorldFile(text.replace('"merges": [', '"merges": "none", "spare": ['))).toBeNull()
  })
})
