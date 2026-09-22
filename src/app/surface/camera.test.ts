import { describe, expect, it } from 'vitest'
import { ALTITUDE, LEVEL_ALTITUDE, dirOf, levelOf, panBy, surfacePose, tiltFor } from './camera.ts'

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

describe('panBy', () => {
  it('moves slower when close and never passes the poles', () => {
    const [latFar] = panBy(0, 0, 2, 0, 100, 800)
    const [latNear] = panBy(0, 0, 0.02, 0, 100, 800)
    expect(Math.abs(latFar)).toBeGreaterThan(Math.abs(latNear))
    expect(panBy(1.4, 0, 2, 0, 10_000, 800)[0]).toBeLessThanOrEqual(1.45)
  })
})
