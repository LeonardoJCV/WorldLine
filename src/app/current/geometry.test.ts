import { describe, expect, it } from 'vitest'
import type { Crossing } from '../../engine/crossing.ts'
import type { EventRecord } from '../../engine/events.ts'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { Series } from '../../worker/protocol.ts'
import { PLANET_BODY } from '../planet/uniforms.ts'
import {
  COMPANION_SCALE,
  EPISODE_ROWS,
  ERA_ROW_HEIGHT,
  ERA_ROWS,
  MAX_WIDTH,
  MIN_WIDTH,
  buildRibbons,
  companionAt,
  companionPoints,
  companionSide,
  crossingSegments,
  episodeY,
  eraLabelY,
  layoutEvents,
  markerAt,
  movingAverage,
  stageLayout,
  xToYear,
  yearToX,
  type Frame,
} from './geometry.ts'
import { STRANDS, normalize } from './normalize.ts'

const frame: Frame = { left: 20, right: 820, centerY: 200, height: 400 }

function series(count: number, values: Partial<Record<Variable, number>> = {}): Series {
  const base: Record<Variable, number> = {
    population: 1e6,
    food: 2e5,
    energy: 2,
    technology: 30,
    economy: 3,
    environment: 80,
    stability: 60,
    ...values,
  }
  const result = {} as Record<Variable, Float32Array>
  for (const variable of VARIABLES) result[variable] = new Float32Array(count).fill(base[variable])
  return result
}

const row = (values: Partial<Record<Variable, number>>) => {
  const s = series(1, values)
  const result = {} as Record<Variable, number>
  for (const variable of VARIABLES) result[variable] = s[variable][0] ?? 0
  return result
}

describe('normalize', () => {
  it('maps every strand into 0..1', () => {
    for (const strand of STRANDS) {
      expect(normalize(strand, row({}))).toBeGreaterThanOrEqual(0)
      expect(normalize(strand, row({}))).toBeLessThanOrEqual(1)
    }
    expect(normalize('technology', row({ technology: 250 }))).toBe(1)
    expect(normalize('population', row({ population: 0 }))).toBe(0)
  })

  it('grows with the underlying value', () => {
    expect(normalize('population', row({ population: 1e7 }))).toBeGreaterThan(
      normalize('population', row({ population: 1e5 })),
    )
    expect(normalize('food', row({ food: 4e5 }))).toBeGreaterThan(
      normalize('food', row({ food: 1e5 })),
    )
  })

  it('treats non-finite values as empty', () => {
    expect(normalize('energy', row({ energy: Number.NaN }))).toBe(0)
  })
})

describe('time mapping', () => {
  it('places the first and last year on the frame edges', () => {
    expect(yearToX(0, 0, 100, frame)).toBe(20)
    expect(yearToX(100, 0, 100, frame)).toBe(820)
  })

  it('inverts back to whole years inside the window', () => {
    expect(xToYear(yearToX(37, 0, 100, frame), 0, 100, frame)).toBe(37)
    expect(xToYear(-50, 0, 100, frame)).toBe(0)
    expect(xToYear(5000, 0, 100, frame)).toBe(100)
  })
})

describe('buildRibbons', () => {
  it('builds one ribbon per strand with a column per sample', () => {
    const ribbons = buildRibbons(series(50), frame, 0)
    expect(ribbons.map((r) => r.strand)).toEqual([...STRANDS])
    for (const ribbon of ribbons) {
      expect(ribbon.top).toHaveLength(50)
      expect(ribbon.xs[0]).toBe(frame.left)
      expect(ribbon.xs[49]).toBe(frame.right)
    }
  })

  it('draws thicker ribbons for larger values', () => {
    const width = (technology: number) => {
      const ribbon = buildRibbons(series(10, { technology }), frame, 0).find(
        (r) => r.strand === 'technology',
      )
      return (ribbon?.bottom[5] ?? 0) - (ribbon?.top[5] ?? 0)
    }
    expect(width(0)).toBeCloseTo(MIN_WIDTH, 3)
    expect(width(100)).toBeCloseTo(MAX_WIDTH, 3)
  })

  it('loosens the braid when stability falls', () => {
    const spread = (stability: number) => {
      const ribbons = buildRibbons(series(200, { stability }), frame, 0.3)
      let max = 0
      for (const ribbon of ribbons) {
        for (let i = 0; i < 200; i++) {
          const center = ((ribbon.top[i] ?? 0) + (ribbon.bottom[i] ?? 0)) / 2
          max = Math.max(max, Math.abs(center - frame.centerY))
        }
      }
      return max
    }
    expect(spread(10)).toBeGreaterThan(spread(90) * 1.5)
  })
})

