import { describe, expect, it } from 'vitest'
import {
  ALTITUDE,
  LEVEL_ALTITUDE,
  dirOf,
  levelOf,
  panBy,
  surfacePose,
  tiltFor,
  zoomGoal,
} from './camera.ts'

describe('levels', () => {
  it('names the zoom level from the altitude', () => {
    expect(levelOf(LEVEL_ALTITUDE.orbit)).toBe('orbit')
    expect(levelOf(LEVEL_ALTITUDE.continent)).toBe('continent')
    expect(levelOf(LEVEL_ALTITUDE.region)).toBe('region')
  })

  it('tilts towards the horizon only when close', () => {
    expect(tiltFor(LEVEL_ALTITUDE.orbit)).toBe(0)
    expect(tiltFor(ALTITUDE.min)).toBeCloseTo(1.1, 10)
    expect(tiltFor(0.05)).toBeGreaterThan(tiltFor(0.2))
  })
})

describe('surfacePose', () => {
  it('looks at the planet centre from orbit', () => {
    const pose = surfacePose(0.3, 1.2, LEVEL_ALTITUDE.orbit, 1)
    expect(Math.hypot(...pose.position)).toBeCloseTo(1 + LEVEL_ALTITUDE.orbit, 6)
    expect(pose.target).toEqual([0, 0, 0])
  })

  it('stays above the ground and looks at the surface when close', () => {
    const ground = 1.01
    const pose = surfacePose(0.3, 1.2, 0.02, ground)
    const n = dirOf(0.3, 1.2)
    const height = pose.position[0] * n[0] + pose.position[1] * n[1] + pose.position[2] * n[2]
    expect(height).toBeGreaterThan(ground)
    expect(Math.hypot(...pose.target)).toBeCloseTo(ground, 6)
  })
})

describe('zoomGoal', () => {
  it('zooms in and out inside the band', () => {
    expect(zoomGoal(1, 1.25, 0.004, 2.4).goal).toBeCloseTo(1.25)
    expect(zoomGoal(1, 1.25, 0.004, 2.4).beyond).toBe(false)
    expect(zoomGoal(1, 0.8, 0.004, 2.4).goal).toBeCloseTo(0.8)
  })

  it('clamps at the floor without calling it a way out', () => {
    expect(zoomGoal(0.004, 0.8, 0.004, 2.4)).toEqual({ goal: 0.004, beyond: false })
  })

  it('clamps at the ceiling the first time, and only then reports the way out', () => {
    // FEAT: chegar ao teto não é sair; sair é pedir para fora já estando nele
    expect(zoomGoal(2.0, 1.25, 0.004, 2.4)).toEqual({ goal: 2.4, beyond: false })
    expect(zoomGoal(2.4, 1.25, 0.004, 2.4)).toEqual({ goal: 2.4, beyond: true })
  })

  it('never reports a way out while zooming in', () => {
    expect(zoomGoal(2.4, 0.8, 0.004, 2.4).beyond).toBe(false)
  })
})

describe('panBy', () => {
  it('moves slower when close and never passes the poles', () => {
    const [latFar] = panBy(0, 0, 2, 0, 100, 800)
    const [latNear] = panBy(0, 0, 0.02, 0, 100, 800)
    expect(Math.abs(latFar)).toBeGreaterThan(Math.abs(latNear))
    expect(panBy(1.4, 0, 2, 0, 10_000, 800)[0]).toBeLessThanOrEqual(1.45)
  })

  it('carries the ground with the pointer', () => {
    const [, east] = panBy(0, 0, 2, 100, 0, 800)
    const [, west] = panBy(0, 0, 2, -100, 0, 800)
    expect(east).toBeGreaterThan(0)
    expect(west).toBeLessThan(0)
    const [down] = panBy(0, 0, 2, 0, 100, 800)
    const [up] = panBy(0, 0, 2, 0, -100, 800)
    expect(down).toBeLessThan(0)
    expect(up).toBeGreaterThan(0)
  })
})
