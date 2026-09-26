import { afterEach, describe, expect, it, vi } from 'vitest'
import { crossingAmounts, crossingCost } from '../engine/crossing.ts'
import { debtRatio, totalOwed } from '../engine/debt.ts'
import { causalDistance } from '../engine/distance.ts'
import { GOLDEN_SCRIPTS, INHERITANCE_CASE } from '../engine/golden.ts'
import { EVENTS, type EventRecord } from '../engine/events.ts'
import { mergeWeights } from '../engine/merge.ts'
import { HORIZON } from '../engine/params.ts'
import type { Allocation, WorldState } from '../engine/state.ts'
import { system } from '../engine/system.ts'
import { Worldline } from '../engine/worldline.ts'
import { SimulationHost } from './host.ts'
import type { FromWorker, ToWorker, WorldlineId } from './protocol.ts'
import { FakeClock } from './testing.ts'

const SEED = 482913
const starved: Allocation = { agriculture: 5, industry: 50, research: 40, conservation: 5 }
const industrial: Allocation = { agriculture: 25, industry: 60, research: 15, conservation: 0 }
const balanced: Allocation = { agriculture: 40, industry: 30, research: 20, conservation: 10 }

function setup() {
  const clock = new FakeClock()
  const sent: FromWorker[] = []
  const host = new SimulationHost((message) => sent.push(message), clock)
  const open = (tick = 0, root = [] as { tick: number; allocation: Allocation }[]) =>
    host.handle({ type: 'open', seed: SEED, tick, root, branches: [] })
  return { clock, sent, host, open }
}

function all<T extends FromWorker['type']>(sent: readonly FromWorker[], type: T) {
  return sent.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type)
}

function last<T extends FromWorker['type']>(sent: readonly FromWorker[], type: T) {
  return all(sent, type).at(-1)
}

function world(sent: readonly FromWorker[], id: WorldlineId) {
  return last(sent, 'progress')?.worlds.find((w) => w.info.id === id)
}

// FEAT: duas histórias vivas no mesmo ano, a base tanto das travessias quanto das costuras
function pair() {
  const context = setup()
  context.open()
  context.host.handle({ type: 'step', years: 2000 })
  context.host.handle({
    type: 'branch',
    requestId: 1,
    parent: 'A',
    tick: 100,
    allocation: balanced,
  })
  return context
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SimulationHost: a single worldline', () => {
  it('reports the new world right after opening', () => {
    const { sent, open } = setup()
    open()
    const progress = last(sent, 'progress')
    expect(progress?.now).toBe(0)
    expect(progress?.worlds.map((w) => w.info)).toEqual([
      { id: 'A', parent: null, fork: 0, generation: 1 },
    ])
    expect(world(sent, 'A')?.present.values.population).toBe(new Worldline(SEED).present.population)
    expect(progress?.playing).toBe(false)
    expect(progress?.ended).toBeNull()
  })

  it('advances at the chosen speed while playing', () => {
    const { host, sent, clock, open } = setup()
    open()
    host.handle({ type: 'play', speed: 16 })
    clock.advance(1000)
    const now = last(sent, 'progress')?.now ?? 0
    expect(now).toBeGreaterThanOrEqual(14)
    expect(now).toBeLessThanOrEqual(16)
  })

  it('stops advancing when paused', () => {
    const { host, sent, clock, open } = setup()
    open()
    host.handle({ type: 'play', speed: 64 })
    clock.advance(500)
    host.handle({ type: 'pause' })
    const paused = last(sent, 'progress')
    clock.advance(1000)
    expect(paused?.playing).toBe(false)
    expect(last(sent, 'progress')?.now).toBe(paused?.now)
  })

  it('steps an exact number of years', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 25 })
    expect(last(sent, 'progress')?.now).toBe(25)
    expect(world(sent, 'A')?.present.tick).toBe(25)
  })

  it('runs to the horizon at max speed and reports the end', () => {
    const { host, sent, clock, open } = setup()
    open()
    host.handle({ type: 'play', speed: 'max' })
    clock.advance(100)
    const progress = last(sent, 'progress')
    expect(progress?.now).toBe(HORIZON)
    expect(progress?.playing).toBe(false)
    expect(progress?.ended).toBe('horizon')
  })

  it('reports extinction when every worldline is extinct', () => {
    const { host, sent, open } = setup()
    open(0, [{ tick: 0, allocation: industrial }])
    host.handle({ type: 'step', years: 3000 })
    expect(last(sent, 'progress')?.ended).toBe('extinction')
    expect(world(sent, 'A')?.present.status).toBe('extinct')
  })

  it('reports collapse as its own end reason, distinct from extinction', () => {
    const { host, sent } = setup()
    // FEAT: um presente de conhecimento nunca quitado por um mundo que não pesquisa é o roteiro
    // calibrado na Tarefa 6 para colapsar sempre — a dívida entra pré-fabricada, como no golden 'crossed'
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 0,
      root: [
        { tick: 0, allocation: { agriculture: 40, industry: 60, research: 0, conservation: 0 } },
      ],
      branches: [],
      crossings: [
        {
          tick: 0,
          kind: 'knowledge',
          dose: 3,
          amounts: [10],
          origin: { world: 'B', tick: 0 },
          cost: 9,
          direction: 'in',
        },
      ],
    })
    host.handle({ type: 'step', years: 280 })
    expect(world(sent, 'A')?.present.status).toBe('collapsed')
    expect(world(sent, 'A')?.paradox).toMatchObject({ kind: 'debt' })
    expect(last(sent, 'progress')?.ended).toBe('collapse')
  })

  it('streams event records and later closes them', () => {
    const { host, sent, open } = setup()
    open(0, [{ tick: 0, allocation: starved }])
    host.handle({ type: 'step', years: 5 })
    const opened = world(sent, 'A')?.events.find((u) => u.record.event === 'famine')
    expect(opened?.record.end).toBeNull()
    host.handle({ type: 'step', years: 1000 })
    const closed = all(sent, 'progress')
      .flatMap((p) => p.worlds.flatMap((w) => w.events))
      .find((u) => u.index === opened?.index && u.record.end !== null)
    expect(closed).toBeDefined()
  })

  it('applies a decision from the present onward without moving time', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'decide', world: 'A', allocation: starved })
    expect(last(sent, 'progress')?.now).toBe(10)
    expect(world(sent, 'A')?.decisions).toEqual([{ tick: 10, allocation: starved }])
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'A')?.present.allocation).toEqual(starved)
  })

  it('answers range requests per worldline', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 100 })
    host.handle({ type: 'range', requestId: 3, world: 'A', from: 0, to: 5000, buckets: 10 })
    const reply = last(sent, 'range')
    const reference = new Worldline(SEED)
    reference.advance(100)
    expect(reply).toMatchObject({ requestId: 3, from: 0, to: 100 })
    expect(reply?.series.population[0]).toBe(reference.range('population', 0, 100, 10).mean[0])
  })

  it('answers inspect requests with the previous year', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 300 })
    host.handle({ type: 'inspect', requestId: 5, world: 'A', tick: 120 })
    const reference = new Worldline(SEED)
    reference.advance(120)
    const reply = last(sent, 'inspect')
    expect(reply?.snapshot.tick).toBe(120)
    expect(reply?.snapshot.values.technology).toBe(reference.present.technology)
    expect(reply?.snapshot.previous?.technology).toBe(reference.valueAt('technology', 119))
  })

  it('reports errors for requests before a world exists', () => {
    const { host, sent } = setup()
    host.handle({ type: 'range', requestId: 7, world: 'A', from: 0, to: 1, buckets: 1 })
    expect(last(sent, 'error')).toEqual({
      type: 'error',
      message: 'no worldline created',
      requestId: 7,
    })
  })

  it('keeps working after rejecting an invalid decision', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'decide', world: 'A', allocation: { ...starved, research: 0 } })
    expect(last(sent, 'error')?.message).toMatch(/allocation/)
    host.handle({ type: 'step', years: 2 })
    expect(last(sent, 'progress')?.now).toBe(2)
  })

  it('reports an error and stops playback when a frame throws', () => {
    const { host, sent, clock, open } = setup()
    open()
    vi.spyOn(Worldline.prototype, 'advance').mockImplementationOnce(() => {
      throw new Error('boom')
    })
    host.handle({ type: 'play', speed: 16 })
    clock.advance(100)
    expect(last(sent, 'error')?.message).toBe('boom')
    const before = sent.length
    clock.advance(1000)
    expect(sent.length).toBe(before)
  })
})

