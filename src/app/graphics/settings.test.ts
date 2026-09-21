import { describe, expect, it } from 'vitest'
import { AUTO_START, TIERS, chooseTier, resolveStage, tierOf } from './settings.ts'

describe('chooseTier', () => {
  it('drops to low above 20 ms per frame', () => {
    expect(chooseTier(24, false)).toBe('low')
    expect(chooseTier(Number.NaN, false)).toBe('low')
  })

  it('climbs to ultra under 9 ms on a hardware renderer', () => {
    expect(chooseTier(6, false)).toBe('ultra')
    expect(chooseTier(6, true)).toBe('high')
  })

  it('stays high in between', () => {
    expect(chooseTier(14, false)).toBe('high')
    expect(chooseTier(20, false)).toBe('high')
  })
})

describe('resolveStage', () => {
  const env = { webgl: true, reducedMotion: false }

  it('uses 3D by default', () => {
    expect(resolveStage('auto', env)).toBe('3d')
    expect(resolveStage('ultra', env)).toBe('3d')
  })

  it('falls back to 2D without WebGL whatever the choice', () => {
    expect(resolveStage('ultra', { ...env, webgl: false })).toBe('2d')
  })

  it('prefers 2D under reduced motion unless a level is forced', () => {
    expect(resolveStage('auto', { ...env, reducedMotion: true })).toBe('2d')
    expect(resolveStage('low', { ...env, reducedMotion: true })).toBe('3d')
  })

  it('honours an explicit 2D choice', () => {
    expect(resolveStage('2d', env)).toBe('2d')
  })
})

describe('tierOf', () => {
  it('uses the forced level or the measured one', () => {
    expect(tierOf('low', 'ultra')).toBe('low')
    expect(tierOf('auto', 'ultra')).toBe('ultra')
    expect(tierOf('auto', null)).toBe(AUTO_START)
    expect(tierOf('2d', null)).toBe(AUTO_START)
  })

  it('matches the spec table', () => {
    expect(TIERS.low).toMatchObject({
      particles: 4000,
      bloom: 0,
      dpr: 1,
      focus: 'base',
      others: 'disc',
    })
    expect(TIERS.high).toMatchObject({
      particles: 30000,
      dpr: 1.5,
      focus: 'clouds',
      others: 'base',
    })
    expect(TIERS.ultra).toMatchObject({
      particles: 80000,
      dpr: 2,
      focus: 'max',
      others: 'clouds',
      bloomHalf: true,
    })
    expect(TIERS.ultra.bloom).toBeGreaterThan(TIERS.high.bloom)
  })
})
