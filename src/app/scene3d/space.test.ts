import { describe, expect, it } from 'vitest'
import {
  HALF_LENGTH,
  SAMPLES,
  SPREAD,
  axisOffsets,
  axisToYear,
  branchDirection,
  resample,
  sampleYear,
  yearToAxis,
} from './space.ts'

describe('time axis', () => {
  it('maps the window onto the axis with the present at the right end', () => {
    expect(yearToAxis(100, 100, 500)).toBe(-HALF_LENGTH)
    expect(yearToAxis(500, 100, 500)).toBe(HALF_LENGTH)
    expect(axisToYear(0, 100, 500)).toBe(300)
    expect(sampleYear(SAMPLES - 1, 0, 800)).toBe(800)
  })
})

describe('branchDirection', () => {
  it('turns each letter by the golden angle', () => {
    const [y, z] = branchDirection('B')
    expect(Math.hypot(y, z)).toBeCloseTo(1, 12)
    expect(branchDirection('C')).not.toEqual(branchDirection('B'))
  })
})

describe('resample', () => {
  it('stretches a series over the window and holds its last value beyond it', () => {
    const out = resample(Float32Array.from([0, 1]), 0, 100, 0, 200, 5)
    expect(Array.from(out)).toEqual([0, 1, 1, 1, 1])
  })
})

describe('axisOffsets', () => {
  it('keeps the original on the axis and moves branches by distance', () => {
    const distance = new Float32Array(SAMPLES).fill(0.5)
    const offsets = axisOffsets([
      { id: 'A', parent: null, distance: null },
      { id: 'B', parent: 'A', distance },
    ])
    expect(Array.from(offsets.get('A') ?? []).every((v) => v === 0)).toBe(true)
    const b = offsets.get('B') ?? new Float32Array()
    const mid = SAMPLES / 2
    expect(Math.hypot(b[mid * 2] ?? 0, b[mid * 2 + 1] ?? 0)).toBeCloseTo(SPREAD * 0.5, 5)
  })

  it('adds the parent offset to its descendants', () => {
    const distance = new Float32Array(SAMPLES).fill(0.5)
    const zero = new Float32Array(SAMPLES)
    const offsets = axisOffsets([
      { id: 'A', parent: null, distance: null },
      { id: 'B', parent: 'A', distance },
      { id: 'C', parent: 'B', distance: zero },
    ])
    expect(Array.from(offsets.get('C') ?? [])).toEqual(Array.from(offsets.get('B') ?? []))
  })
})