describe('SimulationHost: the multiverse', () => {
  it('branches from a past year into a new worldline that shares the present', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 100 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 40, allocation: starved })
    expect(last(sent, 'branched')).toEqual({ type: 'branched', requestId: 1, world: 'B' })
    const b = world(sent, 'B')
    expect(b?.info).toMatchObject({ id: 'B', parent: 'A', fork: 40 })
    expect(b?.present.tick).toBe(100)
    expect(b?.decisions).toEqual([{ tick: 40, allocation: starved }])
  })

  it('keeps a branch identical to its parent when the decision changes nothing', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 300 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 120, allocation: balanced })
    expect(world(sent, 'B')?.present.values).toEqual(world(sent, 'A')?.present.values)
    host.handle({
      type: 'distance',
      requestId: 2,
      world: 'B',
      reference: 'A',
      from: 0,
      to: 300,
      buckets: 301,
    })
    expect(Array.from(last(sent, 'distance')?.values ?? [])).toEqual(new Array(301).fill(0))
  })

  it('advances every worldline together', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 100 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 50, allocation: starved })
    host.handle({ type: 'step', years: 50 })
    expect(world(sent, 'A')?.present.tick).toBe(150)
    expect(world(sent, 'B')?.present.tick).toBe(150)
  })

  it('freezes extinct worldlines while the others continue', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 0, allocation: industrial })
    host.handle({ type: 'step', years: 2000 })
    expect(world(sent, 'B')?.present.status).toBe('extinct')
    expect(world(sent, 'B')?.present.tick).toBeLessThan(2000)
    expect(world(sent, 'A')?.present.tick).toBe(2000)
    expect(last(sent, 'progress')?.now).toBe(2000)
    expect(last(sent, 'progress')?.ended).toBeNull()
  })

  it('refuses a seventh worldline', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 10 })
    for (let i = 1; i <= 5; i++) {
      host.handle({ type: 'branch', requestId: i, parent: 'A', tick: i, allocation: starved })
    }
    host.handle({ type: 'branch', requestId: 6, parent: 'A', tick: 6, allocation: starved })
    expect(last(sent, 'error')).toMatchObject({ requestId: 6, message: 'worldline limit reached' })
    expect(last(sent, 'progress')?.worlds).toHaveLength(6)
  })

  it('removes a worldline with its descendants but never the original', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 50 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 10, allocation: starved })
    host.handle({ type: 'branch', requestId: 2, parent: 'B', tick: 20, allocation: industrial })
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 30, allocation: industrial })
    host.handle({ type: 'remove', world: 'B' })
    expect(last(sent, 'progress')?.worlds.map((w) => w.info.id)).toEqual(['A', 'D'])
    host.handle({ type: 'remove', world: 'A' })
    expect(last(sent, 'error')?.message).toMatch(/original/)
  })

  it('reuses the lowest free letter with a new generation', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 20 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 5, allocation: starved })
    const first = world(sent, 'B')?.info.generation ?? 0
    host.handle({ type: 'remove', world: 'B' })
    host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 8, allocation: starved })
    expect(world(sent, 'B')?.info.generation).toBeGreaterThan(first)
    expect(world(sent, 'B')?.info.fork).toBe(8)
  })

  it('opens a whole multiverse from a link', () => {
    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      branches: [
        { parent: 0, fork: 100, decisions: [{ tick: 100, allocation: starved }] },
        { parent: 1, fork: 200, decisions: [] },
      ],
    })
    expect(last(sent, 'progress')?.worlds.map((w) => w.info.id)).toEqual(['A', 'B', 'C'])
    expect(world(sent, 'C')?.info).toMatchObject({ parent: 'B', fork: 200 })
    expect(world(sent, 'C')?.present.tick).toBe(300)
    expect(world(sent, 'C')?.decisions).toEqual([{ tick: 100, allocation: starved }])
    expect(world(sent, 'C')?.present.values).toEqual(world(sent, 'B')?.present.values)
  })

  it('rejects a branch whose fork lies outside its parent history', () => {
    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      branches: [{ parent: 0, fork: 500, decisions: [] }],
    })
    expect(last(sent, 'error')?.message).toMatch(/fork/)
  })

  it('leaves the previous multiverse intact when a later open is invalid', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 50 })
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      branches: [{ parent: 0, fork: 500, decisions: [] }],
    })
    expect(last(sent, 'error')?.message).toMatch(/fork/)
    host.handle({ type: 'step', years: 10 })
    expect(last(sent, 'progress')?.now).toBe(60)
    expect(world(sent, 'A')?.present.tick).toBe(60)
  })

  it('rejects opening more than six worldlines', () => {
    const { host, sent } = setup()
    const branches = Array.from({ length: 6 }, () => ({
      parent: 0,
      fork: 0,
      decisions: [] as { tick: number; allocation: Allocation }[],
    }))
    host.handle({ type: 'open', seed: SEED, tick: 10, root: [], branches })
    expect(last(sent, 'error')?.message).toBe('worldline limit reached')
    host.handle({ type: 'range', requestId: 1, world: 'A', from: 0, to: 1, buckets: 1 })
    expect(last(sent, 'error')?.message).toBe('no worldline created')
  })

  it('rejects an open whose branch has an invalid allocation', () => {
    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 50,
      root: [],
      branches: [
        { parent: 0, fork: 10, decisions: [{ tick: 10, allocation: { ...starved, research: 0 } }] },
      ],
    })
    expect(last(sent, 'error')?.message).toMatch(/allocation/)
    host.handle({ type: 'range', requestId: 2, world: 'A', from: 0, to: 1, buckets: 1 })
    expect(last(sent, 'error')?.message).toBe('no worldline created')
  })

  it('measures the causal distance between worldlines', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 0, allocation: industrial })
    host.handle({ type: 'step', years: 800 })
    host.handle({
      type: 'distance',
      requestId: 2,
      world: 'B',
      reference: 'A',
      from: 0,
      to: 800,
      buckets: 8,
    })
    const reply = last(sent, 'distance')
    expect(reply?.values).toHaveLength(8)
    expect(reply?.values[7]).toBeGreaterThan(0)
    host.handle({
      type: 'distance',
      requestId: 3,
      world: 'A',
      reference: 'A',
      from: 0,
      to: 800,
      buckets: 8,
    })
    expect(Array.from(last(sent, 'distance')?.values ?? [])).toEqual(new Array(8).fill(0))
  })

  it('clears the end when a new living branch appears', () => {
    const { host, sent, open } = setup()
    open(0, [{ tick: 0, allocation: industrial }])
    host.handle({ type: 'step', years: 3000 })
    expect(last(sent, 'progress')?.ended).toBe('extinction')
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 100, allocation: balanced })
    expect(last(sent, 'progress')?.ended).toBeNull()
  })
})

