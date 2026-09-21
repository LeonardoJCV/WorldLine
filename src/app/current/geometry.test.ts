import { describe, expect, it } from 'vitest'
import type { EventRecord } from '../../engine/events.ts'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { Series } from '../../worker/protocol.ts'
import { PLANET_BODY } from '../planet/uniforms.ts'
import {
  ERA_ROWS,
  MAX_WIDTH,
  MIN_WIDTH,
  buildRibbons,
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