describe('movingAverage', () => {
  it('smooths values with neighboring samples', () => {
    expect(Array.from(movingAverage(Float32Array.from([0, 3, 0, 3, 0]), 1))).toEqual([
      1.5, 1, 2, 1, 1.5,
    ])
  })

  it('leaves values untouched at radius 0', () => {
    const values = Float32Array.from([0, 3, 0, 3, 0])
    expect(Array.from(movingAverage(values, 0))).toEqual(Array.from(values))
  })
})

describe('stageLayout', () => {
  it('lets the current flow into the planet on wide stages', () => {
    const layout = stageLayout(1400, 600)
    expect(layout.stacked).toBe(false)
    expect(layout.frame.centerY).toBe(layout.planet.cy)
    const edge = layout.planet.cx - (layout.planet.size / 2) * PLANET_BODY
    const margin = layout.planet.cx - (layout.planet.size / 2) * PLANET_BODY * 1.1
    expect(layout.frame.right).toBeGreaterThan(margin)
    expect(layout.frame.right).toBeLessThan(edge)
  })

  it('stacks planet above the current on narrow stages', () => {
    const layout = stageLayout(390, 600)
    expect(layout.stacked).toBe(true)
    expect(layout.frame.centerY).toBeGreaterThan(layout.planet.cy + layout.planet.size / 2)
    expect(layout.frame.right).toBeLessThanOrEqual(390)
  })
})

function record(event: EventRecord['event'], start: number, end: number | null): EventRecord {
  return { event, start, end, causes: [] }
}

describe('layoutEvents', () => {
  it('classifies eras, episodes and pulses', () => {
    const markers = layoutEvents(
      [
        record('agricultural_revolution', 10, null),
        record('famine', 20, 30),
        record('epidemic', 40, 43),
      ],
      0,
      100,
      100,
      frame,
      120,
    )
    expect(markers.map((m) => m.kind)).toEqual(['era', 'episode', 'pulse'])
  })

  it('stacks crowded era labels on separate rows', () => {
    const [first, second, third] = layoutEvents(
      [
        record('agricultural_revolution', 10, null),
        record('industrial_revolution', 12, null),
        record('demographic_transition', 90, null),
      ],
      0,
      100,
      100,
      frame,
      120,
    )
    expect(first?.row).toBe(0)
    expect(second?.row).toBe(1)
    expect(third?.row).toBe(0)
  })

  it('hides labels that do not fit any row', () => {
    const crowded = Array.from({ length: ERA_ROWS + 1 }, (_, i) =>
      record('agricultural_revolution', i, null),
    )
    const markers = layoutEvents(crowded, 0, 100, 100, frame, 200)
    expect(markers.at(-1)?.row).toBe(-1)
  })

  it('aligns era labels away from the frame edge', () => {
    const [left, right] = layoutEvents(
      [record('agricultural_revolution', 0, null), record('industrial_revolution', 95, null)],
      0,
      100,
      100,
      frame,
      120,
    )
    expect(left?.align).toBe('start')
    expect(right?.align).toBe('end')
  })

  it('extends open episodes to the present and skips events outside the window', () => {
    const markers = layoutEvents(
      [record('famine', 50, null), record('recession', 5, 8)],
      20,
      100,
      80,
      frame,
      120,
    )
    expect(markers).toHaveLength(1)
    expect(markers[0]?.x2).toBe(yearToX(80, 20, 100, frame))
  })

  it('drops eras that happened before the window', () => {
    const markers = layoutEvents(
      [record('agricultural_revolution', 10, null)],
      50,
      100,
      100,
      frame,
      120,
    )
    expect(markers).toEqual([])
  })

  // FEAT: anos reais do roteiro INHERITANCE_CASE (seed 482913, 'inherited'), lidos de Worldline.records em 3000
  const inheritance = [
    record('agricultural_revolution', 250, null),
    record('demographic_transition', 354, null),
    record('industrial_revolution', 648, null),
    record('space_era', 1802, null),
  ]
  const LABEL_WIDTH = 150

  it('keeps all four real eras of a spacefaring world on the chain, at realistic widths and time windows', () => {
    const widths = [320, 375, 414, 430, 768, 820, 1024, 1280, 1440, 1920, 2560]
    const presents = [1900, 2284, 3000, 5000, 10000]
    for (const width of widths) {
      const { frame: wide } = stageLayout(width, 800)
      for (const present of presents) {
        const markers = layoutEvents(inheritance, 0, present, present, wide, LABEL_WIDTH)
        expect(
          markers.every((marker) => marker.row >= 0),
          `width=${width} present=${present}`,
        ).toBe(true)
      }
    }
  })

  it('would still lose a label if a fifth era arrived -- proves the test above can fail', () => {
    const fifthEra = [...inheritance, record('industrial_revolution', 1850, null)]
    const markers = layoutEvents(fifthEra, 0, 10000, 10000, frame, LABEL_WIDTH)
    expect(markers.some((marker) => marker.row === -1)).toBe(true)
  })
})