describe('SimulationHost: crossings', () => {
  it('moves knowledge from one worldline into another', () => {
    const { host, sent } = pair()
    const before = last(sent, 'progress')?.credit ?? 0
    expect(before).toBeGreaterThan(0)
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'A',
      destination: 'B',
      kind: 'knowledge',
      dose: 1,
    })
    const reply = last(sent, 'crossed')
    expect(reply).toMatchObject({ requestId: 2, world: 'B' })
    expect(reply?.crossing).toMatchObject({
      tick: 2000,
      kind: 'knowledge',
      dose: 1,
      direction: 'in',
      origin: { world: 'A', tick: 2000 },
    })
    expect(reply?.crossing.amounts[0]).toBeGreaterThan(0)
    expect(reply?.crossing.cost).toBeGreaterThan(0)
    expect(world(sent, 'B')?.crossings).toHaveLength(1)
    expect(world(sent, 'A')?.crossings).toHaveLength(0)
    expect(last(sent, 'progress')?.credit).toBe(before - (reply?.crossing.cost ?? 0))
    host.handle({ type: 'step', years: 1 })
    const a = world(sent, 'A')?.present.values.technology ?? 0
    expect(world(sent, 'B')?.present.values.technology).toBeGreaterThan(a)
  })

  it('refuses a crossing without credit', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 0, allocation: balanced })
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'A',
      destination: 'B',
      kind: 'knowledge',
      dose: 3,
    })
    const error = last(sent, 'error')
    expect(error?.requestId).toBe(2)
    expect(error?.message).toBe('not enough credit: this crossing costs 9 and 5 is missing')
    expect(world(sent, 'B')?.crossings).toEqual([])
  })

  it('refuses a crossing into the same worldline and from an extinct one', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 10 })
    host.handle({
      type: 'cross',
      requestId: 1,
      origin: 'A',
      destination: 'A',
      kind: 'doctrine',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 1 })
    expect(last(sent, 'error')?.message).toMatch(/same worldline/)
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'A',
      destination: 'F',
      kind: 'doctrine',
      dose: 1,
    })
    expect(last(sent, 'error')?.message).toBe('unknown worldline F')
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 0, allocation: industrial })
    host.handle({ type: 'step', years: 2000 })
    expect(world(sent, 'B')?.present.status).toBe('extinct')
    host.handle({
      type: 'cross',
      requestId: 4,
      origin: 'B',
      destination: 'A',
      kind: 'doctrine',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 4 })
    expect(last(sent, 'error')?.message).toMatch(/extinct/)
    host.handle({
      type: 'cross',
      requestId: 5,
      origin: 'A',
      destination: 'B',
      kind: 'doctrine',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 5 })
    expect(last(sent, 'error')?.message).toMatch(/extinct/)
    expect(world(sent, 'A')?.crossings).toEqual([])
  })

  it('records the departure in the origin when people cross', () => {
    const { host, sent } = pair()
    const before = last(sent, 'progress')?.credit ?? 0
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'A',
      destination: 'B',
      kind: 'people',
      dose: 1,
    })
    const crossing = last(sent, 'crossed')?.crossing
    const departure = world(sent, 'A')?.crossings[0]
    const arrival = world(sent, 'B')?.crossings[0]
    expect(arrival).toMatchObject({ direction: 'in', kind: 'people', cost: crossing?.cost })
    expect(departure).toMatchObject({
      direction: 'out',
      kind: 'people',
      cost: 0,
      origin: { world: 'B', tick: 2000 },
    })
    expect(departure?.amounts).toEqual(arrival?.amounts)
    expect(last(sent, 'progress')?.credit).toBe(before - (crossing?.cost ?? 0))
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'B')?.present.values.population).toBeGreaterThan(
      world(sent, 'A')?.present.values.population ?? Infinity,
    )
  })

  it('carries the origin allocation when doctrine crosses', () => {
    const { host, sent } = pair()
    host.handle({ type: 'decide', world: 'A', allocation: starved })
    host.handle({ type: 'step', years: 1 })
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'A',
      destination: 'B',
      kind: 'doctrine',
      dose: 1,
    })
    expect(last(sent, 'crossed')?.crossing.allocation).toEqual(starved)
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'B')?.present.allocation).toEqual(starved)
  })

  it('reports the debts a crossing opens, on the world that carries them', () => {
    const { host, sent } = pair()
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'A',
      destination: 'B',
      kind: 'knowledge',
      dose: 1,
    })
    host.handle({ type: 'step', years: 1 })
    const b = world(sent, 'B')
    expect(b?.debts).toHaveLength(1)
    expect(b?.debts[0]).toMatchObject({ kind: 'knowledge', origin: 'A' })
    expect(b?.debts[0]?.owed).toBeGreaterThan(0)
    expect(b?.paradox).toBeNull()
    expect(world(sent, 'A')?.debts).toEqual([])
  })

  it('charges the destination debt ratio into the cost of the next crossing', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 1000 })
    // FEAT: mais realidades vivas dão mais crédito, sem mexer no mundo B nem na sua dívida
    for (let i = 0; i < 5; i++) {
      host.handle({ type: 'branch', requestId: i, parent: 'A', tick: 100, allocation: balanced })
    }
    host.handle({
      type: 'cross',
      requestId: 20,
      origin: 'A',
      destination: 'B',
      kind: 'knowledge',
      dose: 2,
    })
    host.handle({ type: 'step', years: 1 })
    const debts = world(sent, 'B')?.debts ?? []
    expect(debts.length).toBeGreaterThan(0)
    const a = world(sent, 'A')?.present.values
    const b = world(sent, 'B')?.present.values
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    const ratio = debtRatio(debts, {
      economy: b?.economy ?? 0,
      population: b?.population ?? 0,
    } as WorldState)
    expect(ratio).toBeGreaterThan(0)
    const distance = a && b ? causalDistance(a, b) : 0
    const debtFree = crossingCost('resource', 3, distance)
    const expected = crossingCost('resource', 3, distance, ratio)
    // FIX: um mundo sem dívida pagaria menos por essa mesma travessia
    expect(expected).toBeGreaterThan(debtFree)
    host.handle({
      type: 'cross',
      requestId: 21,
      origin: 'A',
      destination: 'B',
      kind: 'resource',
      dose: 3,
    })
    expect(last(sent, 'crossed')?.crossing.cost).toBe(expected)
  })

  it('flags the crossing that closes a loop between two worlds, and the engine turns it into a circular paradox', () => {
    const { host, sent } = pair()
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'B',
      destination: 'A',
      kind: 'knowledge',
      dose: 1,
    })
    expect(last(sent, 'crossed')?.crossing.circular).toBeUndefined()
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'A')?.debts.length).toBeGreaterThan(0)
    host.handle({
      type: 'cross',
      requestId: 3,
      origin: 'A',
      destination: 'B',
      kind: 'knowledge',
      dose: 1,
    })
    expect(last(sent, 'crossed')?.crossing.circular).toBe(true)
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'B')?.paradox?.kind).toBe('circular')
  })

  it('never flags people, even between two worlds that already owe each other', () => {
    const { host, sent } = pair()
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'B',
      destination: 'A',
      kind: 'knowledge',
      dose: 1,
    })
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'A')?.debts.length).toBeGreaterThan(0)
    host.handle({
      type: 'cross',
      requestId: 3,
      origin: 'A',
      destination: 'B',
      kind: 'people',
      dose: 1,
    })
    expect(last(sent, 'crossed')?.crossing.circular).toBeUndefined()
    host.handle({ type: 'step', years: 1 })
    // FEAT: gente não abre dívida, então o ciclo segue como estava e nenhum paradoxo nasce
    expect(world(sent, 'B')?.paradox).toBeNull()
    expect(world(sent, 'B')?.debts).toEqual([])
  })

  it('rebuilds a multiverse with crossings from open', () => {
    const { host, sent } = setup()
    const arrival = {
      tick: 150,
      kind: 'knowledge' as const,
      dose: 1 as const,
      amounts: [5],
      origin: { world: 'A', tick: 150 },
      cost: 3,
      direction: 'in' as const,
    }
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      branches: [{ parent: 0, fork: 100, decisions: [], crossings: [arrival] }],
    })
    expect(world(sent, 'B')?.crossings).toEqual([arrival])
    expect(world(sent, 'A')?.crossings).toEqual([])
    expect(world(sent, 'B')?.present.values.technology).toBeGreaterThan(
      world(sent, 'A')?.present.values.technology ?? Infinity,
    )
  })

  it('gives a new branch the crossings from before its fork', () => {
    const { host, sent } = pair()
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'B',
      destination: 'A',
      kind: 'knowledge',
      dose: 1,
    })
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 2000, allocation: starved })
    expect(world(sent, 'C')?.crossings).toEqual([])
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'branch', requestId: 4, parent: 'A', tick: 2005, allocation: starved })
    expect(world(sent, 'A')?.crossings).toHaveLength(1)
    expect(world(sent, 'D')?.crossings).toEqual(world(sent, 'A')?.crossings)
  })

  it('charges a crossing once, however many branches inherit it', () => {
    const { host, sent } = pair()
    host.handle({
      type: 'cross',
      requestId: 2,
      origin: 'A',
      destination: 'B',
      kind: 'knowledge',
      dose: 1,
    })
    const spent = last(sent, 'progress')?.credit ?? 0
    const cost = last(sent, 'crossed')?.crossing.cost ?? 0
    expect(cost).toBeGreaterThan(0)
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'branch', requestId: 3, parent: 'B', tick: 2005, allocation: balanced })
    expect(world(sent, 'C')?.crossings).toHaveLength(1)
    expect(last(sent, 'progress')?.credit).toBe(spent + 4)
    host.handle({ type: 'branch', requestId: 4, parent: 'C', tick: 2005, allocation: balanced })
    expect(world(sent, 'D')?.crossings).toHaveLength(1)
    expect(last(sent, 'progress')?.credit).toBe(spent + 8)
  })

  it('branches with the crossing already in the fork year', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 2000 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 100, allocation: starved })
    host.handle({ type: 'step', years: 100 })
    host.handle({
      type: 'crossBranch',
      requestId: 2,
      parent: 'B',
      tick: 200,
      origin: 'A',
      kind: 'knowledge',
      dose: 2,
    })
    expect(last(sent, 'branched')).toEqual({ type: 'branched', requestId: 2, world: 'C' })
    const reference = new Worldline(SEED)
    reference.advance(200)
    const c = world(sent, 'C')
    expect(c?.info).toMatchObject({ id: 'C', parent: 'B', fork: 200 })
    expect(c?.present.tick).toBe(2100)
    expect(c?.crossings).toHaveLength(1)
    expect(c?.crossings[0]).toMatchObject({
      tick: 200,
      kind: 'knowledge',
      dose: 2,
      direction: 'in',
      origin: { world: 'A', tick: 200 },
    })
    expect(c?.crossings[0]?.amounts).toEqual(crossingAmounts('knowledge', 2, reference.present))
    expect(c?.crossings[0]?.cost).toBeGreaterThan(0)
    expect(c?.present.values.technology).not.toBe(world(sent, 'B')?.present.values.technology)
    expect(world(sent, 'B')?.crossings).toEqual([])
  })

  it('carries the origin allocation when doctrine crosses into the fork year', () => {
    const { host, sent } = pair()
    host.handle({ type: 'decide', world: 'A', allocation: starved })
    host.handle({ type: 'step', years: 10 })
    host.handle({
      type: 'crossBranch',
      requestId: 2,
      parent: 'B',
      tick: 2005,
      origin: 'A',
      kind: 'doctrine',
      dose: 1,
    })
    expect(world(sent, 'C')?.crossings[0]).toMatchObject({ tick: 2005, allocation: starved })
    expect(world(sent, 'C')?.present.allocation).toEqual(starved)
  })

  it('refuses a crossBranch when the worldline limit is reached', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 100 })
    for (let i = 1; i <= 5; i++) {
      host.handle({ type: 'branch', requestId: i, parent: 'A', tick: i, allocation: balanced })
    }
    host.handle({
      type: 'crossBranch',
      requestId: 6,
      parent: 'B',
      tick: 50,
      origin: 'A',
      kind: 'knowledge',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 6, message: 'worldline limit reached' })
    expect(last(sent, 'progress')?.worlds).toHaveLength(6)
  })

  it('refuses a crossBranch from an extinct origin or into a fork year the parent never lived', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 0, allocation: industrial })
    host.handle({ type: 'step', years: 2000 })
    expect(world(sent, 'B')?.present.status).toBe('extinct')
    host.handle({
      type: 'crossBranch',
      requestId: 2,
      parent: 'A',
      tick: 100,
      origin: 'B',
      kind: 'knowledge',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 2 })
    expect(last(sent, 'error')?.message).toMatch(/extinct/)
    host.handle({
      type: 'crossBranch',
      requestId: 3,
      parent: 'B',
      tick: 5000,
      origin: 'A',
      kind: 'knowledge',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 3 })
    expect(last(sent, 'error')?.message).toMatch(/year 5000/)
    host.handle({
      type: 'crossBranch',
      requestId: 4,
      parent: 'A',
      tick: 100,
      origin: 'F',
      kind: 'knowledge',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 4, message: 'unknown worldline F' })
    expect(last(sent, 'progress')?.worlds).toHaveLength(2)
  })

  it('charges the crossBranch to the credit exactly once', () => {
    const { host, sent } = pair()
    const before = last(sent, 'progress')?.credit ?? 0
    host.handle({
      type: 'crossBranch',
      requestId: 2,
      parent: 'B',
      tick: 500,
      origin: 'A',
      kind: 'knowledge',
      dose: 1,
    })
    const cost = world(sent, 'C')?.crossings[0]?.cost ?? 0
    expect(cost).toBeGreaterThan(0)
    expect(last(sent, 'progress')?.credit).toBe(before + 4 - cost)
    host.handle({ type: 'branch', requestId: 3, parent: 'C', tick: 2000, allocation: balanced })
    expect(world(sent, 'D')?.crossings).toHaveLength(1)
    expect(last(sent, 'progress')?.credit).toBe(before + 8 - cost)
  })

  it('refuses people on a crossBranch', () => {
    const { host, sent } = pair()
    host.handle({
      type: 'crossBranch',
      requestId: 2,
      parent: 'B',
      tick: 500,
      origin: 'A',
      kind: 'people',
      dose: 1,
    })
    expect(last(sent, 'error')).toMatchObject({ requestId: 2 })
    expect(last(sent, 'error')?.message).toMatch(/people/)
    expect(last(sent, 'progress')?.worlds).toHaveLength(2)
  })
})

