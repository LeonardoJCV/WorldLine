import { describe, expect, it } from 'vitest'
import type { EventId } from '../../engine/events.ts'
import { Era, type Variable } from '../../engine/state.ts'
import type { Snapshot } from '../../worker/protocol.ts'
import { MAX_SATELLITES, planetPalette, planetState } from './uniforms.ts'

function snapshot(
  values: Partial<Record<Variable, number>> = {},
  extra: { eras?: number; active?: EventId[]; status?: Snapshot['status'] } = {},
): Snapshot {
  return {
    tick: 10,
    values: {
      population: 1e6,
      food: 2e5,
      energy: 2,
      technology: 30,
      economy: 3,
      environment: 80,
      stability: 60,
      ...values,
    },
    eras: extra.eras ?? 0,
    active: extra.active ?? [],
    allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
    status: extra.status ?? 'running',
  }
}

describe('planetPalette', () => {
  it('is a pure function of the seed', () => {
    expect(planetPalette(482913)).toEqual(planetPalette(482913))
    expect(planetPalette(1)).not.toEqual(planetPalette(2))
  })

  it('keeps colors and parameters in range', () => {
    for (let seed = 0; seed < 200; seed++) {
      const palette = planetPalette(seed * 7919)
      expect(palette.seaLevel).toBeGreaterThanOrEqual(0.44)
      expect(palette.seaLevel).toBeLessThanOrEqual(0.56)
      for (const color of [
        palette.oceanDeep,
        palette.vegetation,
        palette.arid,
        palette.atmosphere,
      ]) {
        for (const channel of color) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('planetState', () => {
  it('follows the environment and the population', () => {
    expect(planetState(snapshot({ environment: 90 })).vegetation).toBeGreaterThan(
      planetState(snapshot({ environment: 20 })).vegetation,
    )
    expect(planetState(snapshot({ population: 5e7 })).lights).toBeGreaterThan(
      planetState(snapshot({ population: 2e5 })).lights,
    )
  })

  it('clouds the sky with dirty energy', () => {
    expect(planetState(snapshot({ energy: 10, technology: 20 })).haze).toBeGreaterThan(
      planetState(snapshot({ energy: 10, technology: 95 })).haze,
    )
  })

  it('shows a ring after the industrial revolution and satellites with advanced technology', () => {
    expect(planetState(snapshot()).ring).toBe(0)
    expect(planetState(snapshot({}, { eras: Era.industrial })).ring).toBe(1)
    expect(planetState(snapshot({ technology: 70 })).satellites).toBe(0)
    expect(planetState(snapshot({ technology: 100 })).satellites).toBe(MAX_SATELLITES)
  })

  it('marks active crises', () => {
    const state = planetState(
      snapshot({}, { active: ['famine', 'ecological_crisis', 'civil_unrest'] }),
    )
    expect([state.famine, state.blight, state.unrest]).toEqual([1, 1, 1])
  })

  it('goes dark after extinction', () => {
    const state = planetState(snapshot({ population: 500 }, { status: 'extinct' }))
    expect(state.extinct).toBe(1)
    expect(state.lights).toBe(0)
    expect(state.vegetation).toBe(0)
  })
})
