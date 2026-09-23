import { describe, expect, it } from 'vitest'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import { ASSIMILATION, KEEP } from '../../engine/echo.ts'
import type { Crossing, CrossingKind } from '../../engine/crossing.ts'
import type { RangeResult } from '../sim/client.ts'
import { axisPoint, buildPath, type PathData } from './path.ts'
import {
  ECHO_YEARS,
  MAX_ARCS,
  assimilationLeft,
  crossingArcs,
  echoWindows,
  type CrossingWorld,
} from './crossings.ts'

function series(from: number, to: number, count: number): RangeResult {
  const out = {} as Record<Variable, Float32Array>
  for (const variable of VARIABLES) out[variable] = new Float32Array(count).fill(50)
  out.population = new Float32Array(count).fill(1e6)
  return { from, to, series: out }
}

function path(from: number, to: number, lift: number, start = from, visible = true): PathData {
  const built = buildPath(
    series(from, to, 11),
    new Float32Array(16 * 2).fill(lift),
    from,
    to,
    start,
    16,
  )
  return visible ? built : { ...built, visible: false }
}

function crossing(overrides: Partial<Crossing> = {}): Crossing {
  return {
    tick: 50,
    kind: 'knowledge',
    dose: 1,
    amounts: [4],
    origin: { world: 'A', tick: 40 },
    cost: 2,
    direction: 'in',
    ...overrides,
  }
}

function world(id: string, crossings: readonly Crossing[], p: PathData): CrossingWorld {
  return { id, crossings, path: p }
}

describe('crossingArcs', () => {
  it('draws one arc per incoming crossing and none for the mirrored outgoing record', () => {
    const worlds = [
      world(
        'A',
        [crossing({ direction: 'out', kind: 'people', amounts: [3], dose: 1 })],
        path(0, 100, 0),
      ),
      world('B', [crossing()], path(0, 100, 1)),
    ]
    const arcs = crossingArcs(worlds, 0, 100)
    expect(arcs).toHaveLength(1)
    expect(arcs[0]?.destination).toBe('B')
    expect(arcs[0]?.origin).toBe('A')
    expect(arcs[0]?.key).toBe('crossing:B:50:knowledge')
  })

  it('places both ends via axisPoint at the origin and destination u', () => {
    const originPath = path(0, 100, 0)
    const destPath = path(0, 100, 1)
    const worlds = [world('A', [], originPath), world('B', [crossing()], destPath)]
    const arcs = crossingArcs(worlds, 0, 100)
    const span = 100 - 0
    expect(arcs[0]?.from).toEqual(axisPoint(originPath, (40 - 0) / span))
    expect(arcs[0]?.to).toEqual(axisPoint(destPath, (50 - 0) / span))
  })

  it('skips a crossing outside the window, and one with only one end inside it', () => {
    const worlds = [
      world('A', [], path(0, 100, 0)),
      world(
        'B',
        [
          crossing({ tick: 500, origin: { world: 'A', tick: 490 } }),
          crossing({ tick: 60, origin: { world: 'A', tick: -10 } }),
        ],
        path(0, 100, 1),
      ),
    ]
    expect(crossingArcs(worlds, 0, 100)).toHaveLength(0)
  })

  it('skips a crossing when either endpoint path is invisible', () => {
    const invisibleOrigin = [
      world('A', [], path(0, 100, 0, 0, false)),
      world('B', [crossing()], path(0, 100, 1)),
    ]
    expect(crossingArcs(invisibleOrigin, 0, 100)).toHaveLength(0)

    const invisibleDest = [
      world('A', [], path(0, 100, 0)),
      world('B', [crossing()], path(0, 100, 1, 0, false)),
    ]
    expect(crossingArcs(invisibleDest, 0, 100)).toHaveLength(0)
  })

  it('caps at MAX_ARCS, keeping the most recent years', () => {
    const count = MAX_ARCS + 5
    const crossings = Array.from({ length: count }, (_, i) =>
      crossing({ tick: 10 + i, origin: { world: 'A', tick: i } }),
    )
    const worlds = [world('A', [], path(0, 100, 0)), world('B', crossings, path(0, 100, 1))]
    const arcs = crossingArcs(worlds, 0, 100)
    expect(arcs).toHaveLength(MAX_ARCS)
    const years = arcs.map((a) => a.year).sort((a, b) => a - b)
    const expected = crossings.slice(count - MAX_ARCS).map((c) => c.tick)
    expect(years).toEqual(expected)
  })

  it('keeps the same relative order among crossings that share a year when MAX_ARCS trims them', () => {
    const count = MAX_ARCS + 3
    const crossings = Array.from({ length: count }, (_, i) =>
      crossing({ tick: 50, cost: i, origin: { world: 'A', tick: i } }),
    )
    const worlds = [world('A', [], path(0, 100, 0)), world('B', crossings, path(0, 100, 1))]
    const arcs = crossingArcs(worlds, 0, 100)
    expect(arcs).toHaveLength(MAX_ARCS)
    // FIX: sort é estável; entre travessias do mesmo ano, o corte descarta as três mais antigas
    expect(arcs.map((a) => a.cost)).toEqual(crossings.slice(count - MAX_ARCS).map((c) => c.cost))
  })
})

describe('echoWindows', () => {
  it('opens a window only for knowledge and resource crossings, spanning ECHO_YEARS', () => {
    const worlds = [
      world(
        'B',
        [
          crossing({ kind: 'knowledge', tick: 50 }),
          crossing({ kind: 'resource', tick: 60, amounts: [1, 2] }),
          crossing({
            kind: 'doctrine',
            tick: 70,
            amounts: [],
            allocation: { agriculture: 1, industry: 0, research: 0, conservation: 0 },
          }),
          crossing({ kind: 'people', tick: 80, amounts: [5], direction: 'out' }),
        ],
        path(0, 100, 1),
      ),
    ]
    const windows = echoWindows(worlds)
    expect(windows).toEqual([
      { world: 'B', from: 50, to: 50 + ECHO_YEARS },
      { world: 'B', from: 60, to: 60 + ECHO_YEARS },
    ])
  })
})

describe('assimilationLeft', () => {
  const kinds: readonly CrossingKind[] = ['knowledge', 'resource', 'doctrine', 'people']

  it('is 0 for kinds with no echo, at every observed year', () => {
    for (const kind of kinds) {
      if (kind === 'knowledge' || kind === 'resource') continue
      expect(assimilationLeft(kind, [10], 50, 50)).toBe(0)
      expect(assimilationLeft(kind, [10], 50, 55)).toBe(0)
    }
  })

  it('is 0 before the crossing year', () => {
    expect(assimilationLeft('knowledge', [10], 50, 49)).toBe(0)
  })

  it('returns the full amount at the crossing year and decays by (1 - ASSIMILATION) * KEEP each year after', () => {
    const amounts = [4, 6]
    const initial = 10
    expect(assimilationLeft('resource', amounts, 50, 50)).toBeCloseTo(initial, 6)
    const decay = (1 - ASSIMILATION) * KEEP
    expect(assimilationLeft('resource', amounts, 50, 51)).toBeCloseTo(initial * decay, 6)
    expect(assimilationLeft('resource', amounts, 50, 53)).toBeCloseTo(initial * decay ** 3, 6)
  })

  it('is effectively nothing after ECHO_YEARS', () => {
    const left = assimilationLeft('knowledge', [10], 50, 50 + ECHO_YEARS)
    expect(left).toBeLessThan(10 * 0.001)
  })
})