describe('SimulationHost: confluences', () => {
  function living(sent: readonly FromWorker[]) {
    return last(sent, 'progress')?.worlds.filter((w) => w.present.status === 'running') ?? []
  }

  function causesOf(sent: readonly FromWorker[], id: WorldlineId, event: string) {
    return all(sent, 'progress')
      .flatMap((progress) => progress.worlds.find((w) => w.info.id === id)?.events ?? [])
      .filter((update) => update.record.event === event)
      .flatMap((update) => update.record.causes)
  }

  it('seams two living histories into one', () => {
    const { host, sent } = pair()
    const a = world(sent, 'A')?.present.values.population ?? 0
    const b = world(sent, 'B')?.present.values.population ?? 0
    expect(b).toBeGreaterThan(0)
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    expect(last(sent, 'merged')).toEqual({ type: 'merged', requestId: 2, world: 'A' })
    expect(world(sent, 'A')?.present.status).toBe('running')
    expect(world(sent, 'B')?.present.status).toBe('merged')
    expect(world(sent, 'B')?.present.tick).toBe(2000)
    expect(causesOf(sent, 'B', 'merged_away')).toEqual([{ kind: 'merge', tick: 2000, other: 'A' }])
    host.handle({ type: 'step', years: 1 })
    // FEAT: cada recibo nomeia a OUTRA história, e é por essa ordem que a costura se lê dos dois lados
    expect(causesOf(sent, 'A', 'merge')).toEqual([{ kind: 'merge', tick: 2000, other: 'B' }])
    // FIX: 1,8x separa a união (1,92x) do ano de crescimento sozinho (1,006x); a soma crua falharia
    expect(world(sent, 'A')?.present.values.population).toBeGreaterThan(1.8 * Math.max(a, b))
  })

  it('keeps a merged history in the list, frozen in the year of the seam', () => {
    const { host, sent } = pair()
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 1 })
    expect(last(sent, 'progress')?.worlds.map((w) => w.info.id)).toEqual(['A', 'B'])
    expect(world(sent, 'B')?.present.tick).toBe(2000)
    expect(world(sent, 'B')?.present.status).toBe('merged')
    expect(world(sent, 'A')?.present.tick).toBe(2001)
    expect(last(sent, 'progress')?.now).toBe(2001)
  })

  // FIX: o painel nomeia o abalo, que é o menor custo da costura; o maior é a comida, porque o
  // celeiro soma e a colheita não — sem o número do motor a prévia leria a costura como ganho
  it('reports the food per person the united history would live with, and the famine it brings', () => {
    const famine = EVENTS.find((def) => def.id === 'famine')
    const hungry = famine?.trigger.find((c) => c.metric === 'foodSecurity')?.value
    expect(hungry).toBeGreaterThan(0)
    const { host, sent } = pair()

    host.handle({ type: 'mergePreview', requestId: 2, survivor: 'A', other: 'B' })
    const kept = last(sent, 'mergePreview')
    host.handle({ type: 'mergePreview', requestId: 3, survivor: 'B', other: 'A' })
    const leaving = last(sent, 'mergePreview')
    // FEAT: as duas se alimentam de sobra hoje, cada uma medida no próprio estado
    expect(kept?.food.now).toBeGreaterThan(1)
    expect(leaving?.food.now).toBeGreaterThan(1)
    // FEAT: e unidas não se alimentam — o número previsto já está abaixo da linha da fome do motor
    expect(kept?.food.next).toBeLessThan(hungry ?? 0)
    expect(kept?.food.next).toBeLessThan(Math.min(kept?.food.now ?? 0, leaving?.food.now ?? 0))

    host.handle({ type: 'merge', requestId: 4, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 2 })
    // FEAT: a prévia não exagerou: a fome que ela anuncia é a que o motor vive no ano seguinte
    expect(causesOf(sent, 'A', 'famine')).not.toEqual([])
  })

  // FIX: sem o paradoxo no recibo o observador lavaria um colapso, que é o que a §5.3 proíbe: a
  // dívida a terceiros ainda viajaria, mas o prazo voltaria a contar do ano da costura
  it('carries the paradox of the departing history, deadline and all, so no collapse is laundered', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 300 })
    for (let i = 1; i <= 4; i++) {
      host.handle({ type: 'branch', requestId: i, parent: 'A', tick: 100, allocation: balanced })
    }
    // FEAT: uma B que nunca pesquisa nunca quita, e um presente deste tamanho a joga no paradoxo
    host.handle({
      type: 'decide',
      world: 'B',
      allocation: { agriculture: 45, industry: 55, research: 0, conservation: 0 },
    })
    host.handle({ type: 'step', years: 1 })
    host.handle({
      type: 'cross',
      requestId: 20,
      origin: 'C',
      destination: 'B',
      kind: 'knowledge',
      dose: 3,
    })
    host.handle({ type: 'step', years: 20 })
    const doomed = world(sent, 'B')?.paradox
    expect(doomed).toMatchObject({ kind: 'leap' })
    expect(world(sent, 'A')?.paradox).toBeNull()

    host.handle({ type: 'merge', requestId: 21, survivor: 'A', other: 'B' })
    expect(world(sent, 'A')?.merges.at(-1)?.paradox).toEqual(doomed)
    host.handle({ type: 'step', years: 1 })
    // FEAT: o prazo da que chegou é o prazo da unida; um paradoxo novo começaria a contar de agora
    expect(world(sent, 'A')?.paradox).toEqual(doomed)
  })

  // FIX: sem o lar no recibo as duas se leem no mesmo corpo, a gente soma em vez de se conservar e
  // o corpo abandonado desaparece em silêncio — é o inverso do erro que a §5.4 nomeia
  it('carries the home of the departing history, so two homes are read as two', () => {
    const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: INHERITANCE_CASE.seed,
      tick: 2290,
      root: plan.decisions,
      branches: [],
      crossings: plan.crossings,
    })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 100, allocation: balanced })
    // FEAT: A herdou a colônia do corpo 1 quando o natal caiu; B nunca saiu do natal
    const away = world(sent, 'A')?.present
    const stays = world(sent, 'B')?.present
    expect(away?.home).toBe(1)
    expect(stays?.home).toBeNull()
    const people = (away?.values.population ?? 0) + (stays?.values.population ?? 0)

    host.handle({ type: 'merge', requestId: 2, survivor: 'B', other: 'A' })
    expect(world(sent, 'B')?.merges.at(-1)?.home).toBe(1)
    host.handle({ type: 'step', years: 1 })
    // FEAT: a gente se conserva, não soma: a mais leve perde a casa, e a casa dela vira colônia
    expect(world(sent, 'B')?.present.values.population).toBeLessThan(people * 0.95)
    expect(world(sent, 'B')?.colonies.map((colony) => colony.body)).toEqual([1])
  })

  // FIX: o corpo natal do recibo é do hospedeiro, e um índice errado faria `mergeStates` resolver os
  // dois lares para corpos que não existem, tudo em silêncio porque a saída grava `home: null`
  it('stamps the natal body of the seed on the receipt, and reads a null home as that body', () => {
    const natal = system(SEED).find((body) => body.home)?.index
    expect(natal).toBeGreaterThanOrEqual(0)
    const { host, sent } = pair()
    const a = world(sent, 'A')?.present
    const b = world(sent, 'B')?.present
    expect(a?.home).toBeNull()
    expect(b?.home).toBeNull()

    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    expect(world(sent, 'A')?.merges.at(-1)?.natal).toBe(natal)
    host.handle({ type: 'step', years: 1 })
    // FEAT: duas com `home: null` moram no mesmo corpo, então a gente soma e nenhuma colônia nasce
    expect(world(sent, 'A')?.present.values.population).toBeGreaterThan(
      1.8 * Math.max(a?.values.population ?? 0, b?.values.population ?? 0),
    )
    expect(world(sent, 'A')?.colonies).toEqual([])
  })

  // FIX: nada na API pública deixa duas vivas em anos diferentes, então o espião abaixo é o que
  // torna a precaução alcançável; sem ela a sobrevivente gravaria a chegada e a outra estouraria
  // depois, deixando meia costura — um recibo 'in' sem o 'out' do outro lado
  it('refuses a confluence whose two ends are not in the same year, and writes neither', () => {
    const { host, sent } = pair()
    const real = Worldline.prototype.advance
    vi.spyOn(Worldline.prototype, 'advance').mockImplementation(function (
      this: Worldline,
      years: number,
    ) {
      return this.lineage === null ? real.call(this, years) : 0
    })
    host.handle({ type: 'step', years: 1 })
    expect(last(sent, 'progress')?.now).toBe(2001)
    expect(world(sent, 'B')?.present.tick).toBe(2000)

    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 2 })
    expect(last(sent, 'error')?.message).toMatch(/year 2001 applied to the departing/)
    expect(all(sent, 'merged')).toEqual([])
    host.handle({ type: 'step', years: 0 })
    // FEAT: e nenhuma das duas guardou nada — meia costura não se escreve
    expect(world(sent, 'A')?.merges).toEqual([])
    expect(world(sent, 'B')?.merges).toEqual([])
  })

  it('refuses a confluence with itself, with an unknown letter, and with a dead history', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'merge', requestId: 1, survivor: 'A', other: 'A' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 1 })
    expect(last(sent, 'error')?.message).toMatch(/same/)
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'F' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 2, message: 'unknown worldline F' })
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 0, allocation: industrial })
    host.handle({ type: 'step', years: 2000 })
    expect(world(sent, 'B')?.present.status).toBe('extinct')
    host.handle({ type: 'merge', requestId: 4, survivor: 'A', other: 'B' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 4 })
    expect(last(sent, 'error')?.message).toMatch(/extinct/)
    host.handle({ type: 'merge', requestId: 5, survivor: 'B', other: 'A' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 5 })
    expect(last(sent, 'error')?.message).toMatch(/extinct/)
    expect(world(sent, 'A')?.present.status).toBe('running')
    expect(all(sent, 'merged')).toEqual([])
  })

  it('refuses to seam a history that already flowed away, and says what happened to it', () => {
    const { host, sent } = pair()
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 1 })
    host.handle({ type: 'merge', requestId: 3, survivor: 'A', other: 'B' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 3 })
    expect(last(sent, 'error')?.message).toMatch(/merged into another history/)
    expect(last(sent, 'error')?.message).not.toMatch(/horizon/)
  })

  it('refuses a second confluence in the same year and leaves the other end untouched', () => {
    const { host, sent } = pair()
    host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 200, allocation: balanced })
    host.handle({ type: 'merge', requestId: 3, survivor: 'A', other: 'B' })
    expect(last(sent, 'merged')).toEqual({ type: 'merged', requestId: 3, world: 'A' })
    host.handle({ type: 'merge', requestId: 4, survivor: 'A', other: 'C' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 4 })
    expect(last(sent, 'error')?.message).toMatch(/year 2000/)
    expect(all(sent, 'merged')).toHaveLength(1)
    // FIX: a recusa não relata nada, então C só se lê viva perguntando de novo, agora
    host.handle({ type: 'inspect', requestId: 5, world: 'C', tick: 2000 })
    expect(last(sent, 'inspect')?.snapshot).toMatchObject({ tick: 2000, status: 'running' })
    host.handle({ type: 'step', years: 1 })
    host.handle({ type: 'merge', requestId: 6, survivor: 'A', other: 'C' })
    // FIX: e a costura que C ainda consegue dar é o que prova que o log dela não ficou pela metade
    expect(last(sent, 'merged')).toEqual({ type: 'merged', requestId: 6, world: 'A' })
    expect(world(sent, 'C')?.present.status).toBe('merged')
    expect(world(sent, 'C')?.present.tick).toBe(2001)
  })

  it('gives a branch of the survivor the confluence from before its fork', () => {
    const { host, sent } = pair()
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 1 })
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 2001, allocation: balanced })
    // FIX: sem herdar a costura a filha nasceria com metade da mãe no ano em que diz sair dela
    expect(world(sent, 'C')?.present.tick).toBe(2001)
    expect(world(sent, 'C')?.present.values).toEqual(world(sent, 'A')?.present.values)
  })

  it('never hands the outflow to a branch of the history that flowed away', () => {
    const { host, sent } = pair()
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 1 })
    host.handle({ type: 'branch', requestId: 3, parent: 'B', tick: 2000, allocation: balanced })
    // FEAT: o deságue é do ano da bifurcação, e só o que vem estritamente antes dela se herda
    expect(world(sent, 'C')?.present.status).toBe('running')
    expect(world(sent, 'C')?.present.tick).toBe(2001)
  })

  it('carries the other ledger over and dissolves what the two owed each other', () => {
    const { host, sent } = pair()
    host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 200, allocation: balanced })
    host.handle({ type: 'decide', world: 'A', allocation: starved })
    host.handle({ type: 'step', years: 1 })
    host.handle({
      type: 'cross',
      requestId: 3,
      origin: 'A',
      destination: 'B',
      kind: 'doctrine',
      dose: 1,
    })
    host.handle({
      type: 'cross',
      requestId: 4,
      origin: 'C',
      destination: 'B',
      kind: 'knowledge',
      dose: 1,
    })
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'B')?.debts).toMatchObject([
      { kind: 'doctrine', origin: 'A', allocation: starved },
      { kind: 'knowledge', origin: 'C' },
    ])
    host.handle({ type: 'merge', requestId: 5, survivor: 'A', other: 'B' })
    expect(last(sent, 'merged')).toEqual({ type: 'merged', requestId: 5, world: 'A' })
    host.handle({ type: 'step', years: 1 })
    // FEAT: a dívida com quem se mesclou virou interna; a de fora atravessa com a história
    expect(world(sent, 'A')?.debts).toMatchObject([{ kind: 'knowledge', origin: 'C' }])
  })

  // FIX: 'events' é uma entrega incremental (só o que é novo desde o último 'progress'), então
  // comparar dois relatórios diferentes por ela sempre divergiria mesmo sem nenhuma mudança real
  // FIX: 'merges' e outros campos vêm por referência da Worldline; sem clonar, uma mutação in-place
  // (como um `.push`) nunca apareceria comparando o "antes" com o "depois" — os dois apontam ao mesmo array
  function frozen(entry: ReturnType<typeof world>) {
    if (!entry) return entry
    const { info, present, decisions, crossings, merges, debts, paradox, colonies } = entry
    return structuredClone({
      info,
      present,
      decisions,
      crossings,
      merges,
      debts,
      paradox,
      colonies,
    })
  }

  it('previews the exact ledger a confluence would settle, without touching either worldline', () => {
    const { host, sent } = pair()
    host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 200, allocation: balanced })
    host.handle({ type: 'decide', world: 'A', allocation: starved })
    host.handle({ type: 'step', years: 1 })
    host.handle({
      type: 'cross',
      requestId: 3,
      origin: 'A',
      destination: 'B',
      kind: 'doctrine',
      dose: 1,
    })
    host.handle({
      type: 'cross',
      requestId: 4,
      origin: 'C',
      destination: 'B',
      kind: 'knowledge',
      dose: 1,
    })
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'B')?.debts).toMatchObject([
      { kind: 'doctrine', origin: 'A', allocation: starved },
      { kind: 'knowledge', origin: 'C' },
    ])

    const a = frozen(world(sent, 'A'))
    const b = frozen(world(sent, 'B'))
    const progressBefore = all(sent, 'progress').length

    host.handle({ type: 'mergePreview', requestId: 5, survivor: 'A', other: 'B' })
    const reply = last(sent, 'mergePreview')
    expect(reply).toMatchObject({ type: 'mergePreview', requestId: 5 })
    // FEAT: a dívida com quem se costuraria já vira interna na prévia; a de fora, C, permanece
    expect(reply?.seamed.debts).toMatchObject([{ kind: 'knowledge', origin: 'C' }])
    // FIX: as duas contas de dívida saem daqui, onde a regra do motor mora, e não da tela: a que
    // chega é a que sobrevive à anulação, e A não devia nada, então ela é o livro-razão da unida
    expect(totalOwed(a?.debts ?? [])).toBe(0)
    expect(reply?.debtIn).toBeCloseTo(totalOwed(reply?.seamed.debts ?? []))
    expect(reply?.debtIn).toBeLessThan(totalOwed(b?.debts ?? []))
    expect(reply?.debtSettled).toBeCloseTo(totalOwed(b?.debts ?? []) - (reply?.debtIn ?? 0))
    expect(reply?.debtSettled).toBeGreaterThan(0)
    // FIX: comida sempre soma, sem condição nenhuma — prova que a prévia leu as duas pontas certas
    expect(reply?.seamed.values.food).toBeCloseTo(
      (a?.present.values.food ?? 0) + (b?.present.values.food ?? 0),
    )
    // FIX: o abalo relatado bate com a mesma mistura que a costura de verdade usaria para a estabilidade
    const weights = mergeWeights(
      a?.present.values.population ?? 0,
      b?.present.values.population ?? 0,
    )
    const predicted =
      (a?.present.values.stability ?? 0) * weights.a +
      (b?.present.values.stability ?? 0) * weights.b
    expect(reply?.shock).toBeCloseTo(predicted - (reply?.seamed.values.stability ?? 0))

    // FIX: nenhum 'progress' novo é a prova de que a prévia não mexeu em nada
    expect(all(sent, 'progress')).toHaveLength(progressBefore)
    // FEAT: uma leitura genuína depois da prévia confirma que nenhuma das duas se moveu
    host.handle({ type: 'step', years: 0 })
    expect(frozen(world(sent, 'A'))).toEqual(a)
    expect(frozen(world(sent, 'B'))).toEqual(b)

    // FEAT: a costura de verdade, feita depois, mostra que a prévia não veio de outro universo
    host.handle({ type: 'merge', requestId: 6, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 1 })
    expect(world(sent, 'A')?.debts).toMatchObject([{ kind: 'knowledge', origin: 'C' }])
  })

  it('refuses to preview a confluence with itself, an unknown letter, or a dead history', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 10 })
    host.handle({ type: 'mergePreview', requestId: 1, survivor: 'A', other: 'A' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 1 })
    expect(last(sent, 'error')?.message).toMatch(/same/)
    host.handle({ type: 'mergePreview', requestId: 2, survivor: 'A', other: 'F' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 2, message: 'unknown worldline F' })
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 0, allocation: industrial })
    host.handle({ type: 'step', years: 2000 })
    expect(world(sent, 'B')?.present.status).toBe('extinct')
    host.handle({ type: 'mergePreview', requestId: 4, survivor: 'A', other: 'B' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 4 })
    expect(last(sent, 'error')?.message).toMatch(/extinct/)
    expect(all(sent, 'mergePreview')).toEqual([])
  })

  // FIX: uma prévia validada só por #living responderia isto com um número, e a costura de verdade
  // recusaria no ato seguinte — a mesma #ensureSeamable tem de julgar as duas do mesmo jeito
  it('refuses a preview exactly where a real confluence would, in the same year already spoken for', () => {
    const { host, sent } = pair()
    host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 200, allocation: balanced })
    host.handle({ type: 'merge', requestId: 3, survivor: 'A', other: 'B' })
    expect(last(sent, 'merged')).toEqual({ type: 'merged', requestId: 3, world: 'A' })
    host.handle({ type: 'mergePreview', requestId: 4, survivor: 'A', other: 'C' })
    expect(last(sent, 'error')).toMatchObject({ requestId: 4 })
    expect(last(sent, 'error')?.message).toMatch(/year 2000/)
    expect(all(sent, 'mergePreview')).toEqual([])
  })

  // FIX: 'debts'/'paradox'/'colonies' e o Snapshot não contam echoes, strain, recentEconomy nem
  // lastCrossing — comparar só essas chaves é cega a uma mutação neles; rodar os mesmos anos depois
  // num universo gêmeo que NUNCA pediu prévia não é cego a nada disso, porque qualquer uma delas
  // muda o que os dois universos relatam mais adiante
  it('leaves both worldlines running exactly as they would without ever being asked for a preview', () => {
    function seeded() {
      const context = pair()
      // FEAT: um eco de tecnologia em B, para uma mutação que rouba os echoes dela aparecer nos anos seguintes
      context.host.handle({
        type: 'cross',
        requestId: 50,
        origin: 'A',
        destination: 'B',
        kind: 'knowledge',
        dose: 1,
      })
      context.host.handle({ type: 'step', years: 1 })
      return context
    }

    const baseline = seeded()
    const withPreview = seeded()

    withPreview.host.handle({ type: 'mergePreview', requestId: 99, survivor: 'A', other: 'B' })

    baseline.host.handle({ type: 'step', years: 40 })
    withPreview.host.handle({ type: 'step', years: 40 })

    expect(frozen(world(withPreview.sent, 'A'))).toEqual(frozen(world(baseline.sent, 'A')))
    expect(frozen(world(withPreview.sent, 'B'))).toEqual(frozen(world(baseline.sent, 'B')))
  })

  it('takes six histories down to one living, five confluences later', () => {
    const { host, sent, open } = setup()
    open()
    host.handle({ type: 'step', years: 200 })
    for (let i = 1; i <= 5; i++) {
      host.handle({ type: 'branch', requestId: i, parent: 'A', tick: 100, allocation: balanced })
    }
    expect(living(sent)).toHaveLength(6)
    const others = ['B', 'C', 'D', 'E', 'F'] as const
    for (const [index, other] of others.entries()) {
      host.handle({ type: 'merge', requestId: 10 + index, survivor: 'A', other })
      expect(last(sent, 'merged')?.world).toBe('A')
      expect(living(sent)).toHaveLength(5 - index)
      host.handle({ type: 'step', years: 1 })
    }
    expect(living(sent).map((w) => w.info.id)).toEqual(['A'])
    expect(last(sent, 'progress')?.worlds).toHaveLength(6)
  })

  it('names the confluence as the end once nothing runs any more', () => {
    const { host, sent, open } = setup()
    open(0, [{ tick: 0, allocation: industrial }])
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 0, allocation: industrial })
    host.handle({ type: 'step', years: 100 })
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 3000 })
    expect(world(sent, 'B')?.present.status).toBe('merged')
    expect(world(sent, 'A')?.present.status).toBe('extinct')
    expect(last(sent, 'progress')?.ended).toBe('merge')
  })

  it('refuses to remove a history that a confluence names, so no seam is left pointing at nobody', () => {
    const { host, sent } = pair()
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'remove', world: 'B' })
    expect(last(sent, 'error')?.message).toBe(
      'worldline B flowed together with worldline A; a confluence cannot be undone',
    )
    expect(last(sent, 'progress')?.worlds.map((w) => w.info.id)).toEqual(['A', 'B'])
    expect(world(sent, 'A')?.merges).toMatchObject([{ self: 'A', other: 'B', direction: 'in' }])
  })

  it('never frees the letter of a history a confluence names, so no seam ever aliases another', () => {
    const { host, sent } = pair()
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'remove', world: 'B' })
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 100, allocation: balanced })
    expect(last(sent, 'branched')?.world).toBe('C')
    expect(world(sent, 'B')?.present.status).toBe('merged')
    // FEAT: a regra é estreita: quem nenhuma costura nomeia continua removível
    host.handle({ type: 'remove', world: 'C' })
    expect(last(sent, 'progress')?.worlds.map((w) => w.info.id)).toEqual(['A', 'B'])
  })

  it('refuses to remove the history that received a confluence, from the side that flowed away', () => {
    const { host, sent } = pair()
    host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 100, allocation: balanced })
    host.handle({ type: 'merge', requestId: 3, survivor: 'C', other: 'B' })
    host.handle({ type: 'remove', world: 'C' })
    expect(last(sent, 'error')?.message).toBe(
      'worldline C flowed together with worldline B; a confluence cannot be undone',
    )
    expect(last(sent, 'progress')?.worlds.map((w) => w.info.id)).toEqual(['A', 'B', 'C'])
  })

  it('still names the horizon while the surviving history runs', () => {
    const { host, sent, clock } = pair()
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'play', speed: 'max' })
    clock.advance(1000)
    expect(world(sent, 'A')?.present.status).toBe('running')
    expect(last(sent, 'progress')?.now).toBe(HORIZON)
    expect(last(sent, 'progress')?.ended).toBe('horizon')
  })
})