describe('eraLabelY', () => {
  // FIX: 320px de largura com o palco no piso de MIN_STAGE (120), a tela mais curta que o app desenha
  it('keeps every era row inside the frame on both edges, on the shortest stage a phone can draw', () => {
    for (const width of [320, 719, 1024]) {
      const { frame: short } = stageLayout(width, 120)
      const top = short.centerY - short.height / 2
      const bottom = short.centerY + short.height / 2
      for (let row = 0; row < ERA_ROWS; row++) {
        const y = eraLabelY(short, row)
        expect(y, `width=${width} row=${row} (top)`).toBeGreaterThanOrEqual(top)
        expect(y, `width=${width} row=${row} (bottom)`).toBeLessThanOrEqual(bottom)
      }
    }
  })

  it('keeps rows at their usual spacing on a tall frame where the clamp never engages', () => {
    expect(eraLabelY(frame, 0)).toBe(frame.centerY - frame.height * 0.26)
    expect(eraLabelY(frame, 1)).toBe(eraLabelY(frame, 0) - ERA_ROW_HEIGHT)
  })
})

describe('episodeY', () => {
  // FIX: 320px de largura com o palco no piso de MIN_STAGE, a tela mais curta que o app desenha
  it('keeps every row inside the frame and apart on the shortest stage a phone can draw', () => {
    for (const drawn of [120, 156, 200]) {
      const { frame: short } = stageLayout(320, drawn)
      const rows = Array.from({ length: EPISODE_ROWS }, (_, row) => episodeY(short, row))
      expect(Math.max(...rows), `${drawn}px`).toBeLessThanOrEqual(
        short.centerY + short.height * 0.5,
      )
      expect(new Set(rows).size, `${drawn}px`).toBe(EPISODE_ROWS)
    }
  })

  it('keeps stacking rows apart on a tall frame where the clamp never engages', () => {
    expect(episodeY(frame, 1)).toBeGreaterThan(episodeY(frame, 0))
    expect(episodeY(frame, 0)).toBe(frame.centerY + frame.height * 0.2)
  })
})

