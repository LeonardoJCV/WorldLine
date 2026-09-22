import { describe, expect, it } from 'vitest'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { thresholds } from './civilization.ts'
import { MAX_PER_YEAR, microevents, type YearSeries } from './micro.ts'
import { findSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

const sites = findSites(createTerrain(482913, planetPalette(482913)))

function series(
  from: number,
  to: number,
  patch: Partial<Record<Variable, (year: number) => number>> = {},
): YearSeries {
  const base: Record<Variable, (year: number) => number> = {
    population: () => 3_000_000,
    food: () => 1_500_000,
    energy: () => 3,
    technology: () => 30,
    economy: () => 6,
    environment: () => 70,
    stability: () => 60,
    ...patch,
  }
  const values = {} as Record<Variable, Float32Array>
  for (const variable of VARIABLES) {
    values[variable] = Float32Array.from({ length: to - from + 1 }, (_, i) =>
      base[variable](from + i),
    )
  }
  return { from, to, values }
}

describe('microevents', () => {
  it('is deterministic', () => {
    const input = { seed: 482913, sites, series: series(100, 199) }
    expect(microevents(input)).toEqual(microevents(input))
  })

  it('happens only in living cities and never more than twice a year besides foundings', () => {
    const events = microevents({ seed: 482913, sites, series: series(100, 399) })
    const alive = thresholds(sites.length).filter((t) => t <= 3_000_000).length
    const perYear = new Map<number, number>()
    for (const e of events) {
      expect(e.site).toBeLessThan(alive)
      if (e.kind !== 'founding') perYear.set(e.year, (perYear.get(e.year) ?? 0) + 1)
    }
    for (const count of perYear.values()) expect(count).toBeLessThanOrEqual(MAX_PER_YEAR)
    expect(events.length).toBeGreaterThan(10)
  })

  it('founds a city in the year its threshold is crossed', () => {
    const limit = thresholds(sites.length)[5] ?? 0
    const events = microevents({
      seed: 482913,
      sites,
      series: series(0, 60, { population: (y) => (y < 30 ? limit - 1 : limit + 1) }),
    })
    expect(events).toContainEqual({ year: 30, kind: 'founding', site: 5 })
  })

  it('follows the state of the world', () => {
    const count = (kind: string, patch: Partial<Record<Variable, (y: number) => number>>) =>
      microevents({ seed: 482913, sites, series: series(0, 999, patch) }).filter(
        (e) => e.kind === kind,
      ).length
    expect(count('invention', { technology: () => 95 })).toBeGreaterThan(
      count('invention', { technology: () => 5 }),
    )
    expect(count('revolt', { stability: () => 10 })).toBeGreaterThan(
      count('revolt', { stability: () => 95 }),
    )
    expect(count('fire', { environment: () => 10 })).toBeGreaterThan(
      count('fire', { environment: () => 95 }),
    )
  })

  it('stays silent without living cities', () => {
    expect(
      microevents({ seed: 482913, sites, series: series(0, 99, { population: () => 1000 }) }),
    ).toEqual([])
  })

  it('opens harbours only in coastal cities', () => {
    for (const e of microevents({
      seed: 482913,
      sites,
      series: series(0, 999, { economy: () => 15 }),
    })) {
      if (e.kind === 'harbour') expect(sites[e.site]?.coast).toBe(true)
    }
  })
})
