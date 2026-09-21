import { describe, expect, it } from 'vitest'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { RangeResult } from '../sim/client.ts'
import { PATH_ROWS, axisPoint, buildPath, headPoint } from './path.ts'
import { HALF_LENGTH } from './space.ts'

function series(from: number, to: number, count: number): RangeResult {
  const out = {} as Record<Variable, Float32Array>
  for (const variable of VARIABLES) out[variable] = new Float32Array(count).fill(50)
  out.population = new Float32Array(count).fill(1e6)
  return { from, to, series: out }
}

describe('buildPath', () => {
  it('writes three RGBA rows per sample', () => {
    const path = buildPath(series(0, 100, 11), new Float32Array(16 * 2), 0, 100, 0, 16)
    expect(path.data.length).toBe(16 * PATH_ROWS * 4)
    expect(path.alive).toEqual([0, 1])
    expect(path.data[0]).toBeCloseTo(-HALF_LENGTH, 5)
    expect(path.data[16 * 4 * 2 + 2]).toBe(1)
  })

  it('starts a branch at its fork and ends an extinct world at its last year', () => {
    const path = buildPath(series(0, 60, 7), new Float32Array(16 * 2), 0, 100, 20, 16)
    expect(path.alive[0]).toBeCloseTo(0.2, 5)
    expect(path.alive[1]).toBeCloseTo(0.6, 5)
    expect(path.data[16 * 4 * 2 + 2]).toBe(0)
  })

  it('places points on the axis and finds the head', () => {
    const offsets = new Float32Array(16 * 2).fill(1)
    const path = buildPath(series(0, 100, 11), offsets, 0, 100, 0, 16)
    expect(axisPoint(path, 0)).toEqual([-HALF_LENGTH, 1, 1])
    expect(headPoint(path)?.[0]).toBeCloseTo(HALF_LENGTH, 5)
    expect(axisPoint(path, 1.5)).toBeNull()
  })

  it('hides a world that forks after the window end', () => {
    const path = buildPath(series(0, 100, 11), new Float32Array(16 * 2), 0, 100, 150, 16)
    expect(path.visible).toBe(false)
    expect(headPoint(path)).toBeNull()
  })

  it('hides an extinct world whose series ends before the window start', () => {
    const path = buildPath(series(30, 30, 1), new Float32Array(16 * 2), 50, 100, 0, 16)
    expect(path.visible).toBe(false)
    expect(headPoint(path)).toBeNull()
  })

  it('handles a zero-length window without producing NaN', () => {
    const path = buildPath(series(0, 100, 11), new Float32Array(16 * 2), 50, 50, 0, 16)
    expect(path.data.every((v) => !Number.isNaN(v))).toBe(true)
  })
})
