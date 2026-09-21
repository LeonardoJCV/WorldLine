import { describe, expect, it } from 'vitest'
import type { EventId } from './events.ts'
import type { Allocation } from './state.ts'
import { Worldline } from './worldline.ts'

const balanced: Allocation = { agriculture: 40, industry: 30, research: 20, conservation: 10 }
const industrial: Allocation = { agriculture: 25, industry: 60, research: 15, conservation: 0 }
const starved: Allocation = { agriculture: 5, industry: 50, research: 40, conservation: 5 }
const research: Allocation = { agriculture: 35, industry: 20, research: 40, conservation: 5 }

function run(seed: number, allocation: Allocation, years: number): Worldline {
  const w = new Worldline(seed, [{ tick: 0, allocation }])
  w.advance(years)
  return w
}

const firstStart = (w: Worldline, event: EventId) =>
  w.records.find((r) => r.event === event)?.start ?? Infinity
const count = (w: Worldline, event: EventId) => w.records.filter((r) => r.event === event).length

describe('model behaviour', () => {
  it.each([1, 7, 482913])('a balanced civilisation survives five millennia (seed %i)', (seed) => {
    const w = run(seed, balanced, 5000)
    expect(w.present.status).toBe('running')
    expect(w.present.population).toBeGreaterThan(1e6)
  })

  it('heavy industry without conservation degrades the environment into crisis', () => {
    const heavy = run(482913, industrial, 5000)
    const calm = run(482913, balanced, 5000)
    expect(firstStart(heavy, 'ecological_crisis')).toBeLessThan(5000)
    expect(count(calm, 'ecological_crisis')).toBe(0)
  })

  it('neglecting agriculture brings famine within a century', () => {
    expect(firstStart(run(482913, starved, 200), 'famine')).toBeLessThan(100)
  })

  it('research-first worlds reach advanced technology before year 2000', () => {
    const w = run(482913, research, 2000)
    expect(w.present.technology).toBeGreaterThan(75)
  })

  it('eras arrive in historical order in a balanced world', () => {
    const w = run(482913, balanced, 5000)
    const agricultural = firstStart(w, 'agricultural_revolution')
    const industrialEra = firstStart(w, 'industrial_revolution')
    expect(agricultural).toBeLessThan(industrialEra)
    expect(industrialEra).toBeLessThan(5000)
  })

  it('a balanced world does not live in permanent famine', () => {
    const w = run(482913, balanced, 5000)
    expect(count(w, 'famine')).toBeLessThanOrEqual(25)
  })
})
