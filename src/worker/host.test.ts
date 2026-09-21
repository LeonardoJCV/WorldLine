import { describe, expect, it } from 'vitest'
import { HORIZON } from '../engine/params.ts'
import type { Allocation } from '../engine/state.ts'
import { Worldline } from '../engine/worldline.ts'
import { SimulationHost } from './host.ts'
import type { FromWorker } from './protocol.ts'
import { FakeClock } from './testing.ts'

const SEED = 482913
const starved: Allocation = { agriculture: 5, industry: 50, research: 40, conservation: 5 }
const industrial: Allocation = { agriculture: 25, industry: 60, research: 15, conservation: 0 }

function setup() {
  const clock = new FakeClock()
  const sent: FromWorker[] = []
  const host = new SimulationHost((message) => sent.push(message), clock)
  return { clock, sent, host }
}

function all<T extends FromWorker['type']>(sent: readonly FromWorker[], type: T) {
  return sent.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type)
}

function last<T extends FromWorker['type']>(sent: readonly FromWorker[], type: T) {
  return all(sent, type).at(-1)
}

describe('SimulationHost', () => {
  it('reports the new world right after creation', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    const progress = last(sent, 'progress')
    expect(progress?.present.tick).toBe(0)
    expect(progress?.present.values.population).toBe(new Worldline(SEED).present.population)
    expect(progress?.playing).toBe(false)
  })

  it('advances at the chosen speed while playing', () => {
    const { host, sent, clock } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'play', speed: 16 })
    clock.advance(1000)
    const tick = last(sent, 'progress')?.present.tick ?? 0
    expect(tick).toBeGreaterThanOrEqual(14)
    expect(tick).toBeLessThanOrEqual(16)
    expect(last(sent, 'progress')?.playing).toBe(true)
  })

  it('stops advancing when paused', () => {
    const { host, sent, clock } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'play', speed: 64 })
    clock.advance(500)
    host.handle({ type: 'pause' })
    const paused = last(sent, 'progress')
    clock.advance(1000)
    expect(paused?.playing).toBe(false)
    expect(last(sent, 'progress')?.present.tick).toBe(paused?.present.tick)
  })

  it('steps an exact number of years', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'step', years: 25 })
    expect(last(sent, 'progress')?.present.tick).toBe(25)
  })

  it('runs to the horizon at max speed and reports the end once', () => {
    const { host, sent, clock } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'play', speed: 'max' })
    clock.advance(100)
    expect(last(sent, 'progress')?.present.tick).toBe(HORIZON)
    expect(last(sent, 'progress')?.playing).toBe(false)
    expect(all(sent, 'ended')).toEqual([{ type: 'ended', reason: 'horizon' }])
  })

  it('reports extinction', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [{ tick: 0, allocation: industrial }] })
    host.handle({ type: 'step', years: 3000 })
    expect(all(sent, 'ended')).toEqual([{ type: 'ended', reason: 'extinction' }])
    expect(last(sent, 'progress')?.present.status).toBe('extinct')
  })

  it('streams event records and later closes them', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [{ tick: 0, allocation: starved }] })
    host.handle({ type: 'step', years: 5 })
    const opened = last(sent, 'progress')?.events.find((u) => u.record.event === 'famine')
    expect(opened?.record.end).toBeNull()
    host.handle({ type: 'step', years: 1000 })
    const closed = all(sent, 'progress')
      .flatMap((p) => p.events)
      .find((u) => u.index === opened?.index && u.record.end !== null)
    expect(closed).toBeDefined()
  })

  it('applies a decision from the present year onward without moving time', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'decide', allocation: starved })
    expect(last(sent, 'progress')?.present.tick).toBe(10)
    host.handle({ type: 'step', years: 1 })
    expect(last(sent, 'progress')?.present.allocation).toEqual(starved)
  })

  it('answers range requests with one mean series per variable', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'step', years: 100 })
    host.handle({ type: 'range', requestId: 3, from: 0, to: 100, buckets: 10 })
    const reply = last(sent, 'range')
    const reference = new Worldline(SEED)
    reference.advance(100)
    expect(reply?.requestId).toBe(3)
    expect(reply?.series.population).toHaveLength(10)
    expect(reply?.series.stability).toHaveLength(10)
    expect(reply?.series.population[0]).toBe(reference.range('population', 0, 100, 10).mean[0])
  })

  it('clamps ranges to the recorded history', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'step', years: 100 })
    host.handle({ type: 'range', requestId: 4, from: 50, to: 5000, buckets: 10 })
    expect(last(sent, 'range')).toMatchObject({ requestId: 4, from: 50, to: 100 })
  })

  it('answers inspect requests with the state of a past year', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'step', years: 300 })
    host.handle({ type: 'inspect', requestId: 5, tick: 120 })
    const reference = new Worldline(SEED)
    reference.advance(120)
    const reply = last(sent, 'inspect')
    expect(reply?.requestId).toBe(5)
    expect(reply?.snapshot.tick).toBe(120)
    expect(reply?.snapshot.values.technology).toBe(reference.present.technology)
  })

  it('reports errors for requests before a world exists', () => {
    const { host, sent } = setup()
    host.handle({ type: 'range', requestId: 7, from: 0, to: 1, buckets: 1 })
    expect(last(sent, 'error')).toEqual({
      type: 'error',
      message: 'no worldline created',
      requestId: 7,
    })
  })

  it('keeps working after rejecting an invalid decision', () => {
    const { host, sent } = setup()
    host.handle({ type: 'create', seed: SEED, decisions: [] })
    host.handle({ type: 'decide', allocation: { ...starved, research: 0 } })
    expect(last(sent, 'error')?.message).toMatch(/allocation/)
    host.handle({ type: 'step', years: 2 })
    expect(last(sent, 'progress')?.present.tick).toBe(2)
  })
})