describe('companion tracks', () => {
  const track = {
    id: 'B',
    from: 0,
    to: 100,
    values: Float32Array.from([0, 0.25, 0.5]),
    extinct: false,
    collapsed: false,
  }

  it('spreads the track from the axis in proportion to the distance', () => {
    const points = companionPoints(track, -1, 0, 100, frame)
    expect(points).toHaveLength(6)
    expect(points[0]).toBe(frame.left)
    expect(points[1]).toBe(frame.centerY)
    expect(points[5]).toBeCloseTo(frame.centerY - 0.5 * frame.height * COMPANION_SCALE, 5)
  })

  it('flips to the other side when given a positive side', () => {
    const below = companionPoints(track, 1, 0, 100, frame)
    expect(below[5]).toBeGreaterThan(frame.centerY)
  })

  it('finds the track under the pointer', () => {
    const points = companionPoints(track, -1, 0, 100, frame)
    const x = points[4] ?? 0
    const y = points[5] ?? 0
    expect(companionAt([{ id: 'B', points }], x + 2, y - 2, frame)).toBe('B')
    expect(companionAt([{ id: 'B', points }], x, y + 40, frame)).toBeNull()
  })

  it('ignores points on the axis, so the cursor stays scrubbable before the fork', () => {
    const flat = { ...track, values: Float32Array.from([0, 0, 0]) }
    const points = companionPoints(flat, -1, 0, 100, frame)
    const x = points[2] ?? 0
    const y = points[3] ?? 0
    expect(y).toBe(frame.centerY)
    expect(companionAt([{ id: 'B', points }], x, y, frame)).toBeNull()
  })

  it('derives a stable side from the worldline letter, independent of array order', () => {
    expect(companionSide('A')).toBe(-1)
    expect(companionSide('B')).toBe(1)
    expect(companionSide('C')).toBe(-1)
    expect(companionSide('B')).toBe(companionSide('B'))
  })
})

describe('markerAt', () => {
  const markers = layoutEvents(
    [
      record('agricultural_revolution', 10, null),
      record('famine', 40, 60),
      record('epidemic', 80, 83),
    ],
    0,
    100,
    100,
    frame,
    120,
  )

  it('finds an era by its stem or its label', () => {
    expect(markerAt(markers, 100, frame.centerY - 20, frame, 120)?.event).toBe(
      'agricultural_revolution',
    )
    expect(markerAt(markers, 160, eraLabelY(frame, 0), frame, 120)?.event).toBe(
      'agricultural_revolution',
    )
  })

  it('finds an episode by its band and a pulse by its tick', () => {
    expect(markerAt(markers, 400, episodeY(frame, 0) + 2, frame, 120)?.event).toBe('famine')
    expect(markerAt(markers, 660, frame.centerY + 10, frame, 120)?.event).toBe('epidemic')
  })

  it('misses empty space', () => {
    expect(markerAt(markers, 500, frame.centerY - 150, frame, 120)).toBeNull()
  })

  it('clamps events that start before the window', () => {
    const [early] = layoutEvents([record('famine', 5, 50)], 20, 100, 100, frame, 120)
    expect(early?.x).toBe(frame.left)
  })
})

describe('crossingSegments', () => {
  const lane = (id: string, y: number) => ({
    id,
    points: Float32Array.from([frame.left, y, frame.right, y]),
  })

  const crossing = (overrides: Partial<Crossing> = {}): Crossing => ({
    tick: 50,
    kind: 'knowledge',
    dose: 1,
    amounts: [10],
    origin: { world: 'B', tick: 50 },
    cost: 3,
    direction: 'in',
    ...overrides,
  })

  it('places the segment at the year of the crossing, between the two lanes', () => {
    const segments = crossingSegments(
      [{ id: 'A', crossings: [crossing()] }],
      [lane('B', 260)],
      'A',
      frame,
      0,
      100,
    )
    expect(segments).toEqual([
      { x: yearToX(50, 0, 100, frame), fromY: 260, toY: frame.centerY, kind: 'knowledge' },
    ])
  })

  it('skips a crossing outside the visible window', () => {
    const segments = crossingSegments(
      [{ id: 'A', crossings: [crossing({ tick: 150 })] }],
      [lane('B', 260)],
      'A',
      frame,
      0,
      100,
    )
    expect(segments).toEqual([])
  })

  it('skips a crossing whose origin worldline is not among the drawn lanes', () => {
    const segments = crossingSegments(
      [{ id: 'A', crossings: [crossing({ origin: { world: 'Z', tick: 50 } })] }],
      [lane('B', 260)],
      'A',
      frame,
      0,
      100,
    )
    expect(segments).toEqual([])
  })

  it('skips a mirrored out record, since the matching in record already drew the line', () => {
    const segments = crossingSegments(
      [{ id: 'A', crossings: [crossing({ direction: 'out' })] }],
      [lane('B', 260)],
      'A',
      frame,
      0,
      100,
    )
    expect(segments).toEqual([])
  })
})