describe('SimulationHost: reopening a seamed multiverse', () => {
  // FEAT: tudo o que o worker já contou de uma história; não há mais nada para comparar dois mundos
  function history(sent: readonly FromWorker[], id: WorldlineId) {
    const records: EventRecord[] = []
    for (const progress of all(sent, 'progress')) {
      const update = progress.worlds.find((w) => w.info.id === id)
      for (const event of update?.events ?? []) records[event.index] = event.record
    }
    const latest = world(sent, id)
    if (!latest) throw new Error(`the host never reported worldline ${id}`)
    return {
      info: latest.info,
      present: latest.present,
      decisions: latest.decisions,
      crossings: latest.crossings,
      merges: latest.merges,
      debts: latest.debts,
      paradox: latest.paradox,
      colonies: latest.colonies,
      records,
    }
  }

  function valuesAt(
    sent: readonly FromWorker[],
    host: SimulationHost,
    id: WorldlineId,
    tick: number,
  ) {
    host.handle({ type: 'inspect', requestId: 90, world: id, tick })
    return last(sent, 'inspect')?.snapshot.values
  }

  // FEAT: a raiz costura a filha no ano 200, e no 201 sai dela uma neta que já nasce costurada
  function livedWithASeamAndABranchAfterIt() {
    const { host, sent } = setup()
    host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    host.handle({ type: 'step', years: 200 })
    host.handle({ type: 'branch', requestId: 1, parent: 'A', tick: 100, allocation: balanced })
    host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    host.handle({ type: 'step', years: 1 })
    host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 201, allocation: balanced })
    host.handle({ type: 'step', years: 99 })
    return { host, sent }
  }

  const seamedLink: Extract<ToWorker, { type: 'open' }> = {
    type: 'open',
    seed: SEED,
    tick: 300,
    root: [],
    merges: [{ tick: 200, self: 'A', other: 'B', direction: 'in' }],
    branches: [
      {
        parent: 0,
        fork: 100,
        decisions: [{ tick: 100, allocation: balanced }],
        merges: [{ tick: 200, self: 'B', other: 'A', direction: 'out' }],
      },
      { parent: 0, fork: 201, decisions: [{ tick: 201, allocation: balanced }] },
    ],
  }

  it('brings every history of a seamed multiverse back exactly as it was lived', () => {
    const lived = livedWithASeamAndABranchAfterIt()
    const { host, sent } = setup()
    host.handle(seamedLink)
    expect(last(sent, 'progress')?.now).toBe(300)
    for (const id of ['A', 'B', 'C'] as const) {
      expect(history(sent, id)).toEqual(history(lived.sent, id))
    }
    // FIX: sem a costura a sobrevivente seguiria outra história, então a igualdade não é de graça
    const unseamed = setup()
    unseamed.host.handle({
      ...seamedLink,
      merges: [],
      branches: seamedLink.branches.map((branch) => ({ ...branch, merges: [] })),
    })
    expect(world(unseamed.sent, 'A')?.present.values.population).not.toBe(
      world(sent, 'A')?.present.values.population,
    )
  })

  it('reopens the history that flowed away as merged, in the year of the seam, and not living', () => {
    const { host, sent } = setup()
    host.handle(seamedLink)
    expect(world(sent, 'B')?.present.status).toBe('merged')
    expect(world(sent, 'B')?.present.tick).toBe(200)
    expect(world(sent, 'B')?.merges).toMatchObject([
      { tick: 200, self: 'B', other: 'A', direction: 'out' },
    ])
    expect(
      last(sent, 'progress')?.worlds.filter((w) => w.present.status === 'running'),
    ).toHaveLength(2)
  })

  // FIX: este é o teste da ordem: uma filha crescida de uma mãe ainda sem costura nasce menor que ela
  it('grows a branch forked after a seam from a parent that is already seamed', () => {
    const lived = livedWithASeamAndABranchAfterIt()
    const { host, sent } = setup()
    host.handle(seamedLink)
    const mother = valuesAt(sent, host, 'A', 201)
    const daughter = valuesAt(sent, host, 'C', 201)
    expect(daughter?.population).toBeGreaterThan(0)
    expect(daughter).toEqual(mother)
    expect(daughter).toEqual(valuesAt(lived.sent, lived.host, 'C', 201))
    expect(world(sent, 'C')?.present).toEqual(world(lived.sent, 'C')?.present)
  })

  it('carries a seam in the root and a seam in a branch in the same open', () => {
    const lived = setup()
    lived.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    lived.host.handle({ type: 'step', years: 200 })
    lived.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 100,
      allocation: balanced,
    })
    lived.host.handle({ type: 'branch', requestId: 2, parent: 'A', tick: 150, allocation: starved })
    lived.host.handle({ type: 'merge', requestId: 3, survivor: 'C', other: 'B' })
    lived.host.handle({ type: 'step', years: 1 })
    lived.host.handle({
      type: 'branch',
      requestId: 4,
      parent: 'C',
      tick: 201,
      allocation: balanced,
    })
    lived.host.handle({ type: 'merge', requestId: 5, survivor: 'A', other: 'D' })
    lived.host.handle({ type: 'step', years: 99 })

    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      merges: [{ tick: 201, self: 'A', other: 'D', direction: 'in' }],
      branches: [
        {
          parent: 0,
          fork: 100,
          decisions: [{ tick: 100, allocation: balanced }],
          merges: [{ tick: 200, self: 'B', other: 'C', direction: 'out' }],
        },
        {
          parent: 0,
          fork: 150,
          decisions: [{ tick: 150, allocation: starved }],
          merges: [{ tick: 200, self: 'C', other: 'B', direction: 'in' }],
        },
        {
          parent: 2,
          fork: 201,
          decisions: [{ tick: 201, allocation: balanced }],
          merges: [{ tick: 201, self: 'D', other: 'A', direction: 'out' }],
        },
      ],
    })
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      expect(history(sent, id)).toEqual(history(lived.sent, id))
    }
    expect(world(sent, 'B')?.present.status).toBe('merged')
    expect(world(sent, 'D')?.present.status).toBe('merged')
    expect(world(sent, 'D')?.present.tick).toBe(201)
  })

  it('reopens a multiverse without any seam exactly as it always did', () => {
    const lived = setup()
    lived.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    lived.host.handle({ type: 'step', years: 300 })
    lived.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 100,
      allocation: balanced,
    })
    lived.host.handle({ type: 'branch', requestId: 2, parent: 'B', tick: 200, allocation: starved })

    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      branches: [
        { parent: 0, fork: 100, decisions: [{ tick: 100, allocation: balanced }] },
        { parent: 1, fork: 200, decisions: [{ tick: 200, allocation: starved }] },
      ],
    })
    for (const id of ['A', 'B', 'C'] as const) {
      expect(history(sent, id)).toEqual(history(lived.sent, id))
    }
    expect(world(sent, 'A')?.merges).toEqual([])
  })

  it('refuses a seam whose other side never recorded flowing away', () => {
    const { host, sent } = setup()
    host.handle({ ...seamedLink, branches: seamedLink.branches.map((b) => ({ ...b, merges: [] })) })
    expect(last(sent, 'error')?.message).toBe('worldline B has no record of flowing into A')
    host.handle({ ...seamedLink, merges: [] })
    expect(last(sent, 'error')?.message).toBe(
      'a confluence flows into a history that never received it',
    )
    host.handle({ type: 'range', requestId: 1, world: 'A', from: 0, to: 1, buckets: 1 })
    expect(last(sent, 'error')?.message).toBe('no worldline created')
  })

  it('refuses a seam in a year the shared history never reached', () => {
    const { host, sent } = setup()
    host.handle({
      ...seamedLink,
      merges: [{ tick: 400, self: 'A', other: 'B', direction: 'in' }],
    })
    expect(last(sent, 'error')?.message).toBe(
      'a confluence in year 400 is outside the shared history',
    )
  })

  it('refuses a seam that names a history the link never carried', () => {
    const { host, sent } = setup()
    host.handle({
      ...seamedLink,
      merges: [{ tick: 200, self: 'A', other: 'F', direction: 'in' }],
      branches: [
        {
          parent: 0,
          fork: 100,
          decisions: [{ tick: 100, allocation: balanced }],
          merges: [{ tick: 200, self: 'F', other: 'A', direction: 'out' }],
        },
      ],
    })
    expect(last(sent, 'error')?.message).toBe('unknown departing worldline F')
  })
})

