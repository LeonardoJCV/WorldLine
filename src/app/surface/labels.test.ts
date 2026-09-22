import { describe, expect, it } from 'vitest'
import type { City } from './civilization.ts'
import { CARD_EVENTS, anchorOf, cityEvents, foundedYear, recentEvents } from './labels.ts'
import type { MicroEvent } from './micro.ts'
import { surfaceRadius } from './terrain.ts'

const city: City = {
  site: 2,
  state: 'alive',
  population: 1000,
  size: 0.2,
  founded: 40,
  activity: 'agrarian',
}

describe('recentEvents', () => {
  it('keeps the last five years and only this year of foundings', () => {
    const events: MicroEvent[] = [
      { year: 94, kind: 'fire', site: 0 },
      { year: 95, kind: 'founding', site: 1 },
      { year: 95, kind: 'harvest', site: 0 },
      { year: 100, kind: 'founding', site: 2 },
      { year: 100, kind: 'revolt', site: 1 },
    ]
    expect(recentEvents(events, 100)).toEqual([
      { year: 95, kind: 'harvest', site: 0 },
      { year: 100, kind: 'founding', site: 2 },
      { year: 100, kind: 'revolt', site: 1 },
    ])
  })
})

describe('cityEvents', () => {
  it('lists the latest events of one city, newest first', () => {
    const events: MicroEvent[] = Array.from({ length: 10 }, (_, i) => ({
      year: i,
      kind: 'fire',
      site: i % 2,
    }))
    const listed = cityEvents(events, 0)
    expect(listed.map((e) => e.year)).toEqual([8, 6, 4, 2, 0])
    const many = cityEvents(
      Array.from({ length: 20 }, (_, i) => ({ year: i, kind: 'harvest', site: 3 })),
      3,
    )
    expect(many).toHaveLength(CARD_EVENTS)
    expect(many[0]?.year).toBe(19)
  })
})

describe('foundedYear', () => {
  it('prefers the latest founding inside the window', () => {
    const events: MicroEvent[] = [
      { year: 50, kind: 'founding', site: 2 },
      { year: 60, kind: 'fire', site: 2 },
      { year: 80, kind: 'founding', site: 2 },
      { year: 90, kind: 'founding', site: 3 },
    ]
    expect(foundedYear(events, city)).toBe(80)
  })

  it('falls back to the model year', () => {
    expect(foundedYear([{ year: 90, kind: 'founding', site: 3 }], city)).toBe(40)
  })
})

describe('anchorOf', () => {
  it('lifts the point just above the ground', () => {
    const point = anchorOf({ index: 0, dir: [0, 1, 0], height: 0.7, coast: false, score: 1 })
    expect(point[0]).toBe(0)
    expect(point[1]).toBeCloseTo(surfaceRadius(0.7) + 0.002, 9)
  })
})