describe('SimulationHost: reopening a branch older than its own parent', () => {
  function told(sent: readonly FromWorker[], id: WorldlineId) {
    const latest = world(sent, id)
    if (!latest) throw new Error(`the host never reported worldline ${id}`)
    return {
      info: latest.info,
      present: latest.present,
      decisions: latest.decisions,
      crossings: latest.crossings,
      merges: latest.merges,
      debts: latest.debts,
      colonies: latest.colonies,
    }
  }

  // FEAT: antes do fork da mãe a história da filha é a da avó, então a filha pode sair de um ano
  // anterior ao da mãe; um link versão 2 já compartilhado pode ter exatamente essa forma
  it('reopens a seamless link whose branch forks before its own parent forked', () => {
    const lived = setup()
    lived.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    lived.host.handle({ type: 'step', years: 300 })
    lived.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 200,
      allocation: balanced,
    })
    lived.host.handle({ type: 'branch', requestId: 2, parent: 'B', tick: 50, allocation: starved })

    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      branches: [
        { parent: 0, fork: 200, decisions: [{ tick: 200, allocation: balanced }] },
        { parent: 1, fork: 50, decisions: [{ tick: 50, allocation: starved }] },
      ],
    })
    expect(all(sent, 'error')).toEqual([])
    expect(world(sent, 'C')?.info).toMatchObject({ parent: 'B', fork: 50 })
    for (const id of ['A', 'B', 'C'] as const) {
      expect(told(sent, id)).toEqual(told(lived.sent, id))
    }
  })

  it('reopens a branch older than its parent when the parent grew from a seamed history', () => {
    const lived = setup()
    lived.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    lived.host.handle({ type: 'step', years: 200 })
    lived.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 100,
      allocation: balanced,
    })
    lived.host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    lived.host.handle({ type: 'step', years: 1 })
    lived.host.handle({
      type: 'branch',
      requestId: 3,
      parent: 'A',
      tick: 201,
      allocation: balanced,
    })
    lived.host.handle({ type: 'branch', requestId: 4, parent: 'C', tick: 150, allocation: starved })
    lived.host.handle({ type: 'step', years: 99 })

    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      merges: [{ tick: 200, self: 'A', other: 'B', direction: 'in' }],
      branches: [
        {
          parent: 0,
          fork: 100,
          decisions: [{ tick: 100, allocation: balanced }],
          merges: [{ tick: 200, self: 'B', other: 'A', direction: 'out' }],
        },
        { parent: 0, fork: 201, decisions: [{ tick: 201, allocation: balanced }] },
        { parent: 2, fork: 150, decisions: [{ tick: 150, allocation: starved }] },
      ],
    })
    expect(all(sent, 'error')).toEqual([])
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      expect(told(sent, id)).toEqual(told(lived.sent, id))
    }
    // FEAT: D sai de C no ano 150, antes da costura do ano 200, então D nunca a recebe
    expect(world(sent, 'D')?.merges).toEqual([])
    expect(world(sent, 'C')?.merges).toMatchObject([{ tick: 200, self: 'A', other: 'B' }])
  })
})

describe('SimulationHost: what the arrival record carries', () => {
  const gift = {
    tick: 0,
    kind: 'knowledge',
    dose: 3,
    amounts: [10],
    origin: { world: 'A', tick: 0 },
    cost: 9,
    direction: 'in',
  } as const
  const idle: Allocation = { agriculture: 40, industry: 60, research: 0, conservation: 0 }

  // FEAT: uma história que não pesquisa nunca quita o presente, então carrega a tensão ano a ano
  const strained: Extract<ToWorker, { type: 'open' }> = {
    type: 'open',
    seed: SEED,
    tick: 40,
    root: [],
    branches: [
      { parent: 0, fork: 0, decisions: [{ tick: 0, allocation: idle }], crossings: [gift] },
    ],
  }

  it('carries the strain of the departing history, and the link brings it back', () => {
    const lived = setup()
    lived.host.handle(strained)
    lived.host.handle({ type: 'merge', requestId: 1, survivor: 'A', other: 'B' })
    lived.host.handle({ type: 'step', years: 5 })
    // FIX: um `strain` inventado ou perdido no recibo não move nada que este teste veja sem isto
    expect(world(lived.sent, 'A')?.merges).toMatchObject([
      { tick: 40, self: 'A', other: 'B', direction: 'in', strain: 40 },
    ])
    expect(world(lived.sent, 'A')?.merges[0]?.debts).toMatchObject([{ kind: 'knowledge' }])

    const { host, sent } = setup()
    host.handle({
      ...strained,
      tick: 45,
      merges: [{ tick: 40, self: 'A', other: 'B', direction: 'in' }],
      branches: [
        {
          ...(strained.branches[0] ?? { parent: 0, fork: 0, decisions: [] }),
          merges: [{ tick: 40, self: 'B', other: 'A', direction: 'out' }],
        },
      ],
    })
    expect(all(sent, 'error')).toEqual([])
    expect(world(sent, 'A')?.merges).toEqual(world(lived.sent, 'A')?.merges)
    expect(world(sent, 'A')?.present).toEqual(world(lived.sent, 'A')?.present)
    expect(world(sent, 'B')?.present).toEqual(world(lived.sent, 'B')?.present)
  })

  it('carries the colonies of the departing history, and the link brings them back', () => {
    const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
    const lived = setup()
    lived.host.handle({
      type: 'open',
      seed: INHERITANCE_CASE.seed,
      tick: 1810,
      root: plan.decisions,
      branches: [],
      crossings: plan.crossings,
    })
    lived.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 100,
      allocation: balanced,
    })
    lived.host.handle({ type: 'merge', requestId: 2, survivor: 'B', other: 'A' })
    lived.host.handle({ type: 'step', years: 2 })
    // FIX: `colonies: []` no recibo passava por todos os testes; a colônia da que deságua pinça isso
    expect(world(lived.sent, 'B')?.merges).toMatchObject([
      {
        tick: 1810,
        self: 'B',
        other: 'A',
        direction: 'in',
        colonies: [{ body: 1, founded: INHERITANCE_CASE.founded }],
      },
    ])
    expect(world(lived.sent, 'B')?.colonies).toMatchObject([
      { body: 1, founded: INHERITANCE_CASE.founded },
    ])

    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: INHERITANCE_CASE.seed,
      tick: 1812,
      root: plan.decisions,
      crossings: plan.crossings,
      merges: [{ tick: 1810, self: 'A', other: 'B', direction: 'out' }],
      branches: [
        {
          parent: 0,
          fork: 100,
          decisions: [{ tick: 100, allocation: balanced }],
          merges: [{ tick: 1810, self: 'B', other: 'A', direction: 'in' }],
        },
      ],
    })
    expect(all(sent, 'error')).toEqual([])
    expect(world(sent, 'B')?.merges).toEqual(world(lived.sent, 'B')?.merges)
    expect(world(sent, 'B')?.colonies).toEqual(world(lived.sent, 'B')?.colonies)
    expect(world(sent, 'B')?.present).toEqual(world(lived.sent, 'B')?.present)
    expect(world(sent, 'A')?.present.status).toBe('merged')
  })
})

describe('SimulationHost: reopening a deferred daughter', () => {
  function told(sent: readonly FromWorker[], id: WorldlineId) {
    const latest = world(sent, id)
    if (!latest) throw new Error(`the host never reported worldline ${id}`)
    return {
      info: latest.info,
      present: latest.present,
      decisions: latest.decisions,
      crossings: latest.crossings,
      merges: latest.merges,
      debts: latest.debts,
      colonies: latest.colonies,
    }
  }

  // FEAT: dois gestos comuns — bifurcar para o passado de um galho e então costurar, tudo no presente
  function livedByTheTwoGestures() {
    const context = setup()
    context.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    context.host.handle({ type: 'step', years: 201 })
    context.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 201,
      allocation: balanced,
    })
    context.host.handle({
      type: 'branch',
      requestId: 2,
      parent: 'B',
      tick: 150,
      allocation: starved,
    })
    context.host.handle({ type: 'merge', requestId: 3, survivor: 'A', other: 'C' })
    context.host.handle({ type: 'step', years: 99 })
    return context
  }

  const deferred: Extract<ToWorker, { type: 'open' }> = {
    type: 'open',
    seed: SEED,
    tick: 300,
    root: [],
    merges: [{ tick: 201, self: 'A', other: 'C', direction: 'in' }],
    branches: [
      { parent: 0, fork: 201, decisions: [{ tick: 201, allocation: balanced }] },
      {
        parent: 1,
        fork: 150,
        decisions: [{ tick: 150, allocation: starved }],
        merges: [{ tick: 201, self: 'C', other: 'A', direction: 'out' }],
      },
    ],
  }

  it('reopens a daughter forked into her parent past who then flowed into another history', () => {
    const lived = livedByTheTwoGestures()
    expect(all(lived.sent, 'error')).toEqual([])
    const { host, sent } = setup()
    host.handle(deferred)
    expect(all(sent, 'error')).toEqual([])
    for (const id of ['A', 'B', 'C'] as const) {
      expect(told(sent, id)).toEqual(told(lived.sent, id))
    }
    expect(world(sent, 'C')?.present.status).toBe('merged')
    expect(world(sent, 'C')?.present.tick).toBe(201)
    expect(world(sent, 'C')?.info).toMatchObject({ parent: 'B', fork: 150 })
    expect(last(sent, 'progress')?.now).toBe(300)
  })

  // FEAT: depois de alcançar o ano da mãe, a filha adiada segue no passo de todas as outras
  it('reopens a deferred daughter that flows away years after she was built', () => {
    const lived = setup()
    lived.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    lived.host.handle({ type: 'step', years: 201 })
    lived.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 201,
      allocation: balanced,
    })
    lived.host.handle({ type: 'branch', requestId: 2, parent: 'B', tick: 150, allocation: starved })
    lived.host.handle({ type: 'step', years: 49 })
    lived.host.handle({ type: 'merge', requestId: 3, survivor: 'A', other: 'C' })
    lived.host.handle({ type: 'step', years: 50 })
    expect(all(lived.sent, 'error')).toEqual([])

    const { host, sent } = setup()
    host.handle({
      ...deferred,
      merges: [{ tick: 250, self: 'A', other: 'C', direction: 'in' }],
      branches: [
        { parent: 0, fork: 201, decisions: [{ tick: 201, allocation: balanced }] },
        {
          parent: 1,
          fork: 150,
          decisions: [{ tick: 150, allocation: starved }],
          merges: [{ tick: 250, self: 'C', other: 'A', direction: 'out' }],
        },
      ],
    })
    expect(all(sent, 'error')).toEqual([])
    for (const id of ['A', 'B', 'C'] as const) {
      expect(told(sent, id)).toEqual(told(lived.sent, id))
    }
    expect(world(sent, 'C')?.present.tick).toBe(250)
  })

  // FEAT: a filha adiada não viveu os anos entre o fork e o nascimento, então lá não cabe costura
  it('refuses a confluence in a year a deferred daughter never lived', () => {
    const atTheFork = setup()
    atTheFork.host.handle({
      ...deferred,
      merges: [{ tick: 150, self: 'A', other: 'C', direction: 'in' }],
      branches: [
        { parent: 0, fork: 201, decisions: [{ tick: 201, allocation: balanced }] },
        {
          parent: 1,
          fork: 150,
          decisions: [{ tick: 150, allocation: starved }],
          merges: [{ tick: 150, self: 'C', other: 'A', direction: 'out' }],
        },
      ],
    })
    expect(last(atTheFork.sent, 'error')?.message).toBe(
      'worldline C only exists from year 201, so it never had a confluence in year 150',
    )

    const between = setup()
    between.host.handle({
      ...deferred,
      merges: [{ tick: 175, self: 'A', other: 'C', direction: 'in' }],
      branches: [
        { parent: 0, fork: 201, decisions: [{ tick: 201, allocation: balanced }] },
        {
          parent: 1,
          fork: 150,
          decisions: [{ tick: 150, allocation: starved }],
          merges: [{ tick: 175, self: 'C', other: 'A', direction: 'out' }],
        },
      ],
    })
    expect(last(between.sent, 'error')?.message).toBe(
      'worldline C only exists from year 201, so it never had a confluence in year 175',
    )
    // FEAT: e o ano do nascimento, que é o da costura de verdade, segue passando
    const { host, sent } = setup()
    host.handle(deferred)
    expect(all(sent, 'error')).toEqual([])
    between.host.handle({ type: 'range', requestId: 1, world: 'A', from: 0, to: 1, buckets: 1 })
    expect(last(between.sent, 'error')?.message).toBe('no worldline created')
  })
})

describe('SimulationHost: the seam interleavings still round-trip', () => {
  function told(sent: readonly FromWorker[], id: WorldlineId) {
    const latest = world(sent, id)
    if (!latest) throw new Error(`the host never reported worldline ${id}`)
    return { present: latest.present, merges: latest.merges, decisions: latest.decisions }
  }

  it('still seams two pairs of histories in one single year', () => {
    const lived = setup()
    lived.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    lived.host.handle({ type: 'step', years: 200 })
    for (const [id, tick] of [
      [1, 100],
      [2, 120],
      [3, 140],
    ] as const) {
      lived.host.handle({ type: 'branch', requestId: id, parent: 'A', tick, allocation: balanced })
    }
    lived.host.handle({ type: 'merge', requestId: 4, survivor: 'A', other: 'B' })
    lived.host.handle({ type: 'merge', requestId: 5, survivor: 'C', other: 'D' })
    lived.host.handle({ type: 'step', years: 100 })
    expect(all(lived.sent, 'error')).toEqual([])

    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      merges: [{ tick: 200, self: 'A', other: 'B', direction: 'in' }],
      branches: [
        {
          parent: 0,
          fork: 100,
          decisions: [{ tick: 100, allocation: balanced }],
          merges: [{ tick: 200, self: 'B', other: 'A', direction: 'out' }],
        },
        {
          parent: 0,
          fork: 120,
          decisions: [{ tick: 120, allocation: balanced }],
          merges: [{ tick: 200, self: 'C', other: 'D', direction: 'in' }],
        },
        {
          parent: 0,
          fork: 140,
          decisions: [{ tick: 140, allocation: balanced }],
          merges: [{ tick: 200, self: 'D', other: 'C', direction: 'out' }],
        },
      ],
    })
    expect(all(sent, 'error')).toEqual([])
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      expect(told(sent, id)).toEqual(told(lived.sent, id))
    }
    expect(world(sent, 'B')?.present.status).toBe('merged')
    expect(world(sent, 'D')?.present.status).toBe('merged')
  })

  it('still lets a branch fork in the very year its parent was seamed', () => {
    const lived = setup()
    lived.host.handle({ type: 'open', seed: SEED, tick: 0, root: [], branches: [] })
    lived.host.handle({ type: 'step', years: 200 })
    lived.host.handle({
      type: 'branch',
      requestId: 1,
      parent: 'A',
      tick: 100,
      allocation: balanced,
    })
    lived.host.handle({ type: 'merge', requestId: 2, survivor: 'A', other: 'B' })
    lived.host.handle({ type: 'branch', requestId: 3, parent: 'A', tick: 200, allocation: starved })
    lived.host.handle({ type: 'step', years: 100 })
    expect(all(lived.sent, 'error')).toEqual([])

    const { host, sent } = setup()
    host.handle({
      type: 'open',
      seed: SEED,
      tick: 300,
      root: [],
      merges: [{ tick: 200, self: 'A', other: 'B', direction: 'in' }],
      branches: [
        {
          parent: 0,
          fork: 100,
          decisions: [{ tick: 100, allocation: balanced }],
          merges: [{ tick: 200, self: 'B', other: 'A', direction: 'out' }],
        },
        { parent: 0, fork: 200, decisions: [{ tick: 200, allocation: starved }] },
      ],
    })
    expect(all(sent, 'error')).toEqual([])
    for (const id of ['A', 'B', 'C'] as const) {
      expect(told(sent, id)).toEqual(told(lived.sent, id))
    }
    // FEAT: a costura é do ano do fork, e só o que vem estritamente antes dela se herda
    expect(world(sent, 'C')?.merges).toEqual([])
  })
})
